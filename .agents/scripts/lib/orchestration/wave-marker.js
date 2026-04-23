/**
 * lib/orchestration/wave-marker.js — Wave-marker regex + parser.
 *
 * Centralizes the regex used to recognize `wave-N-start` / `wave-N-end`
 * structured-comment types so call sites (`ticketing.js`, tool-registry
 * descriptors, tests) all agree on the same bounded pattern.
 *
 * The wave index is bounded to 1-3 digits (0-999) so a malformed or
 * malicious marker cannot trigger pathological regex backtracking on
 * unbounded `\d+`.
 */

export const WAVE_MARKER_RE = /^wave-([0-9]{1,3})-(start|end)$/;

/**
 * Parse a wave-marker string into its components.
 *
 * @param {string} s
 * @returns {{ index: number, phase: 'start' | 'end' } | null}
 *   `null` for any input that is not a string or does not match
 *   {@link WAVE_MARKER_RE}.
 */
export function parseWaveMarker(s) {
  if (typeof s !== 'string') return null;
  const m = WAVE_MARKER_RE.exec(s);
  if (!m) return null;
  return { index: Number(m[1]), phase: m[2] };
}
