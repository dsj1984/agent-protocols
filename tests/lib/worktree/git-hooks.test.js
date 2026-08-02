// tests/lib/worktree/git-hooks.test.js
//
// The `core.hooksPath` resolution matrix, driven through injected seams so no
// case touches a real repository. The two halves matter equally: the skip
// branches must stay silent no-ops (a consumer project without husky must not
// fail worktree creation), and every other branch must either place the hooks
// or throw. "Skipped quietly" is the failure mode this module exists to end.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';
import {
  materializeGitHooks,
  SKIP_ABSOLUTE,
  SKIP_SAME_CHECKOUT,
  SKIP_SOURCE_ABSENT,
  SKIP_UNSET,
} from '../../../.agents/scripts/lib/worktree/git-hooks.js';

/** A git seam whose `config --get core.hooksPath` answers `value`. */
function gitWith(value) {
  return {
    gitSpawn: () =>
      value === null
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: `${value}\n`, stderr: '' },
  };
}

/** An fs seam that records every mutating call and performs none of them. */
function inertFs() {
  const writes = [];
  return {
    writes,
    impl: {
      existsSync: () => true,
      realpathSync: { native: (p) => p },
      readdirSync: () => [],
      rmSync: (...a) => writes.push(['rmSync', ...a]),
      mkdirSync: (...a) => writes.push(['mkdirSync', ...a]),
      cpSync: (...a) => writes.push(['cpSync', ...a]),
    },
  };
}

test('unset core.hooksPath is a silent no-op', () => {
  const { writes, impl } = inertFs();
  const result = materializeGitHooks({
    repoRoot: '/repo',
    worktree: '/repo/.worktrees/story-1',
    gitImpl: gitWith(null),
    fsImpl: impl,
  });
  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, SKIP_UNSET);
  assert.deepEqual(writes, [], 'an unset hooks path must write nothing');
});

test('an empty core.hooksPath is treated as unset', () => {
  const result = materializeGitHooks({
    repoRoot: '/repo',
    worktree: '/repo/.worktrees/story-1',
    gitImpl: gitWith('   '),
    fsImpl: inertFs().impl,
  });
  assert.equal(result.reason, SKIP_UNSET);
});

test('an absolute core.hooksPath is a no-op — it already resolves alike', () => {
  const { writes, impl } = inertFs();
  const result = materializeGitHooks({
    repoRoot: '/repo',
    worktree: '/repo/.worktrees/story-1',
    gitImpl: gitWith('/etc/shared-hooks'),
    fsImpl: impl,
  });
  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, SKIP_ABSOLUTE);
  assert.deepEqual(writes, []);
});

test('a missing source directory is a no-op, not a failure', () => {
  const { writes, impl } = inertFs();
  const result = materializeGitHooks({
    repoRoot: '/repo',
    worktree: '/repo/.worktrees/story-1',
    gitImpl: gitWith('.husky/_'),
    fsImpl: { ...impl, existsSync: () => false },
  });
  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, SKIP_SOURCE_ABSENT);
  assert.deepEqual(writes, [], 'a project without husky must not be mutated');
});

test('provisioning a checkout from itself is refused', () => {
  const { writes, impl } = inertFs();
  const result = materializeGitHooks({
    repoRoot: '/repo',
    worktree: '/repo',
    gitImpl: gitWith('.husky/_'),
    fsImpl: impl,
  });
  assert.equal(result.reason, SKIP_SAME_CHECKOUT);
  assert.deepEqual(
    writes,
    [],
    'copying a checkout onto itself would destroy the only copy',
  );
});

test('a traversing core.hooksPath cannot reach outside the worktree', () => {
  assert.throws(
    () =>
      materializeGitHooks({
        repoRoot: '/repo',
        worktree: '/repo/.worktrees/story-1',
        gitImpl: gitWith('../../../etc'),
        fsImpl: inertFs().impl,
      }),
    /resolves outside/,
  );
});

test('a copy that lands no hooks throws and names the target', () => {
  const { impl } = inertFs();
  assert.throws(
    () =>
      materializeGitHooks({
        repoRoot: '/repo',
        worktree: '/repo/.worktrees/story-1',
        gitImpl: gitWith('.husky/_'),
        fsImpl: {
          ...impl,
          // Source lists two hooks; the target ends up empty.
          readdirSync: (dir) =>
            dir.includes('.worktrees')
              ? []
              : [
                  { name: 'commit-msg', isFile: () => true },
                  { name: 'pre-commit', isFile: () => true },
                ],
        },
      }),
    (err) =>
      /missing 2 hook\(s\)/.test(err.message) &&
      err.message.includes(path.join('.worktrees', 'story-1')),
  );
});

test('a copy failure throws rather than degrading to a skip', () => {
  const { impl } = inertFs();
  assert.throws(
    () =>
      materializeGitHooks({
        repoRoot: '/repo',
        worktree: '/repo/.worktrees/story-1',
        gitImpl: gitWith('.husky/_'),
        fsImpl: {
          ...impl,
          cpSync: () => {
            throw new Error('EACCES: permission denied');
          },
        },
      }),
    /failed to materialize .* EACCES/s,
  );
});

test('materialization is idempotent and refreshes a stale target', () => {
  const tmp = makeTempDir('hooks-unit-');
  const repoRoot = path.join(tmp, 'main');
  const worktree = path.join(tmp, 'wt');
  fs.mkdirSync(path.join(repoRoot, '.husky', '_'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.husky', '_', 'commit-msg'),
    '#!/bin/sh\n',
  );

  // A stale shim from an earlier husky version must not survive the refresh.
  fs.mkdirSync(path.join(worktree, '.husky', '_'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.husky', '_', 'obsolete'), 'stale\n');

  const run = () =>
    materializeGitHooks({
      repoRoot,
      worktree,
      gitImpl: gitWith('.husky/_'),
    });

  const first = run();
  assert.equal(first.action, 'materialized');
  assert.deepEqual(first.hooks, ['commit-msg']);
  assert.equal(
    fs.existsSync(path.join(worktree, '.husky', '_', 'obsolete')),
    false,
    'a refresh must not leave a stale shim behind',
  );

  const second = run();
  assert.equal(second.action, 'materialized', 'a re-run must stay safe');
  assert.deepEqual(second.hooks, ['commit-msg']);
});

test('the copy preserves the executable bit', {
  skip: process.platform === 'win32' ? 'POSIX file modes' : false,
}, () => {
  const tmp = makeTempDir('hooks-mode-');
  const repoRoot = path.join(tmp, 'main');
  const worktree = path.join(tmp, 'wt');
  fs.mkdirSync(path.join(repoRoot, '.husky', '_'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  const src = path.join(repoRoot, '.husky', '_', 'pre-commit');
  fs.writeFileSync(src, '#!/bin/sh\n');
  fs.chmodSync(src, 0o755);

  materializeGitHooks({ repoRoot, worktree, gitImpl: gitWith('.husky/_') });

  const mode = fs.statSync(
    path.join(worktree, '.husky', '_', 'pre-commit'),
  ).mode;
  assert.ok(
    mode & 0o100,
    'a hook git cannot execute is a hook that never runs',
  );
});
