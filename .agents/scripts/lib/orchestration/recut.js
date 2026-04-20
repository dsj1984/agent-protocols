/**
 * Recut markers track when a Story is carved off mid-sprint from another
 * Story that is already in the dispatch manifest. The marker is an HTML
 * comment embedded in the new Story's body:
 *
 *     <!-- recut-of: #641 -->
 *
 * Downstream consumers (the wave-completeness gate, the sprint retro)
 * read the marker to attribute the new Story back to its ancestor so
 * counts line up with the frozen manifest.
 */

const MARKER_RE = /<!--\s*recut-of:\s*#?(\d+)\s*-->/i;

/**
 * Parse a recut marker out of a Story body.
 *
 * @param {string | null | undefined} body
 * @returns {{ parentStoryId: number, raw: string } | null}
 */
export function parseRecutMarker(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(MARKER_RE);
  if (!match) return null;
  return { parentStoryId: Number.parseInt(match[1], 10), raw: match[0] };
}

/**
 * Format a recut marker for a given parent Story ID.
 *
 * @param {number} parentStoryId
 * @returns {string}
 */
export function formatRecutMarker(parentStoryId) {
  return `<!-- recut-of: #${parentStoryId} -->`;
}

/**
 * Return a body with the recut marker present. Replaces any existing
 * marker so the parent reference is always up to date; appends a fresh
 * marker when none is present.
 *
 * @param {string | null | undefined} body
 * @param {number} parentStoryId
 * @returns {string}
 */
export function injectRecutMarker(body, parentStoryId) {
  const marker = formatRecutMarker(parentStoryId);
  const existing = parseRecutMarker(body);
  if (existing) {
    if (existing.parentStoryId === parentStoryId) return body ?? '';
    return (body ?? '').replace(MARKER_RE, marker);
  }
  const trimmed = (body ?? '').replace(/\s+$/, '');
  return trimmed.length > 0 ? `${trimmed}\n\n${marker}\n` : `${marker}\n`;
}
