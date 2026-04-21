import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pathFor,
  removeWorktreeWithRecovery,
} from '../../../.agents/scripts/lib/worktree/lifecycle-manager.js';

function quietLogger() {
  const sink = { info: [], warn: [], error: [] };
  return {
    sink,
    logger: {
      info: (m) => sink.info.push(m),
      warn: (m) => sink.warn.push(m),
      error: (m) => sink.error.push(m),
    },
  };
}

test('pathFor: rejects invalid storyId', () => {
  assert.throws(
    () => pathFor({ worktreeRoot: '/repo/.worktrees' }, 'nope'),
    /invalid storyId/,
  );
});

test('pathFor: builds worktreeRoot + story-<id>', () => {
  const p = pathFor({ worktreeRoot: '/repo/.worktrees' }, 42);
  assert.ok(p.endsWith('story-42'));
});

test('removeWorktreeWithRecovery: treats prune-cleared registration as success', () => {
  const calls = [];
  const ctx = {
    repoRoot: '/repo',
    platform: 'win32',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: quietLogger().logger,
    git: {
      gitSpawn: (cwd, ...args) => {
        calls.push(args);
        // All `git worktree remove` invocations fail with a lock-like error.
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return {
            status: 1,
            stdout: '',
            stderr: 'Access is denied. sharing violation',
          };
        }
        // `git worktree prune` succeeds after removes fail.
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return { status: 0, stdout: '', stderr: '' };
        }
        // Post-prune `git worktree list --porcelain` shows the path cleared.
        if (
          args[0] === 'worktree' &&
          args[1] === 'list' &&
          args[2] === '--porcelain'
        ) {
          return { status: 0, stdout: 'worktree /repo\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  const res = removeWorktreeWithRecovery(ctx, '/repo/.worktrees/story-1');
  assert.equal(res.removed, true);
  assert.equal(res.registrationOnly, true);
});

test('removeWorktreeWithRecovery: reports failure when registration survives', () => {
  const ctx = {
    repoRoot: '/repo',
    platform: 'linux',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: quietLogger().logger,
    git: {
      gitSpawn: (cwd, ...args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return {
            status: 1,
            stdout: '',
            stderr: 'fatal: something unrecoverable',
          };
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (
          args[0] === 'worktree' &&
          args[1] === 'list' &&
          args[2] === '--porcelain'
        ) {
          // Still registered after prune — cannot recover.
          return {
            status: 0,
            stdout:
              'worktree /repo\n\nworktree /repo/.worktrees/story-2\nbranch refs/heads/story-2\n',
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  const res = removeWorktreeWithRecovery(ctx, '/repo/.worktrees/story-2');
  assert.equal(res.removed, false);
  assert.match(res.reason, /unrecoverable/);
});
