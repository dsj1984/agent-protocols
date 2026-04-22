import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMIT_ASSERTION_ZERO_DELTA_DETAIL,
  CommitAssertion,
  buildDefaultGitAdapter,
} from '../../.agents/scripts/lib/orchestration/epic-runner/commit-assertion.js';

function stubAdapter(map) {
  return async ({ epicId, storyId }) => {
    if (!(storyId in map)) {
      throw new Error(`no stub for story-${storyId} vs epic/${epicId}`);
    }
    const value = map[storyId];
    if (value instanceof Error) throw value;
    return value;
  };
}

describe('CommitAssertion', () => {
  it('requires an injected gitAdapter function', () => {
    assert.throws(() => new CommitAssertion({}), /gitAdapter function/);
  });

  it('returns zero-, one-, and many-commit rows as-is from the adapter', async () => {
    const assertion = new CommitAssertion({
      gitAdapter: stubAdapter({ 400: 0, 401: 1, 402: 17 }),
    });
    const rows = await assertion.check([400, 401, 402], { epicId: 321 });
    assert.deepEqual(rows, [
      { storyId: 400, newCommitCount: 0 },
      { storyId: 401, newCommitCount: 1 },
      { storyId: 402, newCommitCount: 17 },
    ]);
  });

  it('records adapter errors as null count + error detail, and keeps going', async () => {
    const assertion = new CommitAssertion({
      gitAdapter: stubAdapter({
        400: 2,
        401: new Error('unknown revision'),
        402: 5,
      }),
      logger: { warn: () => {} },
    });
    const rows = await assertion.check([400, 401, 402], { epicId: 321 });
    assert.equal(rows[0].newCommitCount, 2);
    assert.equal(rows[1].newCommitCount, null);
    assert.match(rows[1].error, /unknown revision/);
    assert.equal(rows[2].newCommitCount, 5);
  });

  it('requires a numeric epicId', async () => {
    const assertion = new CommitAssertion({ gitAdapter: async () => 0 });
    await assert.rejects(() => assertion.check([400], {}), /numeric epicId/);
  });

  it('coerces non-integer adapter output to a safe integer', async () => {
    const assertion = new CommitAssertion({
      gitAdapter: stubAdapter({ 400: '3', 401: -1, 402: Number.NaN }),
    });
    const rows = await assertion.check([400, 401, 402], { epicId: 321 });
    assert.equal(rows[0].newCommitCount, 3);
    // Negative and NaN both collapse to 0 rather than propagating.
    assert.equal(rows[1].newCommitCount, 0);
    assert.equal(rows[2].newCommitCount, 0);
  });

  it('exports the zero-delta detail constant for the wave-observer wiring', () => {
    assert.equal(
      COMMIT_ASSERTION_ZERO_DELTA_DETAIL,
      'commit-assertion: zero-delta',
    );
  });
});

describe('buildDefaultGitAdapter', () => {
  it('invokes git rev-list --count with origin/epic and origin/story refspecs', async () => {
    const calls = [];
    const fakeExecFile = (cmd, args, opts, cb) => {
      calls.push({ cmd, args, opts });
      cb(null, { stdout: '4\n', stderr: '' });
    };
    const adapter = buildDefaultGitAdapter({
      cwd: '/tmp/repo',
      execFileImpl: fakeExecFile,
    });
    const count = await adapter({ epicId: 413, storyId: 420 });
    assert.equal(count, 4);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'git');
    assert.deepEqual(calls[0].args, [
      'rev-list',
      '--count',
      'origin/epic/413..origin/story-420',
    ]);
    assert.equal(calls[0].opts.cwd, '/tmp/repo');
  });

  it('propagates git errors (missing refs) so CommitAssertion can record them', async () => {
    const fakeExecFile = (_cmd, _args, _opts, cb) => {
      const err = new Error("fatal: bad revision 'origin/epic/999'");
      cb(err, { stdout: '', stderr: err.message });
    };
    const adapter = buildDefaultGitAdapter({ execFileImpl: fakeExecFile });
    await assert.rejects(
      () => adapter({ epicId: 999, storyId: 420 }),
      /bad revision/,
    );
  });

  it('rejects non-numeric stdout instead of silently returning zero', async () => {
    const fakeExecFile = (_cmd, _args, _opts, cb) => {
      cb(null, { stdout: 'not-a-number\n', stderr: '' });
    };
    const adapter = buildDefaultGitAdapter({ execFileImpl: fakeExecFile });
    await assert.rejects(
      () => adapter({ epicId: 413, storyId: 420 }),
      /unexpected rev-list/,
    );
  });
});
