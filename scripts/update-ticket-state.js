/**
 * .agents/scripts/update-ticket-state.js — CLI Re-export Shim
 *
 * Thin backward-compatibility shim. The core logic has been moved to
 * `lib/orchestration/ticketing.js` as part of the SDK refactor.
 *
 * This file preserves backward compatibility for CLI usage and existing
 * testing patterns.
 */

import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import {
  STATE_LABELS,
  cascadeCompletion as sdkCascadeCompletion,
  postStructuredComment as sdkPostStructuredComment,
  toggleTasklistCheckbox as sdkToggleTasklistCheckbox,
  transitionTicketState as sdkTransitionTicketState,
} from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

export { STATE_LABELS };

let cachedProvider = null;

export function getProvider() {
  if (cachedProvider) return cachedProvider;
  const config = resolveConfig();
  cachedProvider = createProvider(config.orchestration);
  return cachedProvider;
}

/**
 * Used for dependency injection during unit tests.
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 */
export function setProvider(provider) {
  cachedProvider = provider;
}

export function resetProvider() {
  cachedProvider = null;
}

export async function transitionTicketState(ticketId, newState) {
  return sdkTransitionTicketState(getProvider(), ticketId, newState);
}

export async function toggleTasklistCheckbox(ticketId, subIssueId, checked) {
  return sdkToggleTasklistCheckbox(
    getProvider(),
    ticketId,
    subIssueId,
    checked,
  );
}

export async function postStructuredComment(ticketId, type, payload) {
  return sdkPostStructuredComment(getProvider(), ticketId, type, payload);
}

export async function cascadeCompletion(ticketId) {
  return sdkCascadeCompletion(getProvider(), ticketId);
}

// ── CLI Main Block ────────────────────────────────────────────────────────
if (
  process.argv[1]?.endsWith('update-ticket-state.js') ||
  process.env.DEBUG_MAIN
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      task: { type: 'string' },
      state: { type: 'string' },
    },
  });

  const taskId = parseInt(values.task, 10);
  const state = values.state;

  if (Number.isNaN(taskId) || !state) {
    Logger.fatal();
  }

  (async () => {
    try {
      console.log(
        `[State-Sync] Transitioning ticket #${taskId} to ${state}...`,
      );
      await transitionTicketState(taskId, state);

      if (state === STATE_LABELS.DONE) {
        console.log(`[State-Sync] Cascading completion from #${taskId}...`);
        await cascadeCompletion(taskId);
      }

      console.log('[State-Sync] ✅ Success');
    } catch (_err) {
      Logger.fatal();
    }
  })();
}
