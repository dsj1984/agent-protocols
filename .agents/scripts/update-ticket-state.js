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
  cascadeCompletion,
  STATE_LABELS,
  transitionTicketState,
} from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

// ── CLI Main Block ────────────────────────────────────────────────────────
if (
  process.argv[1]?.endsWith('update-ticket-state.js') ||
  process.env.DEBUG_MAIN
) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      task: { type: 'string' },
      ticket: { type: 'string' },
      state: { type: 'string' },
      'remove-label': { type: 'string' },
    },
    strict: false,
  });

  // `--ticket` is the v5.9.0 alias for `--task` (labels can apply to any
  // ticket type, not just Tasks). Both continue to work.
  const idSource = values.ticket ?? values.task;
  const ticketId = Number.parseInt(idSource, 10);
  const state = values.state;
  const removeLabel = values['remove-label'];

  if (Number.isNaN(ticketId) || (!state && !removeLabel)) {
    Logger.fatal(
      'Usage: node update-ticket-state.js ' +
        '(--ticket|--task) <id> ' +
        '[--state <state> | --remove-label <label>]',
    );
  }

  (async () => {
    try {
      const config = resolveConfig();
      const provider = createProvider(config.orchestration);

      // Label-only mutation path — no state transition. Used by the
      // risk::high auto-merge protocol in /sprint-execute.
      if (removeLabel && !state) {
        console.log(
          `[State-Sync] Removing label \`${removeLabel}\` from ticket #${ticketId}...`,
        );
        await provider.updateTicket(ticketId, {
          labels: { remove: [removeLabel] },
        });
        console.log('[State-Sync] ✅ Success');
        return;
      }

      console.log(
        `[State-Sync] Transitioning ticket #${ticketId} to ${state}...`,
      );
      await transitionTicketState(provider, ticketId, state);

      if (state === STATE_LABELS.DONE) {
        console.log(`[State-Sync] Cascading completion from #${ticketId}...`);
        await cascadeCompletion(provider, ticketId);
      }

      // Optional secondary label removal alongside the state transition
      // (e.g. clear `status::blocked` when transitioning back to ready).
      if (removeLabel) {
        await provider.updateTicket(ticketId, {
          labels: { remove: [removeLabel] },
        });
      }

      console.log('[State-Sync] ✅ Success');
    } catch (err) {
      Logger.fatal(err.message);
    }
  })();
}
