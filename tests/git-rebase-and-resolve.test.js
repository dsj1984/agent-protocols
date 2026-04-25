import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abortRebase,
  continueRebase,
  isCleanRebaseOutcome,
  parseRebaseArgs,
  renderRebaseHumanLines,
  runRebase,
  selectRebaseAction,
} from '../.agents/scripts/git-rebase-and-resolve.js';

describe('selectRebaseAction', () => {
  it('returns abort when --abort is set', () => {
    assert.deepEqual(
      selectRebaseAction({
        abortFlag: true,
        continueFlag: false,
        onto: undefined,
      }),
      { kind: 'abort' },
    );
  });
  it('returns continue when --continue is set and abort is not', () => {
    assert.deepEqual(
      selectRebaseAction({
        abortFlag: false,
        continueFlag: true,
        onto: undefined,
      }),
      { kind: 'continue' },
    );
  });
  it('returns usage-error when no flags and no --onto', () => {
    const out = selectRebaseAction({ abortFlag: false, continueFlag: false });
    assert.equal(out.kind, 'usage-error');
    assert.match(out.message, /Usage: node git-rebase-and-resolve\.js/);
  });
  it('returns rebase action with onto + head', () => {
    assert.deepEqual(
      selectRebaseAction({
        abortFlag: false,
        continueFlag: false,
        onto: 'main',
        head: 'feat/x',
      }),
      { kind: 'rebase', onto: 'main', head: 'feat/x' },
    );
  });
});

describe('parseRebaseArgs', () => {
  it('defaults all flags to false when only --onto is supplied', () => {
    assert.deepEqual(parseRebaseArgs(['--onto', 'main']), {
      onto: 'main',
      head: undefined,
      continueFlag: false,
      abortFlag: false,
      json: false,
    });
  });
  it('parses --continue and --json', () => {
    const out = parseRebaseArgs(['--continue', '--json']);
    assert.equal(out.continueFlag, true);
    assert.equal(out.json, true);
  });
  it('parses --abort independently', () => {
    assert.equal(parseRebaseArgs(['--abort']).abortFlag, true);
  });
  it('passes through --head', () => {
    assert.equal(
      parseRebaseArgs(['--onto', 'main', '--head', 'feat/x']).head,
      'feat/x',
    );
  });
});

describe('isCleanRebaseOutcome', () => {
  it('returns true for non-failure outcomes', () => {
    for (const o of ['clean', 'continued', 'aborted']) {
      assert.equal(isCleanRebaseOutcome(o), true);
    }
  });
  it('returns false for failure outcomes', () => {
    for (const o of ['conflict', 'error', 'unknown', undefined]) {
      assert.equal(isCleanRebaseOutcome(o), false);
    }
  });
});

describe('renderRebaseHumanLines', () => {
  it('emits just the outcome line when there are no conflicts', () => {
    assert.deepEqual(renderRebaseHumanLines({ outcome: 'clean' }), [
      '[rebase] outcome: clean',
    ]);
  });
  it('lists each conflicted file under a header', () => {
    const lines = renderRebaseHumanLines({
      outcome: 'conflict',
      conflictedFiles: ['a.js', 'b.md'],
    });
    assert.deepEqual(lines, [
      '[rebase] outcome: conflict',
      '[rebase] conflicted files (2):',
      '  - a.js',
      '  - b.md',
    ]);
  });
});

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
