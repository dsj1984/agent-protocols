/**
 * epic-grouping-directive.js — the container-Epic directive an audit sweep
 * emits (Story #5139).
 *
 * Lives on its own because **both** `/audit-to-stories` output paths carry it:
 * the `/mandrel-plan` seed one-pager (`seed-from-findings.js`) and the
 * standalone Story-draft transcript (`audit-to-stories.js`). A sweep is the
 * clearest case for a container — every Story shares a provenance and the
 * operator almost always wants them delivered together — so the Epic is the
 * **default** here, unlike the offer `/mandrel-plan` makes on an ad-hoc plan.
 *
 * It stays a directive in the text rather than an automatic write: the
 * workflow's Phase 4 HITL stop is where an operator declines it.
 *
 * @module lib/audit-to-stories/epic-grouping-directive
 */

import { EPIC_SUGGESTION_THRESHOLD } from '../orchestration/plan-persist/epic-ops.js';

/**
 * Render the grouping directive for a proposed Story set.
 *
 * @param {unknown[]} groups The proposed Stories (only the count is read).
 * @returns {string} Markdown paragraph(s).
 */
export function formatEpicGrouping(groups) {
  const count = Array.isArray(groups) ? groups.length : 0;
  if (count < EPIC_SUGGESTION_THRESHOLD) {
    const noun = count === 1 ? 'Story' : 'Stories';
    return `This sweep proposes ${count} ${noun} — below the ${EPIC_SUGGESTION_THRESHOLD}-Story threshold, so no container Epic is needed.`;
  }
  return [
    `**Group these under a container Epic.** This sweep proposes ${count} Stories from one audit pass, which is exactly the case a container earns: they share a provenance and an operator will want to deliver them as a unit.`,
    '',
    'The Epic is a **pure container** — a title, a one-paragraph goal, and the child checklist. It must carry no finding, no path and no rationale that is not already in a child Story, or that information ends up somewhere no delivering agent reads.',
    '',
    'Decline it and file the Stories flat if the operator prefers.',
  ].join('\n');
}
