import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  acquireEpicMergeLock,
  releaseEpicMergeLock,
} from '../../.agents/scripts/lib/epic-merge-lock.js';

describe('epic-merge-lock', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-lock-'));
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('acquires and releases a lock file', async () => {
    const handle = await acquireEpicMergeLock(42, { repoRoot, timeoutMs: 500 });
    assert.ok(fs.existsSync(handle.filePath), 'lock file should exist');
    const meta = JSON.parse(fs.readFileSync(handle.filePath, 'utf8'));
    assert.equal(meta.pid, process.pid);
    releaseEpicMergeLock(handle);
    assert.equal(
      fs.existsSync(handle.filePath),
      false,
      'lock file should be removed',
    );
  });

  it('blocks a second acquire until the first is released', async () => {
    const first = await acquireEpicMergeLock(7, { repoRoot, timeoutMs: 2000 });

    let secondAcquired = false;
    const secondPromise = acquireEpicMergeLock(7, {
      repoRoot,
      timeoutMs: 2000,
    }).then((h) => {
      secondAcquired = true;
      return h;
    });

    // Give the polling loop time to run a couple of times.
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      secondAcquired,
      false,
      'second acquire should still be waiting',
    );

    releaseEpicMergeLock(first);
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    assert.ok(fs.existsSync(second.filePath));
    releaseEpicMergeLock(second);
  });

  it('steals a stale lock whose PID is not running', async () => {
    const filePath = path.join(repoRoot, '.git', 'epic-99.merge.lock');
    // Fabricate a lock owned by an almost-certainly-dead PID.
    fs.writeFileSync(
      filePath,
      JSON.stringify({ pid: 999999999, acquiredAt: Date.now() }),
    );

    const handle = await acquireEpicMergeLock(99, {
      repoRoot,
      timeoutMs: 1000,
    });
    assert.ok(fs.existsSync(handle.filePath));
    const meta = JSON.parse(fs.readFileSync(handle.filePath, 'utf8'));
    assert.equal(meta.pid, process.pid, 'stolen lock should be re-owned');
    releaseEpicMergeLock(handle);
  });

  it('steals an ancient lock even when PID is still alive', async () => {
    const filePath = path.join(repoRoot, '.git', 'epic-101.merge.lock');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 60_000 }),
    );
    // Backdate the mtime far enough that it looks ancient under timeoutMs*2.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(filePath, past, past);

    const handle = await acquireEpicMergeLock(101, {
      repoRoot,
      timeoutMs: 1000, // stale threshold = 2000ms; 60s is well past that.
    });
    assert.ok(fs.existsSync(handle.filePath));
    releaseEpicMergeLock(handle);
  });

  it('throws when the lock cannot be acquired within the timeout', async () => {
    const first = await acquireEpicMergeLock(55, {
      repoRoot,
      timeoutMs: 2000,
    });

    await assert.rejects(
      acquireEpicMergeLock(55, { repoRoot, timeoutMs: 300 }),
      /timed out/,
    );

    releaseEpicMergeLock(first);
  });

  it('handles gracefully a corrupted JSON lock file when checking for timeout', async () => {
    const filePath = path.join(repoRoot, '.git', 'epic-66.merge.lock');
    fs.writeFileSync(filePath, '{ corrupted_json');

    // The lock is "held" (by the corrupted file) and timeout will expire.
    // It shouldn't crash while reading meta to construct the timeout error message.
    await assert.rejects(
      acquireEpicMergeLock(66, { repoRoot, timeoutMs: 300 }),
      /timed out after 300ms for epic 66/,
    );
  });
});
