/**
 * Task-level `risk::high` HITL gate. Composes `lib/risk-gate.js` so the
 * dispatcher and `sprint-story-close` stay in lock-step on the notification
 * path, but owns the task-specific comment body.
 */

import { postHitlGateNotification, RISK_HIGH_LABEL } from '../risk-gate.js';
import { vlog } from './dispatch-logger.js';

/**
 * Handle the `risk::high` approval gate for a single task. Posts a HITL
 * approval comment (skipped in dry-run) and returns the held-for-approval
 * entry the caller should record on the dispatch manifest.
 *
 * @param {object} task
 * @param {object} provider
 * @param {boolean} dryRun
 * @returns {Promise<{ taskId: number, reason: string }>}
 */
export async function handleRiskHighGate(task, provider, dryRun) {
  vlog.info(
    'orchestration',
    `⚠️  Task #${task.id} flagged ${RISK_HIGH_LABEL} — held for approval.`,
  );
  if (!dryRun) {
    await provider.postComment(task.id, {
      body: `⚠️ **HITL Gate**: This task is flagged \`${RISK_HIGH_LABEL}\` and requires operator approval before dispatch.\n\nTo approve, reply with: \`/approve ${task.id}\``,
      type: 'notification',
    });
    // Use the shared HITL helper so the dispatch and story-close gates stay in
    // lock-step. We forward failures into the verbose log rather than the
    // shared Logger to preserve the existing dispatcher trace format.
    await postHitlGateNotification(
      task.id,
      `HITL gate: Task #${task.id} is ${RISK_HIGH_LABEL} and held for ` +
        `operator approval. Reply \`/approve ${task.id}\` to dispatch.`,
      'action',
      {
        warn: (msg) =>
          vlog.info(
            'orchestration',
            `[${RISK_HIGH_LABEL}] ${msg.replace(/^\[risk-gate\] /, '')}`,
          ),
      },
    );
  }
  return {
    taskId: task.id,
    reason: `${RISK_HIGH_LABEL} label requires operator approval.`,
  };
}
