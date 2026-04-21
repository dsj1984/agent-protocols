/**
 * Legacy task-level `risk::high` HITL gate — **retired** for the epic-runner
 * flow.
 *
 * Historical behavior: this module held `risk::high` tasks for operator
 * approval at dispatch time. In the epic-runner model (tech spec #323) the
 * gate is removed from the runtime execution path — branch protection,
 * executor sub-agent escalation, and the `epic::auto-close` opt-in provide
 * the defenses instead. The label remains queryable for retro metrics.
 *
 * The function signature is preserved to minimize churn across callers and
 * pinning tools, but the behavior is now log-only:
 *   - logs a warning when a task carries `risk::high`
 *   - never posts a HITL approval comment
 *   - always returns `null` so callers skip the held-for-approval list
 *
 * Callers that still want the old behavior should invoke the shared
 * `postHitlGateNotification` from `lib/risk-gate.js` directly.
 */

import { RISK_HIGH_LABEL } from '../risk-gate.js';
import { vlog } from './dispatch-logger.js';

/**
 * Log-only warning for a `risk::high` task. Returns `null` — the task is
 * **never** held for approval in the new model.
 *
 * @param {object} task
 * @param {object} _provider
 * @param {boolean} _dryRun
 * @returns {Promise<null>}
 */
export async function handleRiskHighGate(task, _provider, _dryRun) {
  vlog.info(
    'orchestration',
    `⚠️  Task #${task.id} carries ${RISK_HIGH_LABEL} — dispatching anyway ` +
      '(runtime gate retired per tech spec #323; label preserved for metrics).',
  );
  return null;
}
