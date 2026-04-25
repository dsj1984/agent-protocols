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
 *
 * Defaults to `high` severity — HITL gates always require operator action.
 * The message body is automatically prefixed with `🚨 Action Required:` so
 * the GitHub comment mirrors the `[Action Required]` webhook prefix.
 *
 * @param {number} ticketId
 * @param {string} message
 * @param {'low'|'medium'|'high'} [severity]
 * @param {object} [logger] optional logger with `.warn(...)`; defaults to Logger
 */
export async function postHitlGateNotification(
  ticketId,
  message,
  severity = 'high',
  logger = Logger,
) {
  try {
    const decorated =
      severity === 'high' && !/^🚨\s*Action Required:/.test(message)
        ? `🚨 Action Required: ${message}`
        : message;
    await notify(ticketId, { severity, message: decorated });
  } catch (err) {
    logger.warn?.(
      `[risk-gate] HITL webhook/mention failed (non-fatal): ${formatError(err)}`,
    );
  }
}
