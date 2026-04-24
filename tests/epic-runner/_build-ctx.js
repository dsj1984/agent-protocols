/**
 * Shared test factory — builds an `EpicRunnerContext` with sensible defaults
 * for the epic-runner unit + integration suite. Tests pass overrides for the
 * fields they exercise (e.g. a custom `spawn`, a fake `provider`).
 *
 * Webhook safety: the default `cwd` points at a nonexistent directory and
 * `fetchImpl` is a no-op stub, so `createNotifier` / `NotificationHook` in
 * the runner factory cannot resolve a real webhook URL from the repo's
 * `.mcp.json` or call the real `fetch`. Tests that exercise webhook delivery
 * must override both explicitly.
 */

import { EpicRunnerContext } from '../../.agents/scripts/lib/orchestration/context.js';

const WEBHOOK_SAFE_CWD = '/nonexistent-epic-runner-test-cwd';

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

async function stubFetch() {
  return { ok: true, status: 200 };
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
    cwd: WEBHOOK_SAFE_CWD,
    fetchImpl: stubFetch,
    // Default adapter returns a positive count so post-wave commit assertion
    // does not reclassify `done` stories in unrelated tests. Tests that
    // exercise the zero-delta path pass their own gitAdapter override.
    gitAdapter: async () => 1,
  };
  return new EpicRunnerContext({ ...defaults, ...overrides });
}
