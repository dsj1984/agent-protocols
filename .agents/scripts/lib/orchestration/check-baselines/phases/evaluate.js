/**
 * evaluate.js — Phase 4 of the check-baselines pipeline (Story #2466).
 *
 * Runs the per-kind pipeline: load → floor → compare → tolerance → report.
 * Extracted from `check-baselines.js` without behavior change.
 *
 * @module lib/orchestration/check-baselines/phases/evaluate
 */

import {
  checkBaselineSemantics,
  checkKernelVersion,
  getKindModule,
} from '../../../baselines/kernel.js';
import * as reader from '../../../baselines/reader.js';
import { isIgnoredByGlobs } from '../../../maintainability-utils.js';
import { applyTolerance, evaluateCompare, runCompareStage } from './compare.js';
import { applyFloors, flattenBreaches } from './floors.js';
import { applyRefreshAcknowledgment } from './refresh-ack.js';

/**
 * Defense-in-depth against an `ignoreGlobs`-poisoned baseline (Epic #4326
 * incident). The generation path already drops `ignoreGlobs`-matched files
 * before they reach `rows` (both the canonical `buildDefaultMaintainabilityScorer`
 * and the story-close `buildKindScorer`), so a freshly-generated baseline's
 * `rollup["*"]` never includes an ignored file. But the floor check trusts the
 * *stored* `rollup["*"]`: if a baseline is poisoned by some other route — a
 * stale branch's older tooling, a hand-edit, a future generation bug — an
 * ignored file's metric can still drag the global floor axis (e.g.
 * maintainability `min`) below its floor and block every downstream close.
 *
 * This recomputes the global `*` aggregate over the baseline rows that are NOT
 * matched by the gate's `ignoreGlobs`, using the kind's own canonical
 * `rollup()` aggregator, so the floor axis reflects only the files the gate is
 * meant to police. It is a **no-op for a correctly-generated baseline** (no
 * ignored file is present in `rows`, so the filtered set is identical and the
 * stored `rollup["*"]` is returned unchanged) and only affects the `*`
 * component the incident poisons; named-component rollups are left as stored.
 * The compare/regression stage is untouched — this only reshapes the floor
 * input. All three `ignoreGlobs`-configured gates (maintainability, crap,
 * duplication) are `path`-keyed, so the shared path matcher applies uniformly.
 *
 * Kept module-local (not exported): the poison-exclusion behaviour is covered
 * end-to-end through `evaluateKind` by the `check-baselines.min-floor` suite,
 * so there is no external consumer to justify widening the surface.
 *
 * @param {{ kind: string, baseline: { rollup?: object, rows?: object[] }, ignoreGlobs?: string[], cwd?: string }} args
 * @returns {object} the effective rollup to feed the floor check
 */
function rollupExcludingIgnored({ kind, baseline, ignoreGlobs, cwd }) {
  const rollup = baseline?.rollup;
  if (!Array.isArray(ignoreGlobs) || ignoreGlobs.length === 0) return rollup;
  const rows = baseline?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return rollup;
  let mod;
  try {
    mod = getKindModule(kind);
  } catch {
    return rollup;
  }
  if (mod?.keyField !== 'path' || typeof mod.rollup !== 'function')
    return rollup;
  const kept = rows.filter((row) => {
    const p = row?.path;
    return typeof p !== 'string' || !isIgnoredByGlobs(p, ignoreGlobs, cwd);
  });
  // Nothing ignored is present → the stored rollup already excludes ignored
  // files (the correct-baseline fast path); return it untouched.
  if (kept.length === rows.length) return rollup;
  const recomputed = mod.rollup(kept);
  return { ...rollup, '*': recomputed?.['*'] ?? rollup?.['*'] };
}

function loadHeadBaseline(kind, cwd, configPath) {
  try {
    return { baseline: reader.load(kind, { cwd, configPath }) };
  } catch (err) {
    const message = err?.message ?? String(err);
    const tag = /schema validation failed/i.test(message) ? 'schema' : 'read';
    return { schemaError: { tag, message } };
  }
}

function buildGateReport({
  kind,
  gateBlock,
  baseline,
  findings,
  breaches,
  compareOutput,
  cmp,
  ack,
}) {
  const kernel = checkKernelVersion(kind, baseline.kernelVersion);
  return {
    kind,
    enabled: true,
    kernelMatch: kernel.match,
    kernelCurrent: kernel.current,
    kernelBaseline: baseline.kernelVersion,
    tolerance: gateBlock.tolerance ?? null,
    floors: gateBlock.floors ?? {},
    components: findings,
    breachCount: breaches.length,
    breaches,
    regressions: compareOutput.regressions,
    improvements: compareOutput.improvements,
    unchanged: compareOutput.unchanged,
    additions: compareOutput.additions ?? [],
    regressionCount: compareOutput.regressions.length,
    baseRef: cmp.baseRef ?? null,
    // Story #4914 — the compare arm's read status was internal to compare.js,
    // which is why a dead compare arm looked byte-identical to a clean run.
    // Surfacing it makes "the head-vs-base arm did not run" diagnosable from
    // the JSON report alone.
    baseRead: cmp.baseRead === true,
    generatedAt: baseline.generatedAt,
    acknowledged: ack.acknowledged,
    // Story #5179 — `acknowledged` is now a PARTIAL statement: a refresh commit
    // clears only the rows it actually refreshed, so a run can acknowledge some
    // regressions and still fail on others. Naming the acknowledged keys makes
    // which-half-was-which readable from the JSON report without re-walking git.
    acknowledgedKeys: ack.acknowledgedKeys,
  };
}

export async function evaluateKind({
  kind,
  gateBlock,
  scope,
  cwd,
  configPath,
  env = process.env,
}) {
  const headLoad = loadHeadBaseline(kind, cwd, configPath);
  if (headLoad.schemaError) return { kind, schemaError: headLoad.schemaError };
  const baseline = headLoad.baseline;
  // Story #4775 — scoring-semantics gate. A baseline whose rows were produced
  // by superseded scoring semantics is structurally valid but semantically
  // incomparable, so schema validation alone would wave it through. Fail
  // closed on the `semantics` tag rather than compare across the boundary;
  // the message names the exact re-baseline command.
  const semanticsError = checkBaselineSemantics(kind, baseline);
  if (semanticsError) {
    return {
      kind,
      schemaError: { tag: 'semantics', message: semanticsError },
    };
  }
  const floorRollup = rollupExcludingIgnored({
    kind,
    baseline,
    ignoreGlobs: gateBlock.ignoreGlobs,
    cwd,
  });
  const findings = applyFloors(kind, floorRollup, gateBlock.floors ?? {});
  const breaches = flattenBreaches(findings);
  const cmp = await evaluateCompare({ kind, gateBlock, scope, cwd });
  const rawCompare = runCompareStage(baseline, cmp);
  const toleratedCompare = applyTolerance(
    rawCompare,
    gateBlock.tolerance ?? null,
  );
  const ack = applyRefreshAcknowledgment(kind, toleratedCompare, {
    gateBlock,
    cmp,
    cwd,
    env,
    headBaseline: baseline,
  });
  return buildGateReport({
    kind,
    gateBlock,
    baseline,
    findings,
    breaches,
    compareOutput: ack.compareOutput,
    cmp,
    ack,
  });
}
