/**
 * merge-envelopes.js — pure 3-way merge of baseline envelopes by row
 * identity (Story #5215).
 *
 * ## Why this exists
 *
 * Every baseline write stamps `generatedAt`, and the stamp sits on line 4 of
 * every envelope. Two branches that each refresh a baseline therefore always
 * differ on that line, even when they moved completely disjoint rows — so
 * git's LINE-based merge has to reconcile it. Whether it can separate that
 * hunk from the moved rows is an accident of proximity, and both outcomes
 * are bad:
 *
 *   - it cannot → a conflict on work that never actually overlapped;
 *   - it can → it splices both sides' row lines together into a row set
 *     NEITHER side ever scored. That silent one is the worse failure: the
 *     ratchet then guards a number no scorer produced.
 *
 * A baseline is not a text file. It is a set of rows keyed by identity plus
 * a rollup DERIVED from those rows, so merging it as text is a category
 * error. This module merges it as what it is.
 *
 * ## Contract
 *
 * Pure: no filesystem, no process, no clock. `assertEnvelope` is deliberately
 * NOT called here (it compiles schemas off disk on first use) — the driver
 * validates what this returns.
 *
 * Per row identity, the standard 3-way rule: the side that differs from base
 * wins; when both sides differ from base AND from each other, that identity
 * is a conflict. Absence is a value, so a row deleted on one side and
 * untouched on the other merges to deleted.
 *
 * Two invariants are load-bearing:
 *
 *   1. **The rollup is recomputed, never merged.** Merging two rollups is
 *      the same splice hazard compressed into a single number, and unlike a
 *      spliced row set it leaves no evidence. It is always derived from the
 *      merged rows via the kind's own `rollup()`.
 *   2. **Identity comes from the kind module** (`rowIdentity`), never from
 *      `keyField`. CRAP groups by file and identifies by method; keying on
 *      `keyField` would drop every method in a file but one.
 *
 * @module lib/baselines/merge-envelopes
 */

import { deepEqual } from '../json-utils.js';
import { KNOWN_KINDS } from './envelope.js';
import { getKindModule } from './kernel.js';

/**
 * Envelope keys that are NOT merged side-by-side: `rows` merge by identity,
 * `rollup` is recomputed from them, and `generatedAt` resolves to the later
 * of the two stamps rather than conflicting (it is metadata about when a
 * scorer ran, not a scored value — treating it as content is the whole bug).
 */
const DERIVED_KEYS = Object.freeze(['rows', 'rollup', 'generatedAt']);

/**
 * Identify an envelope's kind from its `$schema` reference.
 *
 * Derived from `KNOWN_KINDS` rather than pattern-matched, so a file that is
 * not a known per-kind envelope answers `null` — which is how the driver
 * knows to hand it back to git's text merge instead of guessing at a shape
 * it does not understand. `baselines/*.json` also matches several
 * non-envelope baselines (arch-cycles, cyclomatic, dead-exports, …).
 *
 * @param {unknown} envelope
 * @returns {string|null}
 */
export function kindFromEnvelope(envelope) {
  const ref = envelope?.$schema;
  if (typeof ref !== 'string') return null;
  const base = ref.split('/').pop();
  for (const kind of KNOWN_KINDS) {
    if (base === `${kind}.schema.json`) return kind;
  }
  return null;
}

/**
 * The 3-way choice for one value. `undefined` means "absent on this side",
 * which makes deletion just another value rather than a special case.
 *
 * @param {unknown} base
 * @param {unknown} ours
 * @param {unknown} theirs
 * @returns {{ conflict: boolean, value?: unknown }}
 */
function choose(base, ours, theirs) {
  if (deepEqual(ours, theirs)) return { conflict: false, value: ours };
  if (deepEqual(ours, base)) return { conflict: false, value: theirs };
  if (deepEqual(theirs, base)) return { conflict: false, value: ours };
  return { conflict: true };
}

/**
 * Index rows by the kind's `rowIdentity`. A duplicate identity within one
 * side is fatal rather than last-write-wins: it means the incoming file
 * already violates the identity contract, and merging it would silently
 * drop a row.
 *
 * @param {Array<object>} rows
 * @param {(row: object) => string} rowIdentity
 * @param {string} side
 * @returns {Map<string, object>}
 */
function indexRows(rows, rowIdentity, side) {
  const out = new Map();
  for (const [idx, row] of (rows ?? []).entries()) {
    if (!row || typeof row !== 'object') {
      throw new TypeError(
        `mergeEnvelopes: ${side} row at index ${idx} is not an object`,
      );
    }
    const id = rowIdentity(row);
    if (out.has(id)) {
      throw new Error(
        `mergeEnvelopes: ${side} carries two rows with identity "${id}" — the baseline violates the identity contract and cannot be merged safely`,
      );
    }
    out.set(id, row);
  }
  return out;
}

/**
 * Resolve `generatedAt` to the later of the two sides. A stamp is metadata,
 * so it never conflicts: the merged file describes a tree scored as recently
 * as the newer of its inputs.
 *
 * @param {string|undefined} ours
 * @param {string|undefined} theirs
 * @returns {string|undefined}
 */
function laterStamp(ours, theirs) {
  if (typeof ours !== 'string') return theirs;
  if (typeof theirs !== 'string') return ours;
  const a = Date.parse(ours);
  const b = Date.parse(theirs);
  if (Number.isNaN(a) || Number.isNaN(b)) return ours > theirs ? ours : theirs;
  return a >= b ? ours : theirs;
}

/**
 * Merge the envelope-level stamps (`$schema`, `kernelVersion`, and per-kind
 * extras like `scoringSemantics`) by the same 3-way rule as rows. A double
 * bump to different values is a genuine conflict — two branches disagreeing
 * about which scorer produced the file.
 *
 * @param {object} base
 * @param {object} ours
 * @param {object} theirs
 * @returns {{ merged: object, conflicts: Array<object> }}
 */
function mergeStamps(base, ours, theirs) {
  const keys = new Set(
    [...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)].filter(
      (k) => !DERIVED_KEYS.includes(k),
    ),
  );
  const merged = {};
  const conflicts = [];
  for (const key of keys) {
    const pick = choose(base[key], ours[key], theirs[key]);
    if (pick.conflict) {
      conflicts.push({
        scope: 'envelope',
        identity: key,
        base: base[key],
        ours: ours[key],
        theirs: theirs[key],
      });
      merged[key] = ours[key];
      continue;
    }
    if (pick.value !== undefined) merged[key] = pick.value;
  }
  return { merged, conflicts };
}

/**
 * 3-way merge two baseline envelopes against their common ancestor.
 *
 * @param {{
 *   base: object|null,
 *   ours: object,
 *   theirs: object,
 *   kind?: string,
 *   components?: Array<object>,
 * }} params
 *   - `base` — the merge ancestor; `null` (or a rowless object) when the
 *     file was added on both sides.
 *   - `components` — passed straight to the kind's `rollup()`. Defaults to
 *     `[]`, which is what `refreshBaseline` effectively uses, so a merged
 *     envelope carries the same `{'*': …}` rollup shape a refresh writes.
 * @returns {{
 *   kind: string,
 *   envelope: object,
 *   conflicts: Array<{scope: string, identity: string, base?: unknown, ours?: unknown, theirs?: unknown}>,
 * }}
 */
export function mergeEnvelopes({
  base,
  ours,
  theirs,
  kind,
  components = [],
} = {}) {
  const resolvedKind =
    kind ?? kindFromEnvelope(ours) ?? kindFromEnvelope(theirs);
  if (!resolvedKind) {
    throw new Error(
      'mergeEnvelopes: could not resolve a known baseline kind from the envelopes',
    );
  }
  const mod = getKindModule(resolvedKind);
  const baseEnv = base && typeof base === 'object' ? base : { rows: [] };

  const baseRows = indexRows(baseEnv.rows, mod.rowIdentity, 'base');
  const ourRows = indexRows(ours?.rows, mod.rowIdentity, 'ours');
  const theirRows = indexRows(theirs?.rows, mod.rowIdentity, 'theirs');

  const conflicts = [];
  const rows = [];
  const identities = new Set([
    ...ourRows.keys(),
    ...theirRows.keys(),
    ...baseRows.keys(),
  ]);
  for (const id of identities) {
    const b = baseRows.get(id);
    const o = ourRows.get(id);
    const t = theirRows.get(id);
    const pick = choose(b, o, t);
    if (pick.conflict) {
      conflicts.push({
        scope: 'row',
        identity: id,
        base: b,
        ours: o,
        theirs: t,
      });
      // Keep the ours-side value so the row set stays well-formed; the
      // driver renders the conflict markers around it from this record.
      if (o !== undefined) rows.push(o);
      else if (t !== undefined) rows.push(t);
      continue;
    }
    if (pick.value !== undefined) rows.push(pick.value);
  }

  const sortedRows = mod.sortRows(rows);
  const { merged: stamps, conflicts: stampConflicts } = mergeStamps(
    baseEnv,
    ours ?? {},
    theirs ?? {},
  );

  const envelope = {
    ...stamps,
    generatedAt: laterStamp(ours?.generatedAt, theirs?.generatedAt),
    rollup: mod.rollup(sortedRows, components),
    rows: sortedRows,
  };

  return {
    kind: resolvedKind,
    envelope,
    conflicts: [...stampConflicts, ...conflicts],
  };
}
