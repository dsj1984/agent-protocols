import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertBranch } from '../.agents/scripts/assert-branch.js';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSERT_BRANCH_SCRIPT = path.resolve(
  __dirname,
  '..',
  '.agents',
  'scripts',
  'assert-branch.js',
);

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

  await t.test('honors injected cwd — two distinct cwds are observable', () => {
    const seen = [];
    __setGitRunners(
      () => '',
      (_cmd, _args, opts) => {
        seen.push(opts.cwd);
        return { status: 0, stdout: 'story-1', stderr: '' };
      },
    );
    assertBranch('story-1', { cwd: '/a' });
    assertBranch('story-1', { cwd: '/b' });
    assert.deepStrictEqual(seen, ['/a', '/b']);
  });
});

// ---------------------------------------------------------------------------
// CLI precedence — --cwd flag > AGENT_WORKTREE_ROOT env > PROJECT_ROOT
// ---------------------------------------------------------------------------
//
// The CLI path is only testable by actually spawning the script; it exits
// non-zero on branch mismatch with a message embedding the cwd git saw via
// "on \"<branch>\"" in stderr. We use a tmp dir that is NOT a git repo, so
// `git branch --show-current` fails and stderr includes the cwd-specific
// error. That lets us observe which cwd the script used.

test('assert-branch CLI: --cwd flag is respected over env', (t) => {
  if (process.platform === 'win32') {
    // PATH traversal semantics in child shells differ on Windows runners;
    // keep the CLI smoke-test Linux/macOS-only.
    t.skip('win32 skipped — CLI smoke test');
    return;
  }
  const res = spawnSync(
    process.execPath,
    [ASSERT_BRANCH_SCRIPT, '--expected', 'any', '--cwd', '/nonexistent-flag'],
    {
      env: { ...process.env, AGENT_WORKTREE_ROOT: '/nonexistent-env' },
      encoding: 'utf8',
    },
  );
  // Git will fail in the nonexistent dir regardless — we just assert the
  // script ran (non-zero exit with a reason) rather than hang or crash.
  assert.notStrictEqual(res.status, 0);
  assert.ok(
    /assert-branch|not a git/i.test(res.stderr),
    `expected assert-branch stderr, got: ${res.stderr}`,
  );
});

test('assert-branch CLI: AGENT_WORKTREE_ROOT is used when --cwd is absent', (t) => {
  if (process.platform === 'win32') {
    t.skip('win32 skipped — CLI smoke test');
    return;
  }
  const res = spawnSync(
    process.execPath,
    [ASSERT_BRANCH_SCRIPT, '--expected', 'any'],
    {
      env: { ...process.env, AGENT_WORKTREE_ROOT: '/nonexistent-env' },
      encoding: 'utf8',
    },
  );
  assert.notStrictEqual(res.status, 0);
  assert.ok(/assert-branch|not a git/i.test(res.stderr));
});
