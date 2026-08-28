/**
 * source-extensions.js — the single source of truth for which file extensions
 * the CRAP and maintainability scanners score.
 *
 * Three surfaces select "the files the scanner scores" and must agree, because
 * a selector narrower than the scanner's own walk makes a gate green while
 * measuring nothing: the maintainability/CRAP directory walk
 * (`maintainability-utils.js`), the coverage-freshness check
 * (`coverage-capture.js`), and the close-validation CRAP projection's
 * changed-file filter (`close-validation/projections/crap.js`). Story #5076
 * folded all three onto the set below after a TypeScript consumer's entire
 * source tree was filtered out of the freshness check by a `js|mjs`-only
 * literal.
 *
 * **This module MUST import nothing outside `node:` builtins.**
 * `coverage-capture.js` runs on the pre-push path; `maintainability-utils.js`
 * transitively pulls `typhonjs-escomplex` and `typescript`, so the shared set
 * cannot live there without dragging the scoring engines into every freshness
 * probe.
 *
 * The set is deliberately *not* configurable. Freshness exists only to serve
 * the CRAP gate, so the contract is "what the scanner walks" — a
 * consumer-settable extension list would be a second way to mis-scope the same
 * gate.
 *
 * Not to be confused with `transpile.js`'s `TS_EXTS`, which answers a
 * different question ("does this file need transpiling before scoring?") and
 * is correctly a subset of this set rather than a fork of it.
 */
import path from 'node:path';

/**
 * Extensions the CRAP and maintainability engines can score, lower-cased and
 * dot-prefixed. Frozen so a caller cannot mutate the shared set in place.
 *
 * Formats the engines cannot parse — `.astro`, `.vue`, `.svelte` — are
 * deliberately absent: this set selects what the scanner already scores, not
 * every source file that exists in a consumer's tree.
 *
 * Module-private: production consumers select through {@link
 * SCORABLE_SOURCE_EXT_RE} or {@link isScorableSourceFile}, so exporting the
 * raw list would be a dead production export.
 *
 * @type {readonly string[]}
 */
const SCORABLE_SOURCE_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

/**
 * Anchored pattern matching a scorable source path by extension, derived from
 * {@link SCORABLE_SOURCE_EXTENSIONS} so the list stays the only definition.
 * Use it where a path arrives as raw text (a `git ls-files` line, a porcelain
 * status entry) and `path.extname` would be the wrong tool.
 *
 * @type {RegExp}
 */
export const SCORABLE_SOURCE_EXT_RE = new RegExp(
  `\\.(?:${SCORABLE_SOURCE_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})$`,
);

/**
 * @param {string} filePath Absolute or relative path; only its extension is read.
 * @returns {boolean} True when the path's extension is one the engines score.
 */
export function isScorableSourceFile(filePath) {
  return SCORABLE_SOURCE_EXTENSIONS.includes(
    path.extname(String(filePath)).toLowerCase(),
  );
}
