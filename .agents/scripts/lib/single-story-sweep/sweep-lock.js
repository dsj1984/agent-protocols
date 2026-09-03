/**
 * single-story-sweep/sweep-lock.js
 *
 * Story #2011: best-effort cross-session lock for the
 * `single-story-sweep` step in `single-story-init.js`. Without a lock,
 * two concurrent `/single-story-deliver` invocations can each compute
 * candidate sets, then each call `executeCleanup` against branches the
 * other was about to act on — producing the "story-2004 toggles in and
 * out of `git worktree list`" pattern observed during Story #2007's
 * session.
 *
 * The lock primitive is a single-file rendezvous:
 *
 *   - `acquireSweepLock({ lockPath, timeoutMs })` opens the file with
 *     `wx` so concurrent attempts fail at the syscall layer (atomic
 *     create-or-error).
 *   - A stale lockfile (mtime older than `timeoutMs`) is treated as
 *     expired and replaced — protects against operators who Ctrl-C
 *     mid-init.
 *   - The returned `release` callback unlinks the file. A process
 *     `'exit'` listener also unlinks as a belt-and-braces guard.
 *
 * The lock is never load-bearing: the caller (`single-story-init.js`)
 * skips the sweep when the lock is contended and continues with init.
 * That matches the existing "sweep never blocks init" contract.
 *
 * **Story #5112 — a live holder is never mistaken for a crashed one.**
 * The critical section this guards (per-candidate `gh pr view`, `getTicket`,
 * `push --delete`) is unbounded, so a healthy sweep can easily outlive the
 * 60 s staleness threshold. Three changes close that:
 *
 *   1. **Heartbeat.** The holder refreshes the lockfile mtime on an
 *      unref'd interval below `timeoutMs`, so an alive holder never reads
 *      stale no matter how long its critical section runs.
 *   2. **Identity-checked steal.** A stale-breaker re-stats before it
 *      unlinks and only removes the *exact* file it observed (same
 *      dev/ino/mtime). Two concurrent breakers therefore yield exactly one
 *      acquisition — the loser cannot unlink the winner's fresh lockfile.
 *   3. **Owner-checked release.** `release()` unlinks only a lockfile whose
 *      owner line still matches this holder, so a late release never drops
 *      someone else's lock.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Floor for the heartbeat interval. Below this the refresh cost starts to
 * matter for a short critical section, and no `timeoutMs` this framework
 * configures is small enough to need it.
 */
const MIN_HEARTBEAT_MS = 1_000;

/**
 * Divisor applied to `timeoutMs` to derive the default heartbeat interval.
 * Three refreshes per staleness window means two consecutive missed refreshes
 * (a stalled event loop, a slow disk) still do not make a live holder look
 * dead.
 */
const HEARTBEAT_DIVISOR = 3;

/**
 * Canonical filename for the merged-branch sweep lock. One critical section
 * (`sweepMergedBranches` over `story-*`) reached by two entry points —
 * `single-story-init.js` and `boot-sweep.js` — so it gets one lockfile.
 * Before Story #5112 they used `single-story-sweep.lock` and
 * `boot-sweep.lock` respectively and could therefore run the same reap
 * concurrently, each acting on branches the other was mid-delete on. Callers
 * resolve it through {@link resolveSweepLockPath} rather than by name.
 */
const MERGED_BRANCH_SWEEP_LOCK_FILENAME = 'merged-branch-sweep.lock';

/**
 * Resolve the one merged-branch sweep lock path. Both sweep entry points
 * MUST route through this helper — that is what makes "one critical section,
 * one lock" checkable rather than a convention two files can silently drift
 * apart on.
 *
 * @param {{ cwd: string, tempRoot?: string }} args
 * @returns {string} absolute path to the shared lockfile.
 */
export function resolveSweepLockPath({ cwd, tempRoot = 'temp' } = {}) {
  return path.resolve(cwd, tempRoot, MERGED_BRANCH_SWEEP_LOCK_FILENAME);
}

/**
 * Derive the heartbeat interval for a given staleness threshold. Module-
 * private: the contract that matters ("strictly below `timeoutMs`") is
 * observable at the `setIntervalFn` seam {@link acquireSweepLock} accepts, so
 * a test pins it there rather than reaching past the public surface.
 *
 * @param {number} timeoutMs
 * @returns {number}
 */
function heartbeatIntervalFor(timeoutMs) {
  const derived = Math.floor(
    (Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS) /
      HEARTBEAT_DIVISOR,
  );
  return Math.max(MIN_HEARTBEAT_MS, derived);
}

/**
 * Read the lockfile's *identity* — the tuple that distinguishes "the file I
 * observed" from "a different file that now sits at the same path". `dev` +
 * `ino` change when a lockfile is unlinked and re-created, and `mtimeMs`
 * changes on every heartbeat, so a steal that re-checks all three cannot
 * remove a lock some other process created (or refreshed) in the interim.
 *
 * Returns `null` when the file is absent or stat fails ("no holder").
 *
 * @param {string} lockPath
 * @param {object} [fsImpl]
 * Module-private: the two readers that need it (the stale takeover and the
 * `readLockMtime` projection below) both live here, and nothing outside this
 * primitive should be reasoning about a lockfile's inode.
 *
 * @returns {{ mtimeMs: number, ino: number|null, dev: number|null }|null}
 */
function readLockIdentity(lockPath, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(lockPath);
    return {
      mtimeMs: stat.mtimeMs,
      ino: stat.ino ?? null,
      dev: stat.dev ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Pure: read the lockfile mtime. Returns `null` when the file is absent or
 * stat fails (treat as "no holder"). The mtime projection of
 * {@link readLockIdentity}. Exported for tests.
 */
export function readLockMtime(lockPath, fsImpl = fs) {
  return readLockIdentity(lockPath, fsImpl)?.mtimeMs ?? null;
}

/**
 * Read the owner id a lockfile was created with (its first line). Returns
 * `null` when the file is absent, unreadable, or empty. Module-private — the
 * owner line is an implementation detail of this primitive; callers observe
 * ownership through which acquire wins and which `release()` is a no-op.
 *
 * @param {string} lockPath
 * @param {object} [fsImpl]
 * @returns {string|null}
 */
function readLockOwner(lockPath, fsImpl = fs) {
  try {
    const raw = fsImpl.readFileSync(lockPath, 'utf8');
    const first = String(raw).split('\n', 1)[0];
    return first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

/**
 * Pure: do two identity tuples describe the same lockfile instance? A `null`
 * on either side is "not the same" — an absent file is never the file we
 * observed. Module-private, like {@link readLockIdentity} it compares:
 * nothing outside this primitive should reason about a lockfile's inode.
 *
 * @param {ReturnType<typeof readLockIdentity>} a
 * @param {ReturnType<typeof readLockIdentity>} b
 * @returns {boolean}
 */
function sameLockIdentity(a, b) {
  if (!a || !b) return false;
  return a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev;
}

/**
 * Pure: is the lockfile mtime older than `timeoutMs`? A `null` mtime
 * (no file) returns `false` — the lock isn't held, there's nothing to
 * be stale. Exported for tests.
 */
export function isLockStale(mtime, nowMs, timeoutMs) {
  if (mtime === null) return false;
  return nowMs - mtime > timeoutMs;
}

/**
 * Attempt to atomically create the lockfile. Returns `true` on success,
 * `false` when another process holds it. Any other I/O error throws.
 *
 * Uses `fs.openSync(path, 'wx')` — the `'wx'` flag combination is
 * `O_CREAT | O_EXCL | O_WRONLY` which fails with `EEXIST` if the file
 * already exists. Atomic on POSIX and on Windows ReFS/NTFS.
 */
function tryCreateLock(lockPath, ownerId, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = fsImpl.openSync(lockPath, 'wx');
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  }
  try {
    fsImpl.writeSync(
      fd,
      `${ownerId}\n${new Date().toISOString()}\n${process.pid}\n`,
    );
  } finally {
    fsImpl.closeSync(fd);
  }
  return true;
}

/**
 * Acquire the sweep lock. Returns one of:
 *
 *   - `{ acquired: true, release: () => void, ownerId }`
 *   - `{ acquired: false, reason: 'contended' | 'error', detail?: string }`
 *
 * When a stale lockfile is found (mtime older than `timeoutMs`), it is
 * unlinked and a fresh acquire is retried once. If the retry also
 * loses the race (another caller acquired between the unlink and the
 * retry), the caller gets `acquired: false, reason: 'contended'` and
 * may decide to skip the sweep — same as a fresh contention.
 *
 * @param {object} opts
 * @param {string} opts.lockPath           Absolute path to the lockfile.
 * @param {number} [opts.timeoutMs=60000]  Stale-lock threshold.
 * @param {string} [opts.ownerId]          Identifier persisted into the
 *                                         lockfile body for postmortem;
 *                                         defaults to a pid+timestamp
 *                                         string.
 * @param {object} [opts.nowFn]            `() => number` (ms epoch);
 *                                         injection seam for tests.
 * @param {object} [opts.fsImpl]           Node `fs` shim for tests.
 * @param {number} [opts.heartbeatMs]      Mtime-refresh interval for a live
 *                                         holder; defaults to a third of
 *                                         `timeoutMs`. `0` disables it.
 * @param {Function} [opts.setIntervalFn]  Timer seam for tests.
 * @param {Function} [opts.clearIntervalFn] Timer seam for tests.
 * @returns {{ acquired: true, release: () => void, ownerId: string }
 *          | { acquired: false, reason: 'contended' | 'error', detail?: string }}
 */
export function acquireSweepLock({
  lockPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ownerId,
  nowFn = Date.now,
  fsImpl = fs,
  heartbeatMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (typeof lockPath !== 'string' || lockPath.length === 0) {
    return {
      acquired: false,
      reason: 'error',
      detail: 'lockPath is required',
    };
  }
  const id = ownerId ?? `pid-${process.pid}-${nowFn()}`;
  const holder = {
    lockPath,
    ownerId: id,
    fsImpl,
    nowFn,
    heartbeatMs: heartbeatMs ?? heartbeatIntervalFor(timeoutMs),
    setIntervalFn,
    clearIntervalFn,
  };
  try {
    if (
      tryCreateLock(lockPath, id, fsImpl) ||
      tryStaleTakeover(holder, timeoutMs)
    ) {
      return buildAcquired(holder);
    }
    return { acquired: false, reason: 'contended' };
  } catch (err) {
    return {
      acquired: false,
      reason: 'error',
      detail: err?.message ?? String(err),
    };
  }
}

/**
 * Take over a lockfile whose holder looks dead. Returns `true` only when this
 * call both removed the exact stale file it observed *and* won the re-create,
 * so two concurrent breakers yield exactly one acquisition.
 *
 * @param {{ lockPath: string, ownerId: string, fsImpl: object, nowFn: () => number }} holder
 * @param {number} timeoutMs
 * @returns {boolean}
 */
function tryStaleTakeover({ lockPath, ownerId, fsImpl, nowFn }, timeoutMs) {
  const observed = readLockIdentity(lockPath, fsImpl);
  if (observed === null) return false;
  if (!isLockStale(observed.mtimeMs, nowFn(), timeoutMs)) return false;
  return (
    breakStaleLock(lockPath, observed, fsImpl) &&
    tryCreateLock(lockPath, ownerId, fsImpl)
  );
}

/**
 * Unlink a stale lockfile — but only when it is still byte-for-byte the
 * instance the caller observed. Returns `true` when this call removed that
 * exact file, `false` when the file changed underneath us (a heartbeat, or
 * another breaker's replacement) or the unlink failed. A `false` return means
 * "someone else owns this now": the caller reports contended rather than
 * racing on.
 *
 * @param {string} lockPath
 * @param {ReturnType<typeof readLockIdentity>} observed
 * @param {object} fsImpl
 * @returns {boolean}
 */
function breakStaleLock(lockPath, observed, fsImpl) {
  if (!sameLockIdentity(observed, readLockIdentity(lockPath, fsImpl))) {
    return false;
  }
  try {
    fsImpl.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refresh a held lockfile's mtime so a long critical section never reads
 * stale to a concurrent acquirer. Refuses to touch a lockfile whose owner
 * line is no longer ours — after a steal the file belongs to someone else and
 * bumping its mtime would keep *their* lock alive on our behalf.
 *
 * @returns {boolean} `true` when the refresh landed; `false` when the lock is
 *   no longer ours (the caller stops heartbeating).
 */
function refreshLockMtime({ lockPath, ownerId, fsImpl, nowFn }) {
  if (readLockOwner(lockPath, fsImpl) !== ownerId) return false;
  try {
    const stamp = new Date(nowFn());
    fsImpl.utimesSync(lockPath, stamp, stamp);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the holder's mtime heartbeat. Returns a `stop()` that is safe to call
 * repeatedly. The timer is unref'd where the platform supports it, so a
 * forgotten release can never hold the process open.
 */
function startHeartbeat(holder) {
  const { heartbeatMs, setIntervalFn, clearIntervalFn } = holder;
  if (!(heartbeatMs > 0) || typeof setIntervalFn !== 'function') {
    return () => {};
  }
  let timer = null;
  const stop = () => {
    if (timer === null) return;
    const handle = timer;
    timer = null;
    try {
      clearIntervalFn(handle);
    } catch {
      // Best-effort: a fake timer seam may not implement clear.
    }
  };
  timer = setIntervalFn(() => {
    if (!refreshLockMtime(holder)) stop();
  }, heartbeatMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return stop;
}

/**
 * Drop a lockfile, but only when it is still stamped with `ownerId`. A
 * lockfile another holder created after ours was stolen (or stale-broken) is
 * theirs — dropping it would hand a third caller a lock the current holder
 * still believes it owns.
 *
 * @param {string} lockPath
 * @param {string} ownerId
 * @param {object} fsImpl
 */
function unlinkIfOwned(lockPath, ownerId, fsImpl) {
  if (readLockOwner(lockPath, fsImpl) !== ownerId) return;
  try {
    fsImpl.unlinkSync(lockPath);
  } catch {
    // Already gone — nothing to do.
  }
}

function buildAcquired(holder) {
  const { lockPath, ownerId, fsImpl } = holder;
  const stopHeartbeat = startHeartbeat(holder);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stopHeartbeat();
    unlinkIfOwned(lockPath, ownerId, fsImpl);
  };
  // Belt-and-braces: process exit also clears the lockfile so a
  // crashed run doesn't leave a stale-but-not-yet-old artifact behind.
  const exitCleanup = () => release();
  if (typeof process.once === 'function') {
    process.once('exit', exitCleanup);
  }
  return { acquired: true, release, ownerId };
}

const DEFAULT_WAIT_MS = 8_000;
const DEFAULT_POLL_MS = 150;

/**
 * Promise-based delay. Injectable so tests can drive the wait loop on a fake
 * clock without a real timer.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Bounded-wait wrapper over {@link acquireSweepLock}.
 *
 * `acquireSweepLock` is single-attempt on purpose: a *skipped* sweep is
 * harmless, so the sweep caller proceeds immediately on contention. The
 * post-land tail is the opposite case — proceeding immediately IS the race
 * two concurrent closes hit on a shared main checkout — so this wrapper
 * polls the primitive with short backoff up to `waitMs` before giving up.
 *
 * It is still **never load-bearing**: on `waitMs` exhaustion it returns
 * `{ acquired: false, reason: 'contended-after-wait' }` and the caller is
 * expected to proceed anyway. The bounded wait is a best-effort collision
 * damper, not a mutual-exclusion guarantee. A hard I/O error short-circuits
 * the loop (spinning would just re-hit it).
 *
 * @param {object} opts
 * @param {string} opts.lockPath
 * @param {number} [opts.waitMs]     Max total time to wait for the lock.
 * @param {number} [opts.pollMs]     Delay between acquire attempts.
 * @param {number} [opts.timeoutMs]  Stale-lock expiry, forwarded to the
 *                                   underlying acquire.
 * @param {string} [opts.ownerId]
 * @param {() => number} [opts.nowFn]
 * @param {(ms: number) => Promise<void>} [opts.sleepFn]
 * @param {object} [opts.fsImpl]
 * @param {number} [opts.heartbeatMs]      Forwarded to the underlying acquire.
 * @param {Function} [opts.setIntervalFn]  Forwarded to the underlying acquire.
 * @param {Function} [opts.clearIntervalFn] Forwarded to the underlying acquire.
 * @returns {Promise<{ acquired: true, release: () => void, ownerId: string }
 *          | { acquired: false, reason: 'contended-after-wait' | 'error', detail?: string }>}
 */
export async function acquireLockWithWait({
  lockPath,
  waitMs = DEFAULT_WAIT_MS,
  pollMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ownerId,
  nowFn = Date.now,
  sleepFn = defaultSleep,
  fsImpl = fs,
  heartbeatMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const deadline = nowFn() + Math.max(0, waitMs);
  for (;;) {
    const res = acquireSweepLock({
      lockPath,
      timeoutMs,
      ownerId,
      nowFn,
      fsImpl,
      heartbeatMs,
      setIntervalFn,
      clearIntervalFn,
    });
    if (res.acquired) return res;
    // A hard error will not resolve by retrying — surface it immediately.
    if (res.reason === 'error') return res;
    if (nowFn() >= deadline) {
      return { acquired: false, reason: 'contended-after-wait' };
    }
    await sleepFn(Math.max(0, pollMs));
  }
}
