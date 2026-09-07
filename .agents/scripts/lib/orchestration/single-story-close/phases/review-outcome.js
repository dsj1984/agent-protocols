/**
 * phases/review-outcome.js — operator-facing rendering of the Story-scope
 * review outcome (Story #4839).
 *
 * The review phase used to report a severity tally and nothing else, which made
 * "every gate ran and found nothing" and "a gate never ran" render identically.
 * Both surfaces the operator actually reads — the close progress stream and the
 * cross-reference comment on the Story — now state the degraded gates
 * explicitly, and always state them (as `none` when healthy) so an absent line
 * can never be mistaken for a clean gate.
 *
 * A degraded gate is **reported, not blocking**: this review is a secondary
 * read, and the close does not gate the merge on it. The rationale for that
 * posture lives with the channel itself in
 * [`review-providers/degraded-gates.js`](../../review-providers/degraded-gates.js).
 *
 * What this module must **not** do (Story #5193) is tell the operator that the
 * canonical `npm run lint` close gate covered the surface instead. A stub
 * `lint` script is a supported consumer shape, so that claim is unverifiable
 * from here — and asserting it talks the operator out of the exact concern the
 * degradation was raised to surface. State the posture; never vouch for
 * coverage this module cannot see.
 */

import { summarizeDegradations } from '../../review-providers/degraded-gates.js';

/**
 * Pure: the tally suffix shared by the progress line and the cross-reference
 * comment — severity counts plus the degraded-gate state.
 *
 * @param {{ severity: { critical: number, high: number, medium: number, suggestion: number }, degradations?: unknown }} args
 * @returns {string}
 */
export function buildOutcomeTally({ severity, degradations }) {
  return (
    `critical:${severity.critical} · high:${severity.high} · ` +
    `medium:${severity.medium} · suggestion:${severity.suggestion} · ` +
    `degraded gates: ${summarizeDegradations(degradations)}`
  );
}

/**
 * Pure: the progress lines announcing a completed review. Always one line
 * naming the tally; a second, explicitly-worded line when a gate did not run so
 * the degradation cannot be skimmed past.
 *
 * @param {{
 *   severity: { critical: number, high: number, medium: number, suggestion: number },
 *   degradations?: unknown,
 *   prNumber: number,
 *   posted: boolean,
 * }} args
 * @returns {string[]}
 */
export function formatReviewOutcomeLines({
  severity,
  degradations,
  prNumber,
  posted,
}) {
  const tally = buildOutcomeTally({ severity, degradations });
  const lines = [`Findings — ${tally}. Posted to PR #${prNumber}: ${posted}.`];
  if (summarizeDegradations(degradations) !== 'none') {
    lines.push(
      '⚠️ Review ran DEGRADED — the surface(s) above were not reviewed. The close ' +
        'is not blocked — a secondary review does not gate the merge — but ' +
        'nothing here vouches for those surfaces.',
    );
  }
  return lines;
}
