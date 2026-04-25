import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyNodeModulesStrategy,
  describeAttemptFailure,
  installDependencies,
  installRetryPolicy,
  runInstallWithRetry,
  selectInstallCommand,
} from '../../../.agents/scripts/lib/worktree/node-modules-strategy.js';

test('selectInstallCommand: symlink strategy returns null', () => {
  assert.equal(selectInstallCommand('symlink', '/wt'), null);
});

test('selectInstallCommand: returns null when package.json is absent', () => {
  const fsLike = { existsSync: () => false };
  assert.equal(selectInstallCommand('per-worktree', '/wt', fsLike), null);
});

test('selectInstallCommand: pnpm-store always uses pnpm install --frozen-lockfile', () => {
  const fsLike = { existsSync: (p) => p.endsWith('package.json') };
  assert.deepEqual(selectInstallCommand('pnpm-store', '/wt', fsLike), {
    cmd: 'pnpm',
    args: ['install', '--frozen-lockfile'],
  });
});

test('selectInstallCommand: per-worktree picks pnpm/yarn/npm based on lock file', () => {
  const withFiles = (...names) => ({
    existsSync: (p) =>
      names.some((n) => p.endsWith(n)) || p.endsWith('package.json'),
  });
  assert.deepEqual(
    selectInstallCommand('per-worktree', '/wt', withFiles('pnpm-lock.yaml')),
    { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
  );
  assert.deepEqual(
    selectInstallCommand('per-worktree', '/wt', withFiles('yarn.lock')),
    { cmd: 'yarn', args: ['install', '--frozen-lockfile'] },
  );
  assert.deepEqual(selectInstallCommand('per-worktree', '/wt', withFiles()), {
    cmd: 'npm',
    args: ['ci'],
  });
});

test('installRetryPolicy: pnpm gets 3 attempts and 5min timeout', () => {
  const p = installRetryPolicy('pnpm');
  assert.equal(p.maxAttempts, 3);
  assert.equal(p.timeoutMs, 300_000);
  assert.deepEqual(p.backoffMs, [0, 2_000, 5_000]);
});

test('installRetryPolicy: non-pnpm gets a single attempt and 2min timeout', () => {
  const p = installRetryPolicy('npm');
  assert.equal(p.maxAttempts, 1);
  assert.equal(p.timeoutMs, 120_000);
});

test('describeAttemptFailure: SIGTERM is reported as a timeout', () => {
  assert.equal(
    describeAttemptFailure({ signal: 'SIGTERM', status: null }, 60_000),
    'timeout after 60s',
  );
});

test('describeAttemptFailure: non-zero exit reports the status', () => {
  assert.equal(
    describeAttemptFailure({ signal: null, status: 7 }, 60_000),
    'exit 7',
  );
});

test('runInstallWithRetry: succeeds on first attempt without sleeping', () => {
  const sleepCalls = [];
  const out = runInstallWithRetry({
    cmd: 'npm',
    args: ['ci'],
    cwd: '/wt',
    shell: false,
    policy: installRetryPolicy('npm'),
    spawnFn: () => ({ status: 0, stderr: '' }),
    sleepFn: (ms) => sleepCalls.push(ms),
    logger: { info: () => {}, warn: () => {} },
    strategy: 'per-worktree',
  });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 1);
  assert.deepEqual(sleepCalls, []);
});

test('runInstallWithRetry: retries pnpm up to maxAttempts before giving up', () => {
  let calls = 0;
  const out = runInstallWithRetry({
    cmd: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    cwd: '/wt',
    shell: false,
    policy: installRetryPolicy('pnpm'),
    spawnFn: () => {
      calls += 1;
      return { status: 1, stderr: 'boom' };
    },
    sleepFn: () => {},
    logger: { info: () => {}, warn: () => {} },
    strategy: 'pnpm-store',
  });
  assert.equal(calls, 3);
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 3);
});

test('runInstallWithRetry: succeeds on attempt 2 after one failure', () => {
  let calls = 0;
  const out = runInstallWithRetry({
    cmd: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    cwd: '/wt',
    shell: false,
    policy: installRetryPolicy('pnpm'),
    spawnFn: () => {
      calls += 1;
      return { status: calls === 1 ? 1 : 0, stderr: '' };
    },
    sleepFn: () => {},
    logger: { info: () => {}, warn: () => {} },
    strategy: 'pnpm-store',
  });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 2);
  assert.equal(calls, 2);
});

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('applyNodeModulesStrategy: per-worktree is a no-op', () => {
  assert.doesNotThrow(() =>
    applyNodeModulesStrategy(
      {
        config: { nodeModulesStrategy: 'per-worktree' },
        platform: 'linux',
        logger: quietLogger(),
        repoRoot: '/repo',
      },
      '/repo/.worktrees/story-1',
    ),
  );
});

test('applyNodeModulesStrategy: pnpm-store is a no-op (install runs later)', () => {
  assert.doesNotThrow(() =>
    applyNodeModulesStrategy(
      {
        config: { nodeModulesStrategy: 'pnpm-store' },
        platform: 'linux',
        logger: quietLogger(),
        repoRoot: '/repo',
      },
      '/repo/.worktrees/story-1',
    ),
  );
});

test('applyNodeModulesStrategy: symlink requires primeFromPath', () => {
  assert.throws(
    () =>
      applyNodeModulesStrategy(
        {
          config: { nodeModulesStrategy: 'symlink' },
          platform: 'linux',
          logger: quietLogger(),
          repoRoot: '/repo',
        },
        '/repo/.worktrees/story-1',
      ),
    /primeFromPath/,
  );
});

test('applyNodeModulesStrategy: symlink refuses on win32 without opt-in', () => {
  assert.throws(
    () =>
      applyNodeModulesStrategy(
        {
          config: { nodeModulesStrategy: 'symlink', primeFromPath: '.' },
          platform: 'win32',
          logger: quietLogger(),
          repoRoot: '/repo',
        },
        '/repo/.worktrees/story-1',
      ),
    /refuses on Windows/,
  );
});

test('applyNodeModulesStrategy: symlink errors when primeFromPath has no node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-'));
  assert.throws(
    () =>
      applyNodeModulesStrategy(
        {
          config: {
            nodeModulesStrategy: 'symlink',
            primeFromPath: 'donor',
            allowSymlinkOnWindows: true,
          },
          platform: 'linux',
          logger: quietLogger(),
          repoRoot: root,
        },
        path.join(root, 'story-1'),
      ),
    /has no node_modules/,
  );
});

test('applyNodeModulesStrategy: unknown strategy rejects', () => {
  assert.throws(
    () =>
      applyNodeModulesStrategy(
        {
          config: { nodeModulesStrategy: 'bogus' },
          platform: 'linux',
          logger: quietLogger(),
          repoRoot: '/repo',
        },
        '/repo/.worktrees/story-1',
      ),
    /unknown nodeModulesStrategy/,
  );
});

test('installDependencies: symlink reports skipped without running installer', () => {
  assert.deepEqual(
    installDependencies(
      {
        config: { nodeModulesStrategy: 'symlink' },
        platform: 'linux',
        logger: quietLogger(),
      },
      '/nonexistent',
    ),
    { status: 'skipped', reason: 'symlink-strategy' },
  );
});

test('installDependencies: no package.json in worktree reports skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-'));
  assert.deepEqual(
    installDependencies(
      {
        config: { nodeModulesStrategy: 'per-worktree' },
        platform: 'linux',
        logger: quietLogger(),
      },
      root,
    ),
    { status: 'skipped', reason: 'no-package-json' },
  );
});
