import escomplex from 'typhonjs-escomplex';
import { coverageForMethodInEntry } from './coverage-utils.js';

/**
 * Score each method in a JavaScript source for Change Risk Anti-Patterns
 * (CRAP): `c² · (1 − cov)³ + c`, where `c` is cyclomatic complexity and `cov`
 * is the per-method statement-coverage ratio in [0, 1].
 *
 * Kernel contract:
 *   - Pure (no I/O, no AST parse beyond the one delegated to escomplex via
 *     `analyzeModule`).
 *   - Methods whose coverage cannot be resolved from `coverageForFile`
 *     produce `coverage: null` and `crap: null`. Callers apply their own
 *     `requireCoverage` policy at the scanner level; this kernel never
 *     decides to skip.
 *   - A parse error returns an empty array — the file is unscorable, not
 *     zero-complexity.
 *
 * @param {string} source JavaScript source text.
 * @param {object|null} coverageForFile The inner value from a
 *   `coverage-final.json` map keyed by this file's path, or null when no
 *   coverage data is available for this file.
 * @returns {Array<{
 *   method: string,
 *   startLine: number,
 *   cyclomatic: number,
 *   coverage: number|null,
 *   crap: number|null,
 * }>}
 */
export function calculateCrapForSource(source, coverageForFile) {
  let report;
  try {
    report = escomplex.analyzeModule(source);
  } catch {
    return [];
  }
  const methods = report?.methods ?? [];
  const rows = [];
  for (const m of methods) {
    const startLine = m?.lineStart;
    if (typeof startLine !== 'number') continue;
    const cyclomatic = m?.cyclomatic ?? 0;
    const coverage = coverageForFile
      ? coverageForMethodInEntry(coverageForFile, startLine)
      : null;
    const crap = coverage === null ? null : crapFormula(cyclomatic, coverage);
    rows.push({
      method: m.name,
      startLine,
      cyclomatic,
      coverage,
      crap,
    });
  }
  return rows;
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
