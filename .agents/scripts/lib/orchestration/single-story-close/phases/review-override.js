/**
 * phases/review-override.js — the sanctioned, logged override of a Story-scope
 * code-review critical blocker.
 *
 * Split out of `phases/review-block.js`, which owns the opposite outcome: the
 * blocker that *holds*. Keeping the two in one module meant one file owning
 * both "park this Story" and "ship it anyway", and the override's audit trail is
 * substantial enough — three write surfaces, each independently best-effort —
 * to be its own reason to change.
 *
 * **Why an override exists at all.** A critical review finding halts
 * `single-story-close.js` before auto-merge, and no flag overrode a review
 * verdict: `--skip-validation` bypasses the gate chain and `--no-auto-merge`
 * declines to arm, but neither touches the review. So an operator who had read a
 * finding and judged it wrong could only land by merging the PR by hand, which
 * bypasses the gate with no record anywhere of what was overridden or why. This
 * module does not weaken the gate; it relocates that escape hatch out of an
 * untraceable hand-merge and into a mandatory-reason audit trail.
 *
 * Live provenance: Story #5007 / PR #5022, where a FALSE critical blocker — an
 * MI finding on files `delivery.quality.gates.maintainability.ignoreGlobs`
 * exempts, which the `check-baselines.js` ratchet correctly ignored in the same
 * run — halted a legitimate delivery with a hand-merge as the only way out.
 */

import { Logger } from '../../../Logger.js';
import {
  emitRuntimeFriction,
  RUNTIME_FRICTION_CATEGORIES,
} from '../../../observability/runtime-friction.js';
import {
  postStructuredComment,
  upsertStructuredComment,
} from '../../ticketing.js';

/** Cap on the reason text copied into the friction signal's `details`. */
const REASON_SIGNAL_LIMIT = 500;

/**
 * Build the audit record posted when an operator overrides a review blocker.
 * Pure.
 *
 * The body restates the count, the reason, and the fact that auto-merge was
 * armed anyway — an override whose trail says only "overridden" is no better
 * than the hand-merge it replaces.
 *
 * Module-local: an implementation detail of
 * {@link handleOverriddenReviewBlock}, whose posted body is observable through
 * that public entry point. Exporting it would add a public symbol no production
 * path reaches — the exact dead-export shape this repo ratchets against.
 *
 * @param {{ prUrl: string, criticalCount: number, reason: string }} args
 * @returns {string}
 */
function buildReviewOverrideBody({ prUrl, criticalCount, reason }) {
  return [
    '### Code-review blocker overridden by operator',
    '',
    `The Story-scope review reported **${criticalCount} critical blocker(s)** on ${prUrl}.`,
    'The operator reviewed and rejected the finding(s) and authorized delivery',
    'with `--override-review-block`; auto-merge was armed.',
    '',
    '**Recorded reason:**',
    '',
    `> ${reason.split('\n').join('\n> ')}`,
    '',
    'The findings comment on the PR is left in place unchanged — this record',
    'sits beside it rather than resolving it.',
  ].join('\n');
}

/**
 * Post one audit record, swallowing the failure into a warning.
 *
 * Every write here is best-effort by design: an override whose audit trail
 * partly failed must still land the delivery the operator authorized, because
 * the close would otherwise fail for a reason the operator cannot act on. The
 * friction signal is the durable record — it is what makes a rising override
 * count visible to the retro.
 *
 * Module-local: the two call sites below are its only callers.
 *
 * @param {{ post: () => Promise<unknown>, surface: string }} args
 * @returns {Promise<boolean>} true when the record landed.
 */
async function postAuditRecord({ post, surface }) {
  try {
    await post();
    return true;
  } catch (err) {
    Logger.warn(
      `[single-story-close] failed to post review-override record on ${surface}: ${err?.message ?? err}`,
    );
    return false;
  }
}

/**
 * Record an operator-authorized override of a critical code-review blocker,
 * then let close continue to the auto-merge phase.
 *
 * Writes to three surfaces: the Story issue via `upsert` so a re-run does not
 * stack duplicates; the PR via `post` so the trail is append-only on the surface
 * a human reviews, and so a reviewer reading the PR need not open the Story to
 * learn the blocker was overridden; and the friction stream.
 *
 * @param {{
 *   provider: object,
 *   storyId: number,
 *   prUrl: string,
 *   prNumber: number|null,
 *   criticalCount: number,
 *   reason: string,
 *   config?: object,
 *   emitFrictionFn?: typeof emitRuntimeFriction,
 * }} args
 * @returns {Promise<{ overridden: true, reason: string, criticalCount: number }>}
 */
export async function handleOverriddenReviewBlock({
  provider,
  storyId,
  prUrl,
  prNumber,
  criticalCount,
  reason,
  config,
  emitFrictionFn = emitRuntimeFriction,
}) {
  const body = buildReviewOverrideBody({ prUrl, criticalCount, reason });
  Logger.warn(
    `[single-story-close] ⚠️ Story-scope review reported ${criticalCount} critical blocker(s) on ` +
      `PR ${prUrl} — OVERRIDDEN by operator: ${reason}`,
  );
  await postAuditRecord({
    post: () => upsertStructuredComment(provider, storyId, 'friction', body),
    surface: `Story #${storyId}`,
  });
  if (Number.isInteger(prNumber)) {
    await postAuditRecord({
      post: () =>
        postStructuredComment(provider, prNumber, 'notification', body),
      surface: `PR #${prNumber}`,
    });
  }
  await emitFrictionFn({
    storyId,
    category: RUNTIME_FRICTION_CATEGORIES.REVIEW_BLOCK_OVERRIDDEN,
    tool: 'single-story-close',
    details: {
      prUrl,
      criticalCount,
      reason: reason.slice(0, REASON_SIGNAL_LIMIT),
    },
    config,
  });
  return { overridden: true, reason, criticalCount };
}
