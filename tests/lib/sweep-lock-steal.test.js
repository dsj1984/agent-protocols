/**
 * Story #5112 — the sweep lock's liveness and steal contract.
 *
 * The class of defect under test is an interleaving, not a value: a live
 * holder whose critical section outruns `timeoutMs` used to be indistinguish-
 * able from a crashed one, and a stale-breaker unlinked by path rather than by
 * identity, so two breakers could each unlink the other's fresh lockfile and
 * both proceed. Both are reproduced here with fakes — a fake clock, a fake
 * timer, and a fake `fs` whose inode counter models a real unlink/create —
 * because a test that waited out a real 60 s window would be untenable and a
 * test that raced real processes would be flaky.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  acquireSweepLock,
  heartbeatIntervalFor,
  readLockOwner,
  resolveSweepLockPath,
  sameLockIdentity,
} from '../../.agents/scripts/lib/single-story-sweep/sweep-lock.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

/**
 * An in-memory `fs` shim covering exactly the surface `sweep-lock.js` uses.
 * `ino` increments on every create, so an unlink + create is observably a
 * *different* file — which is the whole point of the identity-checked steal.
 *
 * @param {() => number} nowFn drives mtimes, so the fake clock is the only
 *   clock in the test.
 */
function makeFakeFs(nowFn) {
  const files = new Map();
  let nextIno = 1;
  return {
    files,
    mkdirSync() {},
    openSync(p) {
      if (files.has(p)) {
        const err = new Error(`EEXIST: ${p}`);
        err.code = 'EEXIST';
        throw err;
      }
      files.set(p, { body: '', mtimeMs: nowFn(), ino: nextIno++, dev: 7 });
      return p;
    },
    writeSync(fd, data) {
      files.get(fd).body += data;
    },
    closeSync() {},
    statSync(p) {
      const f = files.get(p);
      if (!f) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: f.mtimeMs, ino: f.ino, dev: f.dev };
    },
    readFileSync(p) {
      const f = files.get(p);
      if (!f) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return f.body;
    },
    utimesSync(p, _atime, mtime) {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT: ${p}`);
      f.mtimeMs = mtime.getTime();
    },
    unlinkSync(p) {
      if (!files.delete(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
    },
  };
}

/** A fake interval seam: the test fires the callback, not the event loop. */
function makeFakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setIntervalFn(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearIntervalFn(id) {
      timers.delete(id);
    },
    /** Run every live interval callback once. */
    tick() {
      for (const timer of [...timers.values()]) timer.fn();
    },
  };
}

const LOCK = '/fake/temp/merged-branch-sweep.lock';

describe('sweep-lock — heartbeat keeps a live holder alive (Story #5112)', () => {
  it('a second acquire is contended even past the 60s default timeoutMs', () => {
    let now = 1_000_000;
    const fsImpl = makeFakeFs(() => now);
    const timers = makeFakeTimers();

    const holder = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'holder-a',
      nowFn: () => now,
      fsImpl,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });
    assert.equal(holder.acquired, true);
    assert.equal(timers.timers.size, 1, 'the holder started a heartbeat');
    // Below the staleness threshold, so a refresh always lands in time.
    assert.ok([...timers.timers.values()][0].ms < 60_000);

    // The sweep runs long: advance well past the default 60s window, letting
    // the holder's heartbeat fire as it would in a live process.
    for (let elapsed = 0; elapsed < 120_000; elapsed += 20_000) {
      now += 20_000;
      timers.tick();
    }

    const second = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'holder-b',
      nowFn: () => now,
      fsImpl,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });
    assert.equal(second.acquired, false);
    assert.equal(second.reason, 'contended');
    assert.equal(readLockOwner(LOCK, fsImpl), 'holder-a');
  });

  it('without a heartbeat the same elapsed time reads stale (the pre-fix behaviour)', () => {
    let now = 1_000_000;
    const fsImpl = makeFakeFs(() => now);
    const holder = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'holder-a',
      nowFn: () => now,
      fsImpl,
      heartbeatMs: 0,
    });
    assert.equal(holder.acquired, true);

    now += 120_000;
    const second = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'holder-b',
      nowFn: () => now,
      fsImpl,
      heartbeatMs: 0,
    });
    assert.equal(second.acquired, true, 'stale steal still works when dead');
    assert.equal(readLockOwner(LOCK, fsImpl), 'holder-b');
  });

  it('stops heartbeating (and does not resurrect) a lock stolen from it', () => {
    const now = 1_000_000;
    const fsImpl = makeFakeFs(() => now);
    const timers = makeFakeTimers();
    const holder = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'holder-a',
      nowFn: () => now,
      fsImpl,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
    });
    assert.equal(holder.acquired, true);

    // Simulate a steal: someone else now owns the file at this path.
    fsImpl.unlinkSync(LOCK);
    fsImpl.openSync(LOCK);
    fsImpl.writeSync(LOCK, 'holder-c\n');

    timers.tick();
    assert.equal(timers.timers.size, 0, 'heartbeat stopped on owner mismatch');
    // And release must not drop the new owner's lock.
    holder.release();
    assert.equal(readLockOwner(LOCK, fsImpl), 'holder-c');
  });

  it('heartbeatIntervalFor stays strictly under the staleness window', () => {
    assert.ok(heartbeatIntervalFor(60_000) < 60_000);
    assert.equal(heartbeatIntervalFor(60_000), 20_000);
    // Floor: never sub-second, however small the configured timeout.
    assert.equal(heartbeatIntervalFor(30), 1_000);
  });
});

describe('sweep-lock — two stale-breakers yield exactly one acquisition', () => {
  it('the loser does not unlink the winner’s fresh lockfile', () => {
    let now = 1_000_000;
    const fsImpl = makeFakeFs(() => now);

    // A crashed holder leaves a lockfile behind.
    fsImpl.openSync(LOCK);
    fsImpl.writeSync(LOCK, 'crashed-owner\n');
    const crashedIno = fsImpl.statSync(LOCK).ino;
    now += 120_000;

    const breakerA = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'breaker-a',
      nowFn: () => now,
      fsImpl,
      heartbeatMs: 0,
    });
    const breakerB = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'breaker-b',
      nowFn: () => now,
      fsImpl,
      heartbeatMs: 0,
    });

    const acquisitions = [breakerA, breakerB].filter((r) => r.acquired);
    assert.equal(acquisitions.length, 1, 'exactly one breaker acquired');
    assert.equal(breakerA.acquired, true);
    assert.equal(breakerB.acquired, false);
    assert.equal(breakerB.reason, 'contended');

    // The winner's lockfile is a genuinely new file and is still there: the
    // loser observed the *crashed* file's identity, re-statted, saw a
    // different inode, and refused to unlink.
    assert.equal(readLockOwner(LOCK, fsImpl), 'breaker-a');
    assert.notEqual(fsImpl.statSync(LOCK).ino, crashedIno);
  });

  it('refuses the steal when the observed file was replaced under it', () => {
    let now = 1_000_000;
    const fsImpl = makeFakeFs(() => now);
    fsImpl.openSync(LOCK);
    fsImpl.writeSync(LOCK, 'crashed-owner\n');
    now += 120_000;

    // Replace the file between the staleness stat and the identity re-stat by
    // making the second stat report a different inode.
    const realStat = fsImpl.statSync.bind(fsImpl);
    let stats = 0;
    fsImpl.statSync = (p) => {
      const st = realStat(p);
      stats += 1;
      return stats === 1 ? st : { ...st, ino: st.ino + 100 };
    };

    const result = acquireSweepLock({
      lockPath: LOCK,
      ownerId: 'breaker-a',
      nowFn: () => now,
      fsImpl,
      heartbeatMs: 0,
    });
    assert.equal(result.acquired, false);
    assert.equal(result.reason, 'contended');
    assert.equal(
      readLockOwner(LOCK, fsImpl),
      'crashed-owner',
      'the observed-but-changed file was left alone',
    );
  });

  it('sameLockIdentity treats an absent file as never the same', () => {
    const id = { mtimeMs: 1, ino: 2, dev: 3 };
    assert.equal(sameLockIdentity(id, { ...id }), true);
    assert.equal(sameLockIdentity(id, { ...id, ino: 9 }), false);
    assert.equal(sameLockIdentity(id, null), false);
    assert.equal(sameLockIdentity(null, id), false);
  });
});

describe('sweep-lock — release is owner-checked', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempDir('sweep-lock-steal-');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('a late release leaves the current holder’s lock in place (real fs)', () => {
    const lockPath = path.join(tmpDir, 'sweep.lock');
    const first = acquireSweepLock({ lockPath, ownerId: 'first' });
    assert.equal(first.acquired, true);

    // First "crashes" without releasing; a later run steals the stale lock.
    const oldTime = Date.now() / 1000 - 600;
    fs.utimesSync(lockPath, oldTime, oldTime);
    const second = acquireSweepLock({ lockPath, ownerId: 'second' });
    assert.equal(second.acquired, true);

    // The zombie's release must be a no-op — the file is not its lock.
    first.release();
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(readLockOwner(lockPath), 'second');

    second.release();
    assert.equal(fs.existsSync(lockPath), false);
  });
});

describe('sweep-lock — one lock for the merged-branch reap (Story #5112)', () => {
  it('resolveSweepLockPath is deterministic under the tempRoot', () => {
    const a = resolveSweepLockPath({ cwd: '/repo', tempRoot: 'temp' });
    const b = resolveSweepLockPath({ cwd: '/repo', tempRoot: 'temp' });
    assert.equal(a, b);
    assert.equal(a, path.resolve('/repo', 'temp', 'merged-branch-sweep.lock'));
  });

  it('defaults the tempRoot to temp/', () => {
    assert.equal(
      resolveSweepLockPath({ cwd: '/repo' }),
      path.resolve('/repo', 'temp', 'merged-branch-sweep.lock'),
    );
  });
});
