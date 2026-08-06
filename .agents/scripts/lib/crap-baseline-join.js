/**
 * crap-baseline-join.js — the incremental-coverage CRAP join (Story #4981),
 * end to end: the method-identity key, the per-file baseline index, the
 * per-file queue wiring, and the join itself.
 *
 * Story #4981 landed those four concerns as three files
 * (`crap-baseline-index.js`, `crap-utils-incremental.js`, and this one) so
 * the work would land as new code rather than same-file expansions. Story
 * #5002 folded them back together: they were one cohesive unit split only
 * for that scoring reason, and the split cost two import hops and two
 * modules whose whole content was five short pure functions.
 *
 * Imports its coordinate/formula primitives from `crap-coordinates.js` (not
 * `crap-engine.js`) so this file stays a one-directional consumer with no
 * edge back into the scoring kernel — `crap-engine.js` imports FROM here.
 */
import {
  COORDINATE_ORIGINAL,
  COORDINATE_TRANSPILED,
  crapFormula,
} from './crap-coordinates.js';

/**
 * Per-file half of the method-identity key `baselines/kinds/crap.js`'s
 * `crapRowKey` composes with the file path (`${path}::${method}@${startLine}`).
 * The path component is redundant once a row set is already narrowed to one
 * file, which is exactly what `indexBaselineRowsByFile` does below.
 *
 * @param {{method: string, startLine: number}} row
 * @returns {string}
 */
function methodIdentityKey(row) {
  return `${row.method}@${row.startLine}`;
}

/**
 * Index baseline rows (accepts either the `{file, method, startLine, crap}`
 * legacy shape `compareCrap`/`scanAndScore` use, or the on-disk `{path, ...}`
 * shape) by file, then by `methodIdentityKey`, for O(1) per-method lookup —
 * exactly the shape `finalizeMethodRowsWithBaseline`'s `baselineByKey`
 * expects.
 *
 * @param {Array<{file?: string, path?: string, method: string, startLine: number, crap: number}>} baselineRows
 * @returns {Map<string, Map<string, {crap: number}>>} file → (method@startLine → row)
 */
function indexBaselineRowsByFile(baselineRows) {
  const byFile = new Map();
  for (const row of baselineRows ?? []) {
    const file = row?.file ?? row?.path;
    if (typeof file !== 'string' || file.length === 0) continue;
    if (!byFile.has(file)) byFile.set(file, new Map());
    byFile.get(file).set(methodIdentityKey(row), row);
  }
  return byFile;
}

/**
 * Resolve `crap-utils.js#scanAndScore`'s `incremental` option into the two
 * lookup structures the per-file queue build needs. Both are `null` when
 * `incremental` is absent (full-scope, the default) — every downstream
 * consumer treats a `null` context as "not incremental".
 *
 * @param {{ touchedFiles?: Set<string>|string[], baselineRows?: Array<object> } | null} incremental
 * @returns {{ touchedFiles: Set<string>|null, baselineByFile: Map<string, Map<string, object>>|null }}
 */
export function resolveIncrementalContext(incremental) {
  const touchedFiles = incremental?.touchedFiles
    ? incremental.touchedFiles instanceof Set
      ? incremental.touchedFiles
      : new Set(incremental.touchedFiles)
    : null;
  const baselineByFile = incremental
    ? indexBaselineRowsByFile(incremental.baselineRows)
    : null;
  return { touchedFiles, baselineByFile };
}

/**
 * Merge one queued file's `touched` flag and per-file `baselineByKey` map
 * (resolved from the `resolveIncrementalContext` output) onto its base queue
 * item. `touched` defaults to `true` (every file is "touched" outside
 * incremental mode, matching `finalizeMethodRowsWithBaseline`'s own default).
 *
 * @param {object} item Base queue item (`{ abs, relPath, requireCoverage, coverageAvailable }`).
 * @param {{ touchedFiles: Set<string>|null, baselineByFile: Map<string, Map<string, object>>|null }} ctx
 * @returns {object} `item` plus `{ touched, baselineByKey }`.
 */
export function resolveQueueIncrementalFields(
  item,
  { touchedFiles, baselineByFile },
) {
  const touched = touchedFiles ? touchedFiles.has(item.relPath) : true;
  const baselineByKey = baselineByFile
    ? (baselineByFile.get(item.relPath) ?? new Map())
    : null;
  return { ...item, touched, baselineByKey };
}

/**
 * True when a file's methods should resolve from the baseline rather than
 * from a fresh coverage entry — an untouched file with at least one indexed
 * baseline row.
 *
 * @param {boolean} touched
 * @param {Map<string, object>|null} baselineByKey
 * @returns {boolean}
 */
function isIncrementalJoinActive(touched, baselineByKey) {
  return !touched && baselineByKey != null && baselineByKey.size > 0;
}

/**
 * `crap-utils.js#scoreFileSerial`'s file-level skip decision, factored out
 * whole so the incremental exception lives with the rest of the join rather
 * than inflating the cyclomatic complexity of the pre-#4981 caller.
 *
 * @param {boolean} requireCoverage
 * @param {object|null} entry Istanbul coverage entry for this file.
 * @param {boolean} touched
 * @param {Map<string, object>|null} baselineByKey
 * @returns {boolean}
 */
export function shouldSkipFileForNoCoverage(
  requireCoverage,
  entry,
  touched,
  baselineByKey,
) {
  return (
    requireCoverage &&
    entry === null &&
    !isIncrementalJoinActive(touched, baselineByKey)
  );
}

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
