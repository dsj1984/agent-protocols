import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  drainPendingCleanup,
  manifestPath,
  MAX_SWEEP_ATTEMPTS,
  readManifest,
  recordPendingCleanup,
  removePendingCleanup,
} from '../../../.agents/scripts/lib/worktree/pending-cleanup.js';

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

function tmpWorktreeRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  const wtRoot = path.join(tmp, '.worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  return { tmp, wtRoot };
}

test('recordPendingCleanup: writes a fresh manifest entry', () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    const entry = recordPendingCleanup(wtRoot, {
      storyId: 42,
      branch: 'story-42',
      path: path.join(wtRoot, 'story-42'),
      push: true,
    });
    assert.equal(entry.storyId, 42);
    assert.equal(entry.attempts, 1);
    assert.ok(entry.firstFailedAt);
    assert.equal(entry.firstFailedAt, entry.lastFailedAt);

    const onDisk = readManifest(wtRoot);
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].storyId, 42);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('recordPendingCleanup: increments attempts and updates lastFailedAt on repeat', async () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    const first = recordPendingCleanup(wtRoot, {
      storyId: 7,
      branch: 'story-7',
      path: path.join(wtRoot, 'story-7'),
    });
    // Force a distinct timestamp.
    await new Promise((r) => setTimeout(r, 10));
    const second = recordPendingCleanup(wtRoot, {
      storyId: 7,
      branch: 'story-7',
      path: path.join(wtRoot, 'story-7'),
    });
    assert.equal(second.attempts, 2);
    assert.equal(second.firstFailedAt, first.firstFailedAt);
    assert.notEqual(second.lastFailedAt, first.lastFailedAt);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removePendingCleanup: drops entry and deletes manifest when empty', () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    recordPendingCleanup(wtRoot, {
      storyId: 1,
      branch: 'story-1',
      path: path.join(wtRoot, 'story-1'),
    });
    removePendingCleanup(wtRoot, 1);
    assert.equal(fs.existsSync(manifestPath(wtRoot)), false);
    assert.deepEqual(readManifest(wtRoot), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drainPendingCleanup: empty manifest returns empty result without calling git', async () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    const calls = [];
    const git = {
      gitSpawn: (_cwd, ...args) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    const res = await drainPendingCleanup({
      repoRoot: tmp,
      worktreeRoot: wtRoot,
      git,
      fsRm: async () => {
        throw new Error('should not be called');
      },
      logger: quietLogger().logger,
    });
    assert.deepEqual(res, { drained: [], persistent: [], stillPending: [] });
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drainPendingCleanup: removes entry when Stage 1 retry now succeeds', async () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    const wtPath = path.join(wtRoot, 'story-100');
    recordPendingCleanup(wtRoot, {
      storyId: 100,
      branch: 'story-100',
      path: wtPath,
      push: true,
    });

    const calls = [];
    const git = {
      gitSpawn: (_cwd, ...args) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    const res = await drainPendingCleanup({
      repoRoot: tmp,
      worktreeRoot: wtRoot,
      git,
      fsRm: async () => {
        // Lock has cleared; fs.rm succeeds cleanly.
      },
      logger: quietLogger().logger,
    });
    assert.deepEqual(res.drained, [100]);
    assert.deepEqual(res.persistent, []);
    assert.deepEqual(res.stillPending, []);
    assert.equal(fs.existsSync(manifestPath(wtRoot)), false);
    assert.ok(
      calls.some((a) => a[0] === 'worktree' && a[1] === 'prune'),
      'sweep must run worktree prune after fs.rm',
    );
    assert.ok(
      calls.some(
        (a) => a[0] === 'branch' && a[1] === '-D' && a[2] === 'story-100',
      ),
      'sweep must run branch -D',
    );
    assert.ok(
      calls.some(
        (a) =>
          a[0] === 'push' && a.includes('--delete') && a.includes('story-100'),
      ),
      'push=true should trigger remote branch delete',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drainPendingCleanup: never-clearing lock promotes to persistent after MAX_SWEEP_ATTEMPTS', async () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    // Seed manifest with an entry already at MAX_SWEEP_ATTEMPTS - 1 attempts.
    recordPendingCleanup(wtRoot, {
      storyId: 77,
      branch: 'story-77',
      path: path.join(wtRoot, 'story-77'),
    });
    // Simulate two prior sweep failures.
    const manifest = readManifest(wtRoot);
    manifest[0].attempts = MAX_SWEEP_ATTEMPTS - 1;
    fs.writeFileSync(
      manifestPath(wtRoot),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const { logger, sink } = quietLogger();
    const res = await drainPendingCleanup({
      repoRoot: tmp,
      worktreeRoot: wtRoot,
      git: {
        gitSpawn: () => ({ status: 0, stdout: '', stderr: '' }),
      },
      fsRm: async () => {
        const err = new Error('EBUSY: still locked');
        err.code = 'EBUSY';
        throw err;
      },
      logger,
    });
    assert.deepEqual(res.drained, []);
    assert.deepEqual(res.persistent, [77]);
    assert.deepEqual(res.stillPending, []);
    assert.ok(
      sink.error.some((m) => m.includes('persistent-lock')),
      'expected OPERATOR ACTION REQUIRED: persistent-lock log line',
    );
    // Entry must stay in the manifest so the signal persists next sweep.
    const post = readManifest(wtRoot);
    assert.equal(post.length, 1);
    assert.equal(post[0].attempts, MAX_SWEEP_ATTEMPTS);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drainPendingCleanup: increments attempts and keeps entry when below max', async () => {
  const { tmp, wtRoot } = tmpWorktreeRoot();
  try {
    recordPendingCleanup(wtRoot, {
      storyId: 55,
      branch: 'story-55',
      path: path.join(wtRoot, 'story-55'),
    });
    const { logger, sink } = quietLogger();
    const res = await drainPendingCleanup({
      repoRoot: tmp,
      worktreeRoot: wtRoot,
      git: {
        gitSpawn: () => ({ status: 0, stdout: '', stderr: '' }),
      },
      fsRm: async () => {
        throw new Error('EBUSY');
      },
      logger,
    });
    assert.deepEqual(res.drained, []);
    assert.deepEqual(res.persistent, []);
    assert.deepEqual(res.stillPending, [55]);
    assert.ok(
      !sink.error.some((m) => m.includes('persistent-lock')),
      'must not escalate below MAX_SWEEP_ATTEMPTS',
    );
    const post = readManifest(wtRoot);
    assert.equal(post[0].attempts, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
