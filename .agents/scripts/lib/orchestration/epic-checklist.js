/**
 * epic-checklist.js — edit a live Epic body's child checklist in place.
 *
 * Story #5155. `epic-container.js` describes the *shape* of a container and
 * renders one from scratch; this module is the other operation adoption needs
 * — amending a body that already exists, written by someone else, possibly
 * hand-edited since.
 *
 * The two are deliberately separate. Composing may assume everything about the
 * text because it produced all of it; amending may assume almost nothing and
 * must treat every line it did not come to change as untouchable: the `## Goal`
 * prose, the fingerprint marker, the item order, and above all the **checked
 * state** of existing rows. An operator who ticked `- [x] #41` is recording
 * that the Story landed, and a re-render would silently discard it.
 *
 * So the edit is a surgical line insertion rather than a re-render.
 *
 * @module lib/orchestration/epic-checklist
 * @see Story #5155
 */

import {
  CHECKLIST_ITEM_LINE_RE,
  CHILDREN_HEADING,
  NO_CHILDREN_PLACEHOLDER,
  normalizeChildIds,
  readEpicChildIds,
} from './epic-container.js';

/**
 * Index of the last `- [ ] #N` row in a body's lines, or -1.
 *
 * @param {string[]} lines
 * @returns {number}
 */
function findLastChecklistIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CHECKLIST_ITEM_LINE_RE.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Where the new rows go, as a `[index, deleteCount]` splice target.
 *
 * Three placements, in priority order, each preserving a different thing:
 * replacing the empty-container placeholder (which would otherwise stand above
 * rows that contradict it), appending after the last existing row (which keeps
 * original-then-appended order on read-back), or opening the section for a body
 * that never had one.
 *
 * @param {string[]} lines
 * @returns {[number, number]|null} `null` when there is no section to extend.
 */
function locateInsertion(lines) {
  const placeholderAt = lines.findIndex(
    (line) => line.trim() === NO_CHILDREN_PLACEHOLDER,
  );
  if (placeholderAt !== -1) return [placeholderAt, 1];

  const lastItemAt = findLastChecklistIndex(lines);
  if (lastItemAt !== -1) return [lastItemAt + 1, 0];

  const headingAt = lines.findIndex((line) => line.trim() === CHILDREN_HEADING);
  if (headingAt === -1) return null;
  // Keep the blank line a composed body puts under the heading.
  const blank = lines[headingAt + 1]?.trim() === '' ? 1 : 0;
  return [headingAt + 1 + blank, 0];
}

/**
 * Append child ids to an existing Epic body's checklist, idempotently.
 *
 * Idempotence is the load-bearing property: a resumed or re-run persist calls
 * this again with the same cohort, and a second copy of every row would make
 * the container claim children it does not have.
 *
 * @param {string} body The Epic's current body.
 * @param {number[]} childIds Ids to add.
 * @returns {string} The updated body (byte-identical when nothing was added).
 */
export function appendEpicChildIds(body, childIds) {
  const text = typeof body === 'string' ? body : '';
  const existing = new Set(readEpicChildIds(text));
  const additions = normalizeChildIds(childIds).filter(
    (id) => !existing.has(id),
  );
  if (additions.length === 0) return text;

  const rows = additions.map((id) => `- [ ] #${id}`);
  const lines = text.split('\n');
  const target = locateInsertion(lines);

  if (target === null) {
    // A hand-written or foreign Epic with no checklist section. Add one rather
    // than refusing: `isEpicTicket` already treats such a ticket as a real
    // Epic, so the adoption must not be the one place that disagrees.
    return `${text.replace(/\n+$/, '')}\n\n${CHILDREN_HEADING}\n\n${rows.join('\n')}\n`;
  }

  lines.splice(target[0], target[1], ...rows);
  return lines.join('\n');
}
