/**
 * Shared HITL (Human-In-The-Loop) notification helper.
 *
 * Originally part of the `risk::high` approval gate (now retired). The
 * `postHitlGateNotification` helper is retained as a generic best-effort
 * webhook/mention wrapper for any future HITL pause point.
 */

import { notify } from '../notify.js';
import { formatError } from './error-formatting.js';
import { Logger } from './Logger.js';

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
