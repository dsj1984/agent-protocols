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
 * When `enabled: true`, the changed-file set against `baseRef` (default: the
 * gate's own `--ref` / `main`) decides **whether** to capture — no changed
 * file under `crap.targetDirs` means no capture at all — and the CRAP join
 * treats a method in a file the diff did not touch as resolved by its
 * committed baseline row instead of requiring fresh coverage for it. It does
 * not narrow the capture run itself: a capture that does happen is the
 * ordinary full `npm run test:coverage` (Story #5065).
 */
export const INCREMENTAL_COVERAGE_SCHEMA = {
  type: 'object',
  description:
    'Story #4981 — opt-in incremental coverage-capture + CRAP-join scoping. Default (key absent) preserves today’s full-repo behaviour byte-for-byte. When `enabled: true`, the changed-file set against `baseRef` (default: the gate’s own `--ref` / `main`) decides WHETHER to capture — no changed file under `crap.targetDirs` means no capture at all — and the CRAP join treats a method in a file the diff did not touch as resolved by its committed baseline row instead of requiring fresh coverage for it. It does NOT narrow the capture run itself: a capture that does happen is the ordinary full `npm run test:coverage` (Story #5065).',
  properties: {
    enabled: {
      type: 'boolean',
      description:
        'Master switch for the capture skip and the baseline-resolved CRAP join.',
    },
    baseRef: {
      type: 'string',
      minLength: 1,
      description:
        'Git ref the changed-file set is computed against. Omitted falls back to the gate’s own `--ref` (`main`).',
    },
  },
  additionalProperties: false,
};
