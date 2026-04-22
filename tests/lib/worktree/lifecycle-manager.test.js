import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  pathFor,
  removeWorktreeWithRecovery,
} from '../../../.agents/scripts/lib/worktree/lifecycle-manager.js';

function quietLogger() {
  const sink = { info: [], warn: [], error: [] };
  return {
    sink,
    logger: {
      info: (m) => sink.info.push(m),
      warn: (m) => sink.warn.push(m),
      error: (m) => sink.error.push(m),
    },
  };
}

test('pathFor: rejects invalid storyId', () => {
  assert.throws(
    () => pathFor({ worktreeRoot: '/repo/.worktrees' }, 'nope'),
    /invalid storyId/,
  );
});

test('pathFor: builds worktreeRoot + story-<id>', () => {
  const p = pathFor({ worktreeRoot: '/repo/.worktrees' }, 42);
  assert.ok(p.endsWith('story-42'));
});

test('removeWorktreeWithRecovery: Stage 1 fs-rm-retry recovers from Windows lock-class remove failures', async () => {
  const gitCalls = [];
  const fsRmCalls = [];
  const ctx = {
    repoRoot: '/repo',
    platform: 'win32',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: quietLogger().logger,
    fsRm: async (p, opts) => {
      fsRmCalls.push({ p, opts });
    },
    git: {
      gitSpawn: (_cwd, ...args) => {
        gitCalls.push(args);
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return {
            status: 1,
            stdout: '',
            stderr: 'Access is denied. sharing violation',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  const res = await removeWorktreeWithRecovery(
    ctx,
    '/repo/.worktrees/story-1',
    { storyId: 1, branch: 'story-1', push: false },
  );
  assert.equal(res.removed, true);
  assert.equal(res.success, true);
  assert.equal(res.method, 'fs-rm-retry');
  assert.equal(res.branchDeleted, true);
  assert.equal(res.remoteBranchDeleted, false);
  assert.equal(fsRmCalls.length, 1);
  assert.equal(fsRmCalls[0].p, '/repo/.worktrees/story-1');
  assert.equal(fsRmCalls[0].opts.recursive, true);
  assert.equal(fsRmCalls[0].opts.force, true);
  // fsRm must be followed by `worktree prune` and `branch -D story-1`.
  assert.ok(
    gitCalls.some((a) => a[0] === 'worktree' && a[1] === 'prune'),
    'Stage 1 must run `git worktree prune`',
  );
  assert.ok(
    gitCalls.some((a) => a[0] === 'branch' && a[1] === '-D' && a[2] === 'story-1'),
    'Stage 1 must run `git branch -D story-1`',
  );
  // push=false means no `git push --delete` call.
  assert.ok(
    !gitCalls.some((a) => a[0] === 'push'),
    'push=false should not trigger remote branch delete',
  );
});

test('removeWorktreeWithRecovery: Stage 1 retries fs.rm and succeeds on attempt 2/5 when EBUSY clears', async () => {
  let fsRmAttempts = 0;
  const ctx = {
    repoRoot: '/repo',
    platform: 'win32',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: quietLogger().logger,
    fsRm: async () => {
      fsRmAttempts += 1;
      if (fsRmAttempts < 2) {
        const err = new Error('EBUSY: resource busy or locked');
        err.code = 'EBUSY';
        throw err;
      }
      // EBUSY clears on attempt 2/5 — resolves cleanly.
    },
    git: {
      gitSpawn: (_cwd, ...args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return { status: 1, stdout: '', stderr: 'resource busy' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  const res = await removeWorktreeWithRecovery(
    ctx,
    '/repo/.worktrees/story-7',
    { storyId: 7, branch: 'story-7', push: true },
  );
  assert.equal(res.removed, true);
  assert.equal(res.method, 'fs-rm-retry');
  assert.equal(res.attempts, 2);
  assert.equal(fsRmAttempts, 2);
  assert.equal(res.remoteBranchDeleted, true);
});

test('removeWorktreeWithRecovery: Stage 1 defers to sweep and writes pending-cleanup manifest when fs.rm never clears', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pending-'));
  const worktreeRoot = path.join(tmp, '.worktrees');
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const wtPath = path.join(worktreeRoot, 'story-9');
  try {
    let fsRmAttempts = 0;
    const ctx = {
      repoRoot: tmp,
      worktreeRoot,
      platform: 'win32',
      config: {},
      listCache: { list: null, ts: 0 },
      logger: quietLogger().logger,
      fsRm: async () => {
        fsRmAttempts += 1;
        const err = new Error('EBUSY: resource busy or locked');
        err.code = 'EBUSY';
        throw err;
      },
      git: {
        gitSpawn: (_cwd, ...args) => {
          if (args[0] === 'worktree' && args[1] === 'remove') {
            return { status: 1, stdout: '', stderr: 'resource busy' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      },
    };
    const res = await removeWorktreeWithRecovery(ctx, wtPath, {
      storyId: 9,
      branch: 'story-9',
      push: false,
    });
    assert.equal(res.removed, false);
    assert.equal(res.method, 'deferred-to-sweep');
    assert.ok(res.pendingCleanup);
    assert.equal(res.pendingCleanup.storyId, 9);
    assert.equal(res.pendingCleanup.branch, 'story-9');
    assert.equal(res.pendingCleanup.attempts, 1);
    assert.equal(fsRmAttempts, 5);

    // Manifest must be on disk with the failed entry.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(worktreeRoot, '.pending-cleanup.json'), 'utf8'),
    );
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].storyId, 9);
    assert.equal(manifest[0].branch, 'story-9');
    assert.equal(manifest[0].path, wtPath);
    assert.ok(manifest[0].firstFailedAt);
    assert.ok(manifest[0].lastFailedAt);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removeWorktreeWithRecovery: reports failure when registration survives', async () => {
  const ctx = {
    repoRoot: '/repo',
    platform: 'linux',
    config: {},
    listCache: { list: null, ts: 0 },
    logger: quietLogger().logger,
    git: {
      gitSpawn: (_cwd, ...args) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          return {
            status: 1,
            stdout: '',
            stderr: 'fatal: something unrecoverable',
          };
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (
          args[0] === 'worktree' &&
          args[1] === 'list' &&
          args[2] === '--porcelain'
        ) {
          // Still registered after prune — cannot recover.
          return {
            status: 0,
            stdout:
              'worktree /repo\n\nworktree /repo/.worktrees/story-2\nbranch refs/heads/story-2\n',
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  const res = await removeWorktreeWithRecovery(
    ctx,
    '/repo/.worktrees/story-2',
  );
  assert.equal(res.removed, false);
  assert.match(res.reason, /unrecoverable/);
});
