/**
 * Shared helpers for the `risk::high` HITL (Human-In-The-Loop) approval gate.
 *
 * Two call-sites invoke the gate with slightly different UX:
 *   - `dispatch-engine` — a task is about to be dispatched; the gate posts a
 *     ticket comment and returns a `heldForApproval` record.
 *   - `sprint-story-close` — a story is about to be merged; the gate prints an
 *     operator prompt to stderr and returns a `paused-for-approval` result.
 *
 * The actual comment/log copy differs between the two paths, but both need the
 * same best-effort HITL webhook notification. This module owns that notify
 * call so the two sites stay in lock-step.
 */

import { notify } from '../notify.js';
import { formatError } from './error-formatting.js';
import { Logger } from './Logger.js';
import { RISK_LABELS } from './label-constants.js';

export const RISK_HIGH_LABEL = RISK_LABELS.HIGH;

export function isRiskHigh(ticket) {
  if (!ticket) return false;
  const labels = ticket.labels ?? [];
  return labels.includes(RISK_HIGH_LABEL);
}

/**
 * Best-effort HITL webhook/mention notification. Non-fatal on failure.
 * @param {number} ticketId
 * @param {string} message
 * @param {'action'|'notification'} [type]
 * @param {object} [logger] optional logger with `.warn(...)`; defaults to Logger
 */
export async function postHitlGateNotification(
  ticketId,
  message,
  type = 'action',
  logger = Logger,
) {
  try {
    await notify(ticketId, { type, message });
  } catch (err) {
    logger.warn?.(
      `[risk-gate] HITL webhook/mention failed (non-fatal): ${formatError(err)}`,
    );
  }
}
