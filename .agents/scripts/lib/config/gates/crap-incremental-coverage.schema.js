/* node:coverage ignore file -- AJV schema declaration (data-as-code) */

/**
 * `delivery.quality.gates.crap.incrementalCoverage` — opt-in incremental
 * coverage-capture + CRAP-join scoping (Story #4981).
 *
 * Split into its own module (rather than an inline property literal on
 * `CRAP_GATE`) so the schema addition lands as a new file, not a same-file
 * expansion of `crap.schema.js` — the file this module's sole export is
 * spread into.
 *
 * Default (key absent) preserves today's full-repo behaviour byte-for-byte.
 * When `enabled: true`, `coverage-capture.js` scopes `npm run test:coverage`
 * to the files changed against `baseRef` (default: the gate's own `--ref` /
 * `main`), and the CRAP join treats a method in a file the diff did not
 * touch as resolved by its committed baseline row instead of requiring
 * fresh coverage for it.
 */
export const INCREMENTAL_COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    baseRef: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};
