// tests/lib/orchestration/single-story-close/push-phase.test.js
//
// The close-time push must remain subject to `pre-push`. The bypass this
// pins against was invisible for as long as it existed: hooks never fired in
// a linked worktree, so removing `--no-verify` would have changed nothing
// observable. Now that they do fire, the flag is the one thing that would put
// the delivery push back outside the gate — so it is asserted, not assumed.
//
// Issue #4990 adds the other half: running the gate is worthless if it reads
// the wrong tree. `core.hooksPath` is relative, so the invocation directory
// decides which tree `pre-push` measures — these tests pin that directory.

import assert from 'node:assert/strict';
import test from 'node:test';
import { pushStoryBranch } from '../../../../.agents/scripts/lib/orchestration/single-story-close/phases/push.js';

function capture() {
  const calls = [];
  return {
    calls,
    gitSync: (cwd, ...args) => {
      calls.push({ cwd, args });
      return '';
    },
  };
}

test('pushStoryBranch pushes with -u and sets the upstream', () => {
  const { calls, gitSync } = capture();
  pushStoryBranch({
    cwd: '/repo',
    storyBranch: 'story-4943',
    gitSync,
    progress: () => {},
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['push', '-u', 'origin', 'story-4943']);
  assert.equal(calls[0].cwd, '/repo');
});

test('pushStoryBranch carries no hook-bypass flag', () => {
  const { calls, gitSync } = capture();
  pushStoryBranch({
    cwd: '/repo',
    storyBranch: 'story-4943',
    gitSync,
    progress: () => {},
  });
  const bypass = calls[0].args.filter((a) =>
    ['--no-verify', '--no-gpg-sign'].includes(a),
  );
  assert.deepEqual(
    bypass,
    [],
    `the delivery push must stay subject to pre-push, got: ${calls[0].args.join(' ')}`,
  );
});

test('pushStoryBranch pushes from the Story worktree when one is supplied', () => {
  const { calls, gitSync } = capture();
  pushStoryBranch({
    cwd: '/repo',
    worktreePath: '/repo/.worktrees/story-4990',
    storyBranch: 'story-4990',
    gitSync,
    progress: () => {},
  });
  assert.equal(
    calls[0].cwd,
    '/repo/.worktrees/story-4990',
    'pre-push must resolve inside the tree being pushed, not the main checkout',
  );
});

test('pushStoryBranch falls back to the main checkout when there is no worktree', () => {
  for (const worktreePath of [null, undefined]) {
    const { calls, gitSync } = capture();
    pushStoryBranch({
      cwd: '/repo',
      worktreePath,
      storyBranch: 'story-4990',
      gitSync,
      progress: () => {},
    });
    assert.equal(
      calls[0].cwd,
      '/repo',
      `single-tree mode pushes from the main checkout (worktreePath=${worktreePath})`,
    );
  }
});

test('pushStoryBranch surfaces a push failure as a throw', () => {
  assert.throws(
    () =>
      pushStoryBranch({
        cwd: '/repo',
        storyBranch: 'story-4943',
        gitSync: () => {
          throw new Error('remote rejected');
        },
        progress: () => {},
      }),
    /git push failed for story-4943.*remote rejected/s,
  );
});
