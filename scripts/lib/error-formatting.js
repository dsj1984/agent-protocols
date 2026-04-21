/**
 * Centralized error-message formatting for consistent logs across scripts.
 *
 * All call-sites should prefer `formatError(err)` over hand-rolled
 * `err?.message ?? String(err)`. Wrapping in `logNonfatalError` gives the
 * standard `[<context>] ... (non-fatal): <message>` log envelope used by
 * phase-style scripts (sprint-story-close, dispatch-engine, etc.).
 */

import { Logger } from './Logger.js';

export function formatError(err) {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message ?? String(err);
}

export function logNonfatalError(context, err) {
  Logger.error(
    `[${context}] operation failed (non-fatal): ${formatError(err)}`,
  );
}
