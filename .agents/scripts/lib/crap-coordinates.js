/**
 * crap-coordinates.js — the CRAP kernel's two line-coordinate-system
 * constants and the CRAP formula itself.
 *
 * Deliberately dependency-free (Story #4981 split, pulled out of
 * `crap-engine.js`): both `crap-engine.js` and `crap-baseline-join.js`
 * need these, and having either import them from the other would close a
 * cycle. `crap-engine.js` re-exports the two constants so its existing
 * importers (`baselines/kinds/crap.js`, `crap-utils.js`, tests) are
 * unaffected.
 */

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
