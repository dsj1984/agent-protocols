import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getWorktreeList,
  invalidateWorktreeCache,
  pathFor,
} from '../../../.agents/scripts/lib/worktree/lifecycle-manager.js';

const FIXTURE_PORCELAIN = [
  'worktree /repo',
  'HEAD abc0000000000000000000000000000000000001',
  'branch refs/heads/main',
  '',
  'worktree /repo/.worktrees/story-42',
  'HEAD abc0000000000000000000000000000000000002',
  'branch refs/heads/story-42',
  '',
].join('\n');

function makeCtx({ git }) {
  return {
    repoRoot: '/repo',
    worktreeRoot: '/repo/.worktrees',
    git,
    platform: 'linux',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: { info() {}, warn() {}, error() {} },
  };
}

describe('lifecycle-manager getWorktreeList — injected git', () => {
  it('uses the explicit `git` override when provided', () => {
    const ctxGitCalls = [];
    const overrideCalls = [];
    const ctx = makeCtx({
      git: {
        gitSpawn: (...args) => {
          ctxGitCalls.push(args);
          return { status: 0, stdout: '', stderr: '' };
        },
      },
    });
    const override = {
      gitSpawn: (...args) => {
        overrideCalls.push(args);
        return { status: 0, stdout: FIXTURE_PORCELAIN, stderr: '' };
      },
    };

    const list = getWorktreeList(ctx, { git: override });

    assert.equal(overrideCalls.length, 1);
    assert.deepEqual(overrideCalls[0], [
      '/repo',
      'worktree',
      'list',
      '--porcelain',
    ]);
    assert.equal(ctxGitCalls.length, 0);
    assert.equal(list.length, 2);
    assert.equal(list[1].path, '/repo/.worktrees/story-42');
    assert.equal(list[1].branch, 'story-42');
  });

  it('falls back to ctx.git when no explicit override is passed (backward compat)', () => {
    const ctxGitCalls = [];
    const ctx = makeCtx({
      git: {
        gitSpawn: (...args) => {
          ctxGitCalls.push(args);
          return { status: 0, stdout: FIXTURE_PORCELAIN, stderr: '' };
        },
      },
    });

    const list = getWorktreeList(ctx);

    assert.equal(ctxGitCalls.length, 1);
    assert.equal(list.length, 2);
  });

  it('returns [] when the injected git reports a non-zero status', () => {
    const ctx = makeCtx({ git: null });
    const override = {
      gitSpawn: () => ({
        status: 128,
        stdout: '',
        stderr: 'not a repo',
      }),
    };
    const list = getWorktreeList(ctx, { git: override });
    assert.deepEqual(list, []);
  });

  it('caches the parsed list and short-circuits on subsequent calls', () => {
    let calls = 0;
    const override = {
      gitSpawn: () => {
        calls++;
        return { status: 0, stdout: FIXTURE_PORCELAIN, stderr: '' };
      },
    };
    const ctx = makeCtx({ git: null });
    getWorktreeList(ctx, { git: override });
    getWorktreeList(ctx, { git: override });
    assert.equal(calls, 1);
  });
});

describe('lifecycle-manager invalidateWorktreeCache', () => {
  it('clears the cached list even when no git is available', () => {
    const ctx = makeCtx({ git: null });
    ctx.listCache.list = [{ path: '/repo', branch: 'main' }];
    ctx.listCache.ts = Date.now();
    invalidateWorktreeCache(ctx);
    assert.equal(ctx.listCache.list, null);
    assert.equal(ctx.listCache.ts, 0);
  });

  it('accepts a `{ git }` opts bag for API symmetry without touching it', () => {
    const ctx = makeCtx({ git: null });
    ctx.listCache.list = [{ path: '/repo' }];
    ctx.listCache.ts = 123;
    const fakeGit = {
      gitSpawn: () => {
        throw new Error('must not be called');
      },
    };
    invalidateWorktreeCache(ctx, { git: fakeGit });
    assert.equal(ctx.listCache.list, null);
  });
});

describe('lifecycle-manager pathFor', () => {
  it('resolves the worktree path for a story id without using git', () => {
    const ctx = makeCtx({ git: null });
    const fakeGit = {
      gitSpawn: () => {
        throw new Error('must not be called');
      },
    };
    const p = pathFor(ctx, 42, { git: fakeGit });
    assert.ok(p.endsWith('story-42'));
  });

  it('rejects invalid story ids before touching git', () => {
    const ctx = makeCtx({ git: null });
    assert.throws(() => pathFor(ctx, 'nope'), /invalid storyId/);
  });
});
