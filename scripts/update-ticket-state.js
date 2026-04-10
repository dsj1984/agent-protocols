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
      const config = resolveConfig();
      const provider = createProvider(config.orchestration);
      await transitionTicketState(provider, taskId, state);

      if (state === STATE_LABELS.DONE) {
        console.log(`[State-Sync] Cascading completion from #${taskId}...`);
        await cascadeCompletion(provider, taskId);
      }

      console.log('[State-Sync] ✅ Success');
    } catch (err) {
      Logger.fatal(err.message);
    }
  })();
}
