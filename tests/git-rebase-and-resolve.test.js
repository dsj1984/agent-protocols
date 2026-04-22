import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abortRebase,
  continueRebase,
  runRebase,
} from '../.agents/scripts/git-rebase-and-resolve.js';

/**
 * Build a fake git runner from a script of per-invocation results. Each call
 * consumes the next entry; callers can assert the invocation sequence by
 * inspecting `calls` afterwards.
 */
function fakeGit(script) {
  const calls = [];
  let i = 0;
  return {
    calls,
    spawn(_cwd, ...args) {
      calls.push(args);
      const r = script[i++] ?? { status: 0, stdout: '', stderr: '' };
      return r;
    },
  };
}

describe('git-rebase-and-resolve.runRebase', () => {
  it('returns clean when fetch + rebase both succeed', () => {
    const git = fakeGit([
      { status: 0, stdout: '', stderr: '' }, // fetch
      { status: 0, stdout: '', stderr: '' }, // rebase
    ]);
    const result = runRebase({ onto: 'origin/main', git });
    assert.equal(result.outcome, 'clean');
    assert.equal(git.calls[0][0], 'fetch');
    assert.equal(git.calls[1][0], 'rebase');
  });

  it('checks out and pulls the head branch when --head is supplied', () => {
    const git = fakeGit([
      { status: 0 }, // fetch
      { status: 0 }, // checkout
      { status: 0 }, // pull
      { status: 0 }, // rebase
    ]);
    runRebase({ onto: 'origin/main', head: 'feat-x', git });
    const verbs = git.calls.map((c) => c[0]);
    assert.deepEqual(verbs, ['fetch', 'checkout', 'pull', 'rebase']);
    assert.equal(git.calls[1][1], 'feat-x');
  });

  it('returns error when fetch fails (no rebase attempted)', () => {
    const git = fakeGit([{ status: 128, stderr: 'cannot reach origin' }]);
    const result = runRebase({ onto: 'origin/main', git });
    assert.equal(result.outcome, 'error');
    assert.match(result.stderr, /cannot reach origin/);
    assert.equal(git.calls.length, 1);
  });

  it('requires --onto', () => {
    assert.throws(() => runRebase({ git: fakeGit([]) }), /--onto/);
  });
});

describe('git-rebase-and-resolve.continueRebase', () => {
  it('reports continued when `rebase --continue` returns 0', () => {
    const git = fakeGit([{ status: 0 }]);
    const result = continueRebase({ git });
    assert.equal(result.outcome, 'continued');
    assert.deepEqual(git.calls[0], ['rebase', '--continue']);
  });
});

describe('git-rebase-and-resolve.abortRebase', () => {
  it('reports aborted when git rebase --abort succeeds', () => {
    const git = fakeGit([{ status: 0 }]);
    const result = abortRebase({ git });
    assert.equal(result.outcome, 'aborted');
  });

  it('reports error when abort fails', () => {
    const git = fakeGit([{ status: 1, stderr: 'no rebase in progress' }]);
    const result = abortRebase({ git });
    assert.equal(result.outcome, 'error');
  });
});
