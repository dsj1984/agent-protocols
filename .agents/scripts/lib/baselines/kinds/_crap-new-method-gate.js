/**
 * _crap-new-method-gate.js — the policy `kinds/crap.js#compareCrap` applies to
 * a method that has no baseline row (Story #5002).
 *
 * Underscore-prefixed like `_shared-metric.js`: this is a helper for the
 * per-kind modules in this directory, not a kind of its own.
 *
 * A leaf — it imports nothing, so `kinds/crap.js` can consume it without
 * adding an edge to anything the comparator does not already reach.
 */

/**
 * The set of scanned files in which **every** measured method resolved 0%
 * coverage — the observable signature of a source no test loads at all.
 *
 * Deliberately derived from the scan rows rather than plumbed down from the
 * coverage artifact: the rows are the only thing both the preview gate and the
 * close-validation projection hand the comparator, and "the whole file is at
 * zero" is exactly what an all-zero istanbul entry produces here.
 *
 * A row carrying `coverage: null` is skipped, not counted as a zero — an
 * absent observation is not a measured one, and letting it vote would hand the
 * relief below to a file nothing measured at all.
 *
 * @param {Array<{file: string, coverage?: number|null}>} currentRows
 * @returns {Set<string>}
 */
export function deriveUncoveredFiles(currentRows) {
  const allZeroByFile = new Map();
  for (const row of currentRows ?? []) {
    if (typeof row?.coverage !== 'number') continue;
    const soFar = allZeroByFile.get(row.file);
    allZeroByFile.set(row.file, (soFar ?? true) && row.coverage === 0);
  }
  const uncovered = new Set();
  for (const [file, allZero] of allZeroByFile) {
    if (allZero) uncovered.add(file);
  }
  return uncovered;
}

/**
 * The score a **new** method is judged against `newMethodCeiling` with.
 *
 * Normally the measured CRAP. In a file whose every method scored 0%, the
 * complexity term `c` alone.
 *
 * **Why.** `crap = c²·(1 − cov)³ + c` collapses to `c² + c` at zero coverage,
 * so the default ceiling of 30 caps a *brand-new* method in an untested file
 * at `c ≈ 5`. For the code that is untestable by construction — argv parsing,
 * `spawn` wiring, a CLI's top-level `main()` — that is not a quality signal
 * but a fragmentation tax: the only way past it is to shatter cohesive wiring
 * into sub-five-branch fragments, which raises the file's method count and its
 * reader's cost while measuring nothing. The coverage term still governs every
 * method in a file the tests *do* reach, and a genuinely sprawling function is
 * still refused — `c` alone must clear the ceiling.
 *
 * This is a **gate** decision, not a scoring one: the persisted baseline row
 * keeps its measured `c² + c`, so the regression arm on the next run compares
 * like with like.
 *
 * @param {{file: string, crap: number, cyclomatic?: number}} row
 * @param {Set<string>} uncoveredFiles
 * @returns {number}
 */
export function newMethodGateScore(row, uncoveredFiles) {
  if (!uncoveredFiles.has(row.file)) return row.crap;
  return Number.isFinite(row.cyclomatic) ? row.cyclomatic : row.crap;
}

/**
 * Assemble a new-method violation.
 *
 * `gateScore` is written **only** when the ceiling was judged against
 * something other than the measured `crap` — the same write-only-when-
 * non-default idiom `projectRow` uses for its row markers — so the printer can
 * name the number that actually failed instead of one nothing tested.
 *
 * @param {object} row
 * @param {number} ceiling
 * @param {number} gateScore
 * @returns {object}
 */
export function buildNewViolation(row, ceiling, gateScore) {
  return {
    ...row,
    kind: 'new',
    baseline: null,
    ceiling,
    ...(gateScore === row.crap ? {} : { gateScore }),
  };
}

/**
 * Render the measured-vs-gated half of a new-method violation line.
 *
 * @param {{crap: number, gateScore?: number}} v
 * @returns {string}
 */
export function formatNewViolationMeasure(v) {
  if (v.gateScore === undefined) return `crap=${v.crap.toFixed(2)}`;
  return `complexity=${v.gateScore} (file has no coverage; crap=${v.crap.toFixed(2)})`;
}
