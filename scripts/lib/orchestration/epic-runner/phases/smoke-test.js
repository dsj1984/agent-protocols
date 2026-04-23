/**
 * Pre-wave spawn smoke-test phase.
 *
 * Runs `claude --version` through `SpawnSmokeTest` before any Story
 * dispatches. A broken spawner (the Epic #380 regression class) halts the
 * runner here with a `halted` state instead of producing a false-positive
 * wave.
 */

import { AGENT_LABELS } from '../../../label-constants.js';
import { SpawnSmokeTest } from '../spawn-smoke-test.js';
import { STATE_LABELS, upsertStructuredComment } from '../../ticketing.js';

export async function runSmokeTestPhase(ctx, collaborators, state) {
  const { epicId, provider, logger } = ctx;
  const journal = collaborators.journal ?? ctx.errorJournal;
  const journalSuffix = () => (journal?.path ? ` (see ${journal.path})` : '');

  const smokeTest = collaborators.smokeTest ?? new SpawnSmokeTest({ ctx });
  const smoke = await smokeTest.verify();
  if (smoke.ok) {
    return { ...state, smoke };
  }

  const body = [
    '### 🚧 Epic blocked — pre-wave spawn smoke-test failed',
    '',
    `The \`claude --version\` probe returned: \`${smoke.detail}\`.`,
    '',
    'No wave was dispatched. Fix the spawner regression, then flip this',
    'Epic back to `agent::executing` to resume.',
  ].join('\n');
  try {
    await upsertStructuredComment(provider, epicId, 'friction', body);
  } catch (err) {
    logger.warn?.(
      `[EpicRunner] smoke-test friction comment failed: ${err.message}${journalSuffix()}`,
    );
    await journal?.record({
      module: 'EpicRunner',
      op: 'upsertStructuredComment(friction, spawn-smoke-test)',
      error: err,
      recovery: 'swallowed',
    });
  }
  try {
    await provider.updateTicket(epicId, {
      labels: {
        add: [AGENT_LABELS.BLOCKED],
        remove: [STATE_LABELS.EXECUTING],
      },
    });
  } catch (err) {
    logger.warn?.(
      `[EpicRunner] smoke-test block-flip failed: ${err.message}${journalSuffix()}`,
    );
    await journal?.record({
      module: 'EpicRunner',
      op: 'updateTicket(labels: agent::blocked) [smoke-test]',
      error: err,
      recovery: 'swallowed',
    });
  }
  await journal?.finalize?.();

  return {
    ...state,
    smoke,
    halted: {
      epicId,
      state: 'halted',
      waveHistory: [],
      bookendResult: null,
      aborted: 'spawn-smoke-test',
      smokeTest: smoke,
    },
  };
}
