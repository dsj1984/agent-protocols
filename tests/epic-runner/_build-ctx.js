/**
 * Shared test factory — builds an `EpicRunnerContext` with sensible defaults
 * for the epic-runner unit + integration suite. Tests pass overrides for the
 * fields they exercise (e.g. a custom `spawn`, a fake `provider`).
 */

import { EpicRunnerContext } from '../../.agents/scripts/lib/orchestration/context.js';

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

export function buildCtx(overrides = {}) {
  const defaults = {
    epicId: 321,
    provider: {},
    config: {
      epicRunner: {
        enabled: true,
        concurrencyCap: 2,
        pollIntervalSec: 1,
        storyRetryCount: 0,
        blockerTimeoutHours: 0,
      },
    },
    spawn: async () => ({ status: 'done' }),
    logger: quietLogger(),
  };
  return new EpicRunnerContext({ ...defaults, ...overrides });
}
