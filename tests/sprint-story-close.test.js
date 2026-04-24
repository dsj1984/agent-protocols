import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import {
  drainPendingCleanupAfterClose,
  reconcileCleanupState,
} from '../.agents/scripts/sprint-story-close.js';
import {
  DEFAULT_GATES,
  runCloseValidation as runCloseValidationOnly,
} from '../.agents/scripts/lib/close-validation.js';

const SCRIPT_PATH = path.resolve('.agents/scripts/sprint-story-close.js');

test('sprint-story-close script', async (t) => {
  await t.test('fails without --story argument', () => {
    const result = spawnSync('node', [SCRIPT_PATH]);
    assert.strictEqual(result.status, 1);
    assert.match(
      result.stderr.toString() + result.stdout.toString(),
      /Usage: node sprint-story-close\.js --story <STORY_ID>/,
    );
  });
});

test('runCloseValidation', async (t) => {
  await t.test(
    'DEFAULT_GATES covers lint, test, biome format, and maintainability',
    () => {
      const names = DEFAULT_GATES.map((g) => g.name);
      assert.ok(names.includes('lint'));
      assert.ok(names.includes('test'));
      assert.ok(names.some((n) => n.includes('biome format')));
      assert.ok(names.some((n) => n.includes('maintainability')));
    },
  );

  await t.test('biome format gate surfaces the --write hint', () => {
    const gate = DEFAULT_GATES.find((g) => g.name.includes('biome format'));
    assert.match(gate.hint, /biome format --write/);
  });

  await t.test('maintainability gate surfaces the update-baseline hint', () => {
    const gate = DEFAULT_GATES.find((g) => g.name.includes('maintainability'));
    assert.match(gate.hint, /maintainability:update/);
    assert.match(gate.hint, /commit/i);
  });

  await t.test('returns ok when every gate exits 0', () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0 };
    };
    const gates = [
      { name: 'a', cmd: 'a', args: [] },
      { name: 'b', cmd: 'b', args: [] },
    ];
    const result = runCloseValidationOnly({ cwd: '.', gates, runner });
    assert.deepEqual(result, { ok: true, failed: [] });
    assert.equal(calls.length, 2);
  });

  await t.test('stops and reports on first non-zero gate', () => {
    const runner = (cmd) => ({ status: cmd === 'a' ? 0 : 3 });
    const gates = [
      { name: 'a', cmd: 'a', args: [] },
      { name: 'b', cmd: 'b', args: [], hint: 'fix it' },
      { name: 'c', cmd: 'c', args: [] },
    ];
    const logs = [];
    const result = runCloseValidationOnly({
      cwd: '.',
      gates,
      runner,
      log: (m) => logs.push(m),
    });
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].gate.name, 'b');
    assert.equal(result.failed[0].status, 3);
    assert.ok(logs.some((m) => m.includes('hint: fix it')));
  });
});

test('reconcileCleanupState marks deferred worktree cleanup as removed-after-drain and updates branch deletion flags', () => {
  const result = reconcileCleanupState({
    storyId: 795,
    worktreeReap: {
      status: 'deferred-to-sweep',
      path: '/repo/.worktrees/story-795',
      pendingCleanup: { storyId: 795, branch: 'story-795' },
    },
    branchCleanup: {
      localDeleted: false,
      remoteDeleted: true,
      localReason: 'error',
      remoteReason: 'deleted',
    },
    pendingCleanupDrain: {
      drained: [795],
      drainedDetails: [
        {
          storyId: 795,
          path: '/repo/.worktrees/story-795',
          branch: 'story-795',
          localBranchDeleted: true,
          remoteBranchDeleted: true,
        },
      ],
      persistent: [],
      persistentDetails: [],
      stillPending: [],
      stillPendingDetails: [],
    },
  });
  assert.equal(result.worktreeReap.status, 'removed-after-drain');
  assert.equal(result.worktreeReap.closeDrainStatus, 'drained');
  assert.equal(result.worktreeReap.pendingCleanup, null);
  assert.equal(result.branchCleanup.localDeleted, true);
  assert.equal(result.branchCleanup.remoteDeleted, true);
});

test('reconcileCleanupState preserves deferred state when the close-time drain still cannot clear the lock', () => {
  const result = reconcileCleanupState({
    storyId: 795,
    worktreeReap: {
      status: 'deferred-to-sweep',
      path: '/repo/.worktrees/story-795',
      pendingCleanup: { storyId: 795, branch: 'story-795' },
    },
    branchCleanup: {
      localDeleted: false,
      remoteDeleted: true,
      localReason: 'error',
      remoteReason: 'deleted',
    },
    pendingCleanupDrain: {
      drained: [],
      drainedDetails: [],
      persistent: [],
      persistentDetails: [],
      stillPending: [795],
      stillPendingDetails: [{ storyId: 795 }],
    },
  });
  assert.equal(result.worktreeReap.status, 'deferred-to-sweep');
  assert.equal(result.worktreeReap.closeDrainStatus, 'still-pending');
  assert.equal(result.branchCleanup.localDeleted, false);
  assert.equal(result.branchCleanup.remoteDeleted, true);
});

test('drainPendingCleanupAfterClose returns null when worktree isolation is disabled', async () => {
  const res = await drainPendingCleanupAfterClose({
    repoRoot: '.',
    orchestration: { worktreeIsolation: { enabled: false } },
  });
  assert.equal(res, null);
});

test('drainPendingCleanupAfterClose reports the worktree root and drain summary', async () => {
  const events = [];
  const res = await drainPendingCleanupAfterClose({
    repoRoot: '/repo',
    orchestration: { worktreeIsolation: { enabled: true, root: '.worktrees' } },
    progress: (phase, msg) => events.push({ phase, msg }),
    drainFn: async () => ({
      drained: [795],
      drainedDetails: [{ storyId: 795, localBranchDeleted: true }],
      persistent: [],
      persistentDetails: [],
      stillPending: [],
      stillPendingDetails: [],
    }),
  });
  assert.equal(res.worktreeRoot, path.join('/repo', '.worktrees'));
  assert.deepEqual(res.drained, [795]);
  assert.ok(
    events.some(
      (e) =>
        e.phase === 'WORKTREE' && e.msg.includes('Pending cleanup drain: drained=1'),
    ),
  );
});
