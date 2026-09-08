/**
 * kinds/kind-factory.js — shared scaffold factory for per-kind baseline
 * modules (Story #3983).
 *
 * The five row-metric kinds (coverage, mutation, maintainability,
 * lighthouse, duplication) used to hand-roll the same scaffold each:
 * `kernelVersion`, `sortRows`, a component-aware `rollup`, a
 * `compare(head, base)` that diffs rows by key into
 * `{regressions, improvements, unchanged, additions}`, an
 * `applyEpsilon` stabilizer (Story #1964), and a scope-aware
 * `mergeRows` (Story #1974). Only the axis list, direction-of-better,
 * aggregate math, and the missing/removed-row policies differ per kind.
 *
 * `makeBaselineKind` generates the scaffold once; each kind module stays
 * a thin parameterization with a byte-identical exported surface. The
 * Story #2012 class of fix ("new paths must land in `additions`, never
 * the regression arm") lives here exactly once.
 *
 * All generated functions are pure: no I/O, no process exit, no
 * friction emission.
 */

import { componentMatches } from '../component-matcher.js';
import { mergeRowsByScope } from '../scope.js';

/**
 * Build the shared scaffold for a per-kind baseline module.
 *
 * @param {{
 *   keyField: string,
 *   kernelVersion: string | (() => string),
 *   axes: string[],
 *   betterWhen: 'higher' | 'lower',
 *   aggregate: (rows: object[]) => Record<string, number>,
 *   missingBasePolicy?: 'addition' | 'perfect',
 *   removedRowPolicy?:
 *     | { kind: 'perfect-head' }
 *     | { kind: 'improvement-when', when: (row: object) => boolean },
 *   perfectRow?: (key: string) => object,
 * }} opts
 *   - `keyField`          — row grouping property (`'path'` or `'route'`):
 *                           the rollup/scope key. The generated
 *                           `rowIdentity` derives from it, but the two are
 *                           distinct concepts — see `rowIdentity` below.
 *   - `kernelVersion`     — static semver, or a thunk for kinds that pin
 *                           to another kind's kernel (MI → CRAP)
 *   - `axes`              — metric property names compared per row
 *   - `betterWhen`        — `'higher'` (coverage, MI, …) or `'lower'`
 *                           (duplication): decides which delta sign is a
 *                           regression
 *   - `aggregate`         — per-kind rollup math over a row set
 *   - `missingBasePolicy` — head row with no base row: `'addition'`
 *                           (default; Story #2012 bucket) or `'perfect'`
 *                           (classify against a perfect base — lighthouse,
 *                           where a new route must meet the bar)
 *   - `removedRowPolicy`  — base row with no head row: `'perfect-head'`
 *                           classifies against a perfect head row;
 *                           `'improvement-when'` pushes an improvement
 *                           when `when(baseRow)` holds, else unchanged
 *   - `perfectRow`        — builds the perfect row for the policies above
 * @returns {{
 *   kernelVersion: () => string,
 *   rowIdentity: (row: object) => string,
 *   sortRows: (rows: object[]) => object[],
 *   rollup: (rows: object[], components?: object[]) => Record<string, object>,
 *   compare: (head: object, base: object) => object,
 *   applyEpsilon: (prior: object[], regenerated: object[], epsilon: number) => object[],
 *   mergeRows: (prior: object[], regenerated: object[], scope: object) => object[],
 * }}
 */
export function makeBaselineKind({
  keyField,
  kernelVersion,
  axes,
  betterWhen,
  aggregate,
  missingBasePolicy = 'addition',
  removedRowPolicy = { kind: 'improvement-when', when: () => false },
  perfectRow = null,
}) {
  const keyOf = (row) => row[keyField];
  const kernelVersionFn =
    typeof kernelVersion === 'function' ? kernelVersion : () => kernelVersion;

  /**
   * Canonical row identity (Story #5215) — the string a 3-way merge keys a
   * row on, and the contract every kind module must satisfy.
   *
   * Deliberately a separate concept from `keyField`, even though the five
   * scaffold kinds derive one from the other. `keyField` answers "which
   * component does this row roll up into", so a kind is free to declare a
   * grouping key coarser than a row (CRAP declares `'path'` while shipping
   * one row per method). Identity answers "is this the same row", and a
   * merge that confuses the two silently drops every sibling sharing a key.
   * Callers therefore read `rowIdentity` off the kind module and never
   * rebuild a key from `keyField` themselves.
   *
   * @param {object} row
   * @returns {string}
   */
  function rowIdentity(row) {
    return String(keyOf(row));
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }

  function rollup(rows, components = []) {
    const out = { '*': aggregate(rows) };
    for (const c of components ?? []) {
      const matched = (rows ?? []).filter((r) => componentMatches(c, keyOf(r)));
      out[c.name] = aggregate(matched);
    }
    return out;
  }

  function classify(regressions, improvements, unchanged, key, head, base) {
    let down = false;
    let up = false;
    for (const axis of axes) {
      const delta = (head[axis] ?? 0) - (base[axis] ?? 0);
      const worse = betterWhen === 'higher' ? delta < 0 : delta > 0;
      const better = betterWhen === 'higher' ? delta > 0 : delta < 0;
      if (worse) down = true;
      else if (better) up = true;
    }
    if (down) regressions.push({ key, head, base });
    else if (up) improvements.push({ key, head, base });
    else unchanged.push({ key, head, base });
  }

  function compare(head, base) {
    const headRows = Array.isArray(head?.rows) ? head.rows : [];
    const baseRows = Array.isArray(base?.rows) ? base.rows : [];
    const baseByKey = new Map();
    for (const r of baseRows) baseByKey.set(keyOf(r), r);
    const seen = new Set();
    const regressions = [];
    const improvements = [];
    const unchanged = [];
    const additions = [];
    for (const h of headRows) {
      const key = keyOf(h);
      seen.add(key);
      const b = baseByKey.get(key);
      if (!b) {
        if (missingBasePolicy === 'addition') {
          additions.push({ key, head: h, base: null });
        } else {
          classify(
            regressions,
            improvements,
            unchanged,
            key,
            h,
            perfectRow(key),
          );
        }
        continue;
      }
      classify(regressions, improvements, unchanged, key, h, b);
    }
    for (const b of baseRows) {
      const key = keyOf(b);
      if (seen.has(key)) continue;
      if (removedRowPolicy.kind === 'perfect-head') {
        classify(regressions, improvements, unchanged, key, perfectRow(key), b);
      } else if (removedRowPolicy.when(b)) {
        improvements.push({ key, head: null, base: b });
      } else {
        unchanged.push({ key, head: null, base: b });
      }
    }
    if (missingBasePolicy === 'addition') {
      return { regressions, improvements, unchanged, additions };
    }
    return { regressions, improvements, unchanged };
  }

  function applyEpsilon(prior, regenerated, epsilon) {
    const priorRows = Array.isArray(prior) ? prior : [];
    const regenRows = Array.isArray(regenerated) ? regenerated : [];
    const eps = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : 0;
    const priorByKey = new Map();
    for (const r of priorRows) priorByKey.set(keyOf(r), r);
    return regenRows.map((row) => {
      const p = priorByKey.get(keyOf(row));
      if (!p) return row;
      let maxAxisDelta = 0;
      for (const axis of axes) {
        const d = Math.abs((row[axis] ?? 0) - (p[axis] ?? 0));
        if (d > maxAxisDelta) maxAxisDelta = d;
      }
      return maxAxisDelta <= eps ? p : row;
    });
  }

  function mergeRows(prior, regenerated, scope) {
    return mergeRowsByScope({
      prior,
      regenerated,
      scope,
      scopeKey: keyOf,
    });
  }

  return {
    kernelVersion: kernelVersionFn,
    rowIdentity,
    sortRows,
    rollup,
    compare,
    applyEpsilon,
    mergeRows,
  };
}
