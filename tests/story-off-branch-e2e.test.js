/**
 * Off-branch end-to-end regression tests (Story #676 / Task #687).
 *
 * Exercises the worktreeIsolation=false codepath through the checkpoints the
 * task description calls out as "must-not-regress":
 *
 *   1. Both routes onto the off-branch resolve to worktreeEnabled=false with
 *      the right provenance — the AP_WORKTREE_ENABLED env override and the
 *      CLAUDE_CODE_REMOTE auto-detect.
 *   2. WorktreeManager lifecycle methods short-circuit with no fs/git calls
 *      when constructed with `enabled: false`.
 *
 * A third checkpoint over the Epic-era post-merge `worktreeReapPhase` was
 * dropped in Story #4545 along with that phase directory — it had no
 * production importer, so the test was the module's only caller.
 *
 * A fourth case once claimed to hold a "regression baseline" of the operator
 * log shape against `tests/fixtures/off-branch-baseline.md`. It never
 * compared anything: it built a Set of expected prefixes and asserted only
 * that the Set was non-empty, and the fixture it named had no reader. Both
 * were deleted — the tokens were retired v1 vocabulary (`[CONTEXT] Epic:`,
 * `[TASKS] Found`) describing a log surface the v2 cutover replaced. The
 * cases below are what actually exercise the off-branch path. See ADR
 * 20260424-668a in `docs/decisions.md`; do not restore a log-shape
 * assertion without a real capture-and-compare behind it.
 *
 * The tests do not require a real GitHub provider or a live git repo; mocks
 * isolate the branch under test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntime } from '../.agents/scripts/lib/config-resolver.js';
import { WorktreeManager } from '../.agents/scripts/lib/worktree-manager.js';

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

function makeFailingGit() {
  const fail = (_cwd, ...args) => {
    throw new Error(
      `git unexpectedly invoked when worktree isolation is disabled: ${args.join(' ')}`,
    );
  };
  return { gitSync: fail, gitSpawn: fail };
}

test('off-branch e2e: AP_WORKTREE_ENABLED=false routes through resolveRuntime as env-override', () => {
  const runtime = resolveRuntime(
    { config: { delivery: { worktreeIsolation: { enabled: true } } } },
    { AP_WORKTREE_ENABLED: 'false' },
  );
  assert.equal(runtime.worktreeEnabled, false);
  assert.equal(runtime.worktreeEnabledSource, 'env-override');
  assert.equal(runtime.isRemote, false);
});

test('off-branch e2e: CLAUDE_CODE_REMOTE auto-detect lands at worktreeEnabled=false', () => {
  const runtime = resolveRuntime(
    { config: { delivery: { worktreeIsolation: { enabled: true } } } },
    { CLAUDE_CODE_REMOTE: 'true' },
  );
  assert.equal(runtime.worktreeEnabled, false);
  assert.equal(runtime.worktreeEnabledSource, 'remote-auto');
  assert.equal(runtime.isRemote, true);
});

test('off-branch e2e: WorktreeManager lifecycle methods perform zero git/fs work when disabled', () => {
  const wm = new WorktreeManager({
    repoRoot: process.cwd(),
    config: { enabled: false },
    logger: SILENT_LOGGER,
    git: makeFailingGit(),
  });

  // ensure / reap / gc / sweepStaleLocks must all return without invoking
  // the failing git adapter, which throws if touched.
  assert.deepEqual(wm.ensure(101, 'story-101'), {
    path: null,
    created: false,
    skipped: true,
    reason: 'isolation-disabled',
  });
  assert.deepEqual(wm.reap(101, { epicBranch: 'epic/100' }), {
    removed: false,
    skipped: true,
    reason: 'isolation-disabled',
    path: null,
  });
  assert.deepEqual(wm.gc([101], { epicBranch: 'epic/100' }), {
    reaped: [],
    skipped: [],
    skippedReason: 'isolation-disabled',
  });
  assert.deepEqual(wm.sweepStaleLocks({ maxAgeMs: 1 }), {
    removed: [],
    skipped: [],
    skippedReason: 'isolation-disabled',
  });
});
