import assert from 'node:assert';
import { test } from 'node:test';

import { assertBranch } from '../.agents/scripts/assert-branch.js';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';

function fakeSpawn({ status = 0, stdout = '', stderr = '' } = {}) {
  return () => ({ status, stdout, stderr });
}

test('assertBranch', async (t) => {
  t.after(() => {
    __setGitRunners(
      (cmd, args, opts) => {
        // restore minimal stubs to avoid cross-test pollution
        void cmd;
        void args;
        void opts;
        return '';
      },
      () => ({ status: 0, stdout: '', stderr: '' }),
    );
  });

  await t.test('returns ok when branch matches', () => {
    __setGitRunners(() => '', fakeSpawn({ stdout: 'story-329' }));
    const result = assertBranch('story-329', { cwd: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.actual, 'story-329');
  });

  await t.test('returns mismatch when branch differs', () => {
    __setGitRunners(() => '', fakeSpawn({ stdout: 'story-304' }));
    const result = assertBranch('story-329', { cwd: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /expected "story-329".*on "story-304"/);
  });

  await t.test('fails when no expected branch supplied', () => {
    const result = assertBranch(undefined, { cwd: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /missing --expected/);
  });

  await t.test('fails when git command errors', () => {
    __setGitRunners(
      () => '',
      fakeSpawn({ status: 128, stderr: 'not a git repo' }),
    );
    const result = assertBranch('story-329', { cwd: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /not a git repo/);
  });
});
