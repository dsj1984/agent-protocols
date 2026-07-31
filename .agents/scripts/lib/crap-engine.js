import escomplex from 'typhonjs-escomplex';
import { coverageForMethodInEntry } from './coverage-utils.js';

/**
 * The two line coordinate systems a CRAP row's `startLine` can be expressed
 * in (Story #4866).
 *
 * `original` — the coordinates of the file a reader can open, and the ones
 * istanbul's `fnMap` is keyed against. A JavaScript source is already in this
 * system; a TS/TSX source reaches it only through a successful sourcemap
 * lookup.
 *
 * `transpiled` — escomplex's own coordinates over the emitted JavaScript,
 * kept only when the sourcemap has no entry originating on the method's
 * generated line. Such a row is NOT an original-source coordinate and must
 * never be presented as one: it cannot be joined to coverage, and it cannot
 * be compared against a baseline row carrying the other provenance.
 */
export const COORDINATE_ORIGINAL = 'original';
export const COORDINATE_TRANSPILED = 'transpiled';

/**
 * Derive the raw per-method CRAP rows from an escomplex report.
 *
 * Single-sourced between `calculateCrapForSource` (CRAP-only path) and
 * `analyzeOnce` (combined MI + CRAP path) so the two cannot drift on how a
 * method's line is remapped or its coverage joined — the parity the
 * combined-parity suite asserts.
 *
 * **Coordinates (Story #4775, corrected by Story #4866).** `mapLine`
 * translates escomplex's `lineStart` — which is in *transpiled* coordinates
 * for a TS/TSX source — into the *original source* coordinates istanbul's
 * `fnMap` uses. A `null` mapper means the two coordinate systems already
 * coincide (plain JavaScript).
 *
 * #4775 let an unresolvable line fall back to the un-remapped value, which
 * made one scan emit rows in two coordinate systems with nothing on the row
 * saying which. Each row now records its own `coordinateSystem`, and an
 * un-remapped row joins no coverage at all: joining a transpiled line against
 * an original-source `fnMap` does not merely miss, it can land inside an
 * unrelated function's range and mis-attribute that function's coverage. An
 * honest `coverage: null` lets the scanner's `requireCoverage` policy decide,
 * exactly as it does for a genuinely uninstrumented method.
 *
 * @param {object|null} report An `escomplex.analyzeModule` report.
 * @param {object|null} coverageForFile Istanbul coverage entry for this file.
 * @param {((line: number) => number|null)|null} [mapLine]
 * @returns {Array<{
 *   method: string,
 *   startLine: number,
 *   cyclomatic: number,
 *   coverage: number|null,
 *   crap: number|null,
 *   coordinateSystem: 'original'|'transpiled',
 * }>}
 */
/**
 * Resolve one method's line into a coordinate and the provenance of that
 * coordinate — the single place the rule lives.
 *
 * No mapper means the source was never transpiled, so its line already IS an
 * original-source coordinate. A mapper that resolves yields one. A mapper
 * that does not leaves the transpiled line, said so.
 *
 * @param {number} rawStartLine escomplex's `lineStart`.
 * @param {((line: number) => number|null)|null} mapLine
 * @returns {{startLine: number, coordinateSystem: 'original'|'transpiled'}}
 */
function resolveCoordinate(rawStartLine, mapLine) {
  if (typeof mapLine !== 'function') {
    return { startLine: rawStartLine, coordinateSystem: COORDINATE_ORIGINAL };
  }
  const mapped = mapLine(rawStartLine);
  return typeof mapped === 'number'
    ? { startLine: mapped, coordinateSystem: COORDINATE_ORIGINAL }
    : { startLine: rawStartLine, coordinateSystem: COORDINATE_TRANSPILED };
}

export function methodRowsFromReport(report, coverageForFile, mapLine = null) {
  const methods = report?.methods ?? [];
  const rows = [];
  for (const m of methods) {
    const rawStartLine = m?.lineStart;
    if (typeof rawStartLine !== 'number') continue;
    const { startLine, coordinateSystem } = resolveCoordinate(
      rawStartLine,
      mapLine,
    );
    const cyclomatic = m?.cyclomatic ?? 0;
    const coverage =
      coverageForFile && coordinateSystem === COORDINATE_ORIGINAL
        ? coverageForMethodInEntry(coverageForFile, startLine)
        : null;
    const crap = coverage === null ? null : crapFormula(cyclomatic, coverage);
    rows.push({
      method: m.name,
      startLine,
      cyclomatic,
      coverage,
      crap,
      coordinateSystem,
    });
  }
  return rows;
}

/**
 * Apply the scanner's `requireCoverage` policy to raw method rows and report
 * how much of the coverage join actually landed.
 *
 * Two policies, one honest each way (Story #4775, fix part 3):
 *
 *   - `requireCoverage: true` — an unresolved method is skipped and counted,
 *     exactly as before. The baseline stays a record of measured code.
 *   - `requireCoverage: false` — an unresolved method scores as **0%
 *     covered** (`crap = c² + c`, the formula's own treatment of untested
 *     code) and lands in the baseline. Previously the flag only stopped
 *     whole *files* being skipped while each individual method was still
 *     dropped, which made it a no-op for baseline population — the caller
 *     asked for "score it anyway" and got silence.
 *
 * `resolvedMethods` / `totalMethods` count the *join*, not the fill: a
 * method scored 0% because its coverage was unresolved counts as
 * unresolved. That is what makes them usable as a health signal for the
 * updater's fail-closed resolution-rate floor.
 *
 * @param {Array<object>} rawRows Rows from `methodRowsFromReport`.
 * @param {{requireCoverage?: boolean}} [opts]
 * @returns {{
 *   rows: Array<object>,
 *   skippedMethodsNoCoverage: number,
 *   resolvedMethods: number,
 *   totalMethods: number,
 * }}
 */
export function finalizeMethodRows(rawRows, { requireCoverage = true } = {}) {
  const rows = [];
  let skippedMethodsNoCoverage = 0;
  let resolvedMethods = 0;
  let totalMethods = 0;
  for (const mr of rawRows ?? []) {
    totalMethods += 1;
    const unresolved = mr.crap === null || mr.coverage === null;
    if (!unresolved) resolvedMethods += 1;
    if (unresolved && requireCoverage) {
      skippedMethodsNoCoverage += 1;
      continue;
    }
    const coverage = unresolved ? 0 : mr.coverage;
    const crap = unresolved ? crapFormula(mr.cyclomatic, 0) : mr.crap;
    rows.push({
      method: mr.method,
      startLine: mr.startLine,
      cyclomatic: mr.cyclomatic,
      coverage,
      crap,
      // Provenance survives the policy step (Story #4866): a row scored 0%
      // under `requireCoverage: false` may still be carrying a transpiled
      // coordinate, and the compare needs to know that before it keys on it.
      coordinateSystem: mr.coordinateSystem ?? COORDINATE_ORIGINAL,
    });
  }
  return { rows, skippedMethodsNoCoverage, resolvedMethods, totalMethods };
}

/**
 * Score each method in a JavaScript source for Change Risk Anti-Patterns
 * (CRAP): `c² · (1 − cov)³ + c`, where `c` is cyclomatic complexity and `cov`
 * is the per-method statement-coverage ratio in [0, 1].
 *
 * Kernel contract:
 *   - Pure (no I/O, no AST parse beyond the one delegated to escomplex via
 *     `analyzeModule`).
 *   - Methods whose coverage cannot be resolved from `coverageForFile` —
 *     including every method whose line stayed in transpiled coordinates —
 *     produce `coverage: null` and `crap: null`. Callers apply their own
 *     `requireCoverage` policy at the scanner level (`finalizeMethodRows`);
 *     this kernel never decides to skip.
 *   - A parse error returns an empty array — the file is unscorable, not
 *     zero-complexity.
 *
 * @param {string} source JavaScript source text (possibly transpiled).
 * @param {object|null} coverageForFile The inner value from a
 *   `coverage-final.json` map keyed by this file's path, or null when no
 *   coverage data is available for this file.
 * @param {((line: number) => number|null)|null} [mapLine] Transpiled →
 *   original line resolver; see `methodRowsFromReport`.
 * @returns {Array<{
 *   method: string,
 *   startLine: number,
 *   cyclomatic: number,
 *   coverage: number|null,
 *   crap: number|null,
 *   coordinateSystem: 'original'|'transpiled',
 * }>}
 */
export function calculateCrapForSource(
  source,
  coverageForFile,
  mapLine = null,
) {
  let report;
  try {
    report = escomplex.analyzeModule(source);
  } catch {
    return [];
  }
  return methodRowsFromReport(report, coverageForFile, mapLine);
}

/**
 * CRAP formula, exported for callers that need to derive target scores or
 * `fixGuidance` values without re-scoring source.
 *
 * @param {number} cyclomatic
 * @param {number} coverage In [0, 1].
 * @returns {number}
 */
export function crapFormula(cyclomatic, coverage) {
  const c = Number(cyclomatic) || 0;
  const cov = Math.max(0, Math.min(1, Number(coverage) || 0));
  return c * c * (1 - cov) ** 3 + c;
}

/**
 * Derive the deterministic single-axis fixes that would bring a method at
 * cyclomatic complexity `c` at or under the `target` CRAP score.
 *
 * Two orthogonal remediations are surfaced:
 *   - `minComplexityAt100Cov`: branch count a refactor must reach so that,
 *     even untested, the method would pass (`CRAP@cov=1 = c` → `c ≤ target`).
 *     Computed as `floor(sqrt(target))`.
 *   - `minCoverageAtCurrentComplexity`: ratio a test-addition must reach at
 *     the current complexity to pass, derived by inverting the formula:
 *     `cov = 1 − ((target − c) / c²)^(1/3)`. Null when unachievable — i.e.
 *     `c > target` (CRAP at 100% coverage still exceeds the target) or when
 *     `c ≤ 0` (no branches; coverage is meaningless).
 *
 * Callers apply the target convention: `baseline` for regressions,
 * `newMethodCeiling` for new violations. The helper stays scalar so it can
 * be re-used by MI-parity output or future guidance surfaces.
 *
 * @param {{ cyclomatic: number, target: number }} params
 * @returns {{
 *   crapCeiling: number,
 *   minComplexityAt100Cov: number,
 *   minCoverageAtCurrentComplexity: number | null,
 * } | null}
 */
export function deriveFixGuidance({ cyclomatic, target } = {}) {
  const c = Number(cyclomatic);
  const t = Number(target);
  if (!Number.isFinite(c) || !Number.isFinite(t) || t < 0) return null;

  const minComplexityAt100Cov = Math.max(0, Math.floor(Math.sqrt(t)));

  let minCoverageAtCurrentComplexity = null;
  if (c > 0 && t >= c) {
    // `(t - c) / c²` lies in `[0, 1]` for `t ∈ [c, c + c²]`; Math.cbrt stays
    // real-valued for any input so a numeric clamp is the only safeguard.
    const ratio = (t - c) / (c * c);
    const minCov = 1 - Math.cbrt(ratio);
    minCoverageAtCurrentComplexity = Math.max(0, Math.min(1, minCov));
  }

  return {
    crapCeiling: t,
    minComplexityAt100Cov,
    minCoverageAtCurrentComplexity,
  };
}
