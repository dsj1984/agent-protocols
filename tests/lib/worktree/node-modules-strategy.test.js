import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyNodeModulesStrategy,
  installDependencies,
} from '../../../.agents/scripts/lib/worktree/node-modules-strategy.js';

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

test('installDependencies: symlink returns true without running installer', () => {
  assert.equal(
    installDependencies(
      {
        config: { nodeModulesStrategy: 'symlink' },
        platform: 'linux',
        logger: quietLogger(),
      },
      '/nonexistent',
    ),
    true,
  );
});

test('installDependencies: no package.json in worktree returns true', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nms-'));
  assert.equal(
    installDependencies(
      {
        config: { nodeModulesStrategy: 'per-worktree' },
        platform: 'linux',
        logger: quietLogger(),
      },
      root,
    ),
    true,
  );
});
