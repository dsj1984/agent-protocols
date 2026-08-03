/**
 * crap-baseline-join.js — the incremental-coverage CRAP join (Story #4981).
 *
 * Split out of `crap-engine.js` into its own file (rather than added inline)
 * so the Story's join logic lands as new code, not a same-file expansion of
 * the pre-existing scoring kernel. Imports its coordinate/formula
 * primitives from `crap-coordinates.js` (not `crap-engine.js`) and its
 * identity key from `crap-baseline-index.js` — both leaf modules — so this
 * file stays a one-directional consumer with no edge back into
 * `crap-engine.js`.
 */
import { methodIdentityKey } from './crap-baseline-index.js';
import {
  COORDINATE_ORIGINAL,
  COORDINATE_TRANSPILED,
  crapFormula,
} from './crap-coordinates.js';

/**
 * Apply the standard `requireCoverage` policy to a single raw method row.
 * The per-row half of `crap-engine.js#finalizeMethodRows`'s loop body,
 * extracted (Story #4981) so `finalizeMethodRowsWithBaseline`, below, can
 * apply the exact same per-row policy to a method whose file was NOT in the
 * diff scope but whose baseline row could not be found — the fail-closed
 * path AC-3 requires.
 *
 * @param {object} mr A raw row from `methodRowsFromReport`.
 * @param {{requireCoverage: boolean, coverageAvailable: boolean}} opts
 * @returns {{ resolved: boolean, row: object | null }} `row: null` means the
 *   method is skipped-and-counted; `resolved` tracks the join outcome
 *   (independent of whether the row survives the skip policy).
 */
export function resolveRawRow(mr, { requireCoverage, coverageAvailable }) {
  const unresolved = mr.crap === null || mr.coverage === null;
  const resolved = !unresolved;
  // Unjoinable is not untested (Story #4901).
  if (
    mr.coordinateSystem === COORDINATE_TRANSPILED ||
    (unresolved && (requireCoverage || !coverageAvailable))
  ) {
    return { resolved, row: null };
  }
  const coverage = unresolved ? 0 : mr.coverage;
  const crap = unresolved ? crapFormula(mr.cyclomatic, 0) : mr.crap;
  // Everything the scan decided is carried forward; this step overrides only
  // what its own policy resolves. Spreading rather than re-listing each field
  // is why the row's identity marker (Story #4969) and its provenance
  // (Story #4866) survive the step without a line each to remember them —
  // a hand-rebuilt row is how a marker silently stops reaching the baseline.
  return {
    resolved,
    row: {
      ...mr,
      coverage,
      crap,
      coordinateSystem: mr.coordinateSystem ?? COORDINATE_ORIGINAL,
    },
  };
}

/**
 * Incremental-mode join (Story #4981): resolve a file's raw method rows
 * against its committed CRAP-baseline rows instead of requiring fresh
 * coverage, for a file the diff did NOT touch.
 *
 * Rationale: `coverage-capture`'s incremental mode only runs the consumer's
 * test suite scoped to the diff, so an untouched file's coverage entry may
 * legitimately be absent even though nothing about that file's methods
 * changed. Requiring a fresh join for it would either (a) skip-and-count
 * every one of its methods under `requireCoverage: true`, weakening the
 * gate's signal for the vast majority of the tree on every run, or (b) score
 * them at an invented 0% under `requireCoverage: false`, manufacturing a
 * maximal CRAP for code the diff never touched. Neither is a measurement.
 *
 * The join key is `${method}@${startLine}` — the per-file half of the
 * composite identity `kinds/crap.js#crapRowKey` uses for the full baseline
 * compare (`${path}::${method}@${startLine}`); callers pass in a
 * per-file-scoped `baselineByKey` map so this function stays path-agnostic.
 *
 * **Fail-closed (AC-3).** `touched: true` (the file WAS in the diff) or a
 * missing/empty `baselineByKey` reproduces `crap-engine.js#finalizeMethodRows`
 * exactly — this is the pre-#4981 per-row policy, so a caller that never
 * opts in sees byte-identical behaviour (AC-5). For an untouched file, a
 * method whose baseline row cannot be found (new method, moved line, or a
 * baseline that simply never carried it) is NOT invented — it falls back to
 * the same per-row `requireCoverage` skip-and-count policy, via the shared
 * `resolveRawRow`. A method whose coordinate system is transpiled is never
 * resolved from the baseline either, for the same un-joinable reason
 * `resolveRawRow` excludes it (Story #4901).
 *
 * @param {Array<object>} rawRows Rows from `methodRowsFromReport`, all for
 *   the SAME file.
 * @param {{
 *   requireCoverage?: boolean,
 *   coverageAvailable?: boolean,
 *   touched?: boolean,
 *   baselineByKey?: Map<string, {crap: number}> | null,
 * }} [opts]
 * @returns {{
 *   rows: Array<object>,
 *   skippedMethodsNoCoverage: number,
 *   resolvedMethods: number,
 *   totalMethods: number,
 * }}
 */
export function finalizeMethodRowsWithBaseline(
  rawRows,
  {
    requireCoverage = true,
    coverageAvailable = true,
    touched = true,
    baselineByKey = null,
  } = {},
) {
  const useBaseline = !touched && baselineByKey && baselineByKey.size > 0;
  const rows = [];
  let skippedMethodsNoCoverage = 0;
  let resolvedMethods = 0;
  let totalMethods = 0;
  for (const mr of rawRows ?? []) {
    totalMethods += 1;
    if (useBaseline) {
      const base =
        mr.coordinateSystem === COORDINATE_TRANSPILED
          ? undefined
          : baselineByKey.get(methodIdentityKey(mr));
      if (base && typeof base.crap === 'number') {
        resolvedMethods += 1;
        rows.push({
          ...mr,
          coverage: null,
          crap: base.crap,
          resolvedFromBaseline: true,
          coordinateSystem: mr.coordinateSystem ?? COORDINATE_ORIGINAL,
        });
        continue;
      }
    }
    // Touched file, no baseline scope, or no baseline row for this method —
    // fail closed to the standard policy rather than inventing a verdict.
    const resolution = resolveRawRow(mr, {
      requireCoverage,
      coverageAvailable,
    });
    if (resolution.resolved) resolvedMethods += 1;
    if (resolution.row === null) {
      skippedMethodsNoCoverage += 1;
      continue;
    }
    rows.push(resolution.row);
  }
  return { rows, skippedMethodsNoCoverage, resolvedMethods, totalMethods };
}
