// tests/lib/orchestration/single-story-close/push-phase.test.js
//
// The close-time push must remain subject to `pre-push`. The bypass this
// pins against was invisible for as long as it existed: hooks never fired in
// a linked worktree, so removing `--no-verify` would have changed nothing
// observable. Now that they do fire, the flag is the one thing that would put
// the delivery push back outside the gate — so it is asserted, not assumed.

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
