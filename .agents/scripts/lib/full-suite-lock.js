/**
 * full-suite-lock.js — serialize the framework's full-suite spawns across
 * concurrent processes on one host (Story #5173).
 *
 * A full `npm test` / `npm run test:coverage` is the most expensive thing this
 * framework causes, and a multi-Story delivery runs several of them from
 * sibling worktrees of the same checkout. Two suites racing on one host do not
 * merely take twice as long — they contend for the same cores, and the
 * coverage artifact they both write is a single shared path per worktree, so
 * the loser's run is wasted work. This module makes the second spawn wait for
 * the first instead.
 *
 * **It reuses the shipped advisory-lock primitive**
 * (`single-story-sweep/sweep-lock.js`) rather than authoring a second
 * lockfile: pid+mtime identity, stale takeover, heartbeat and owner-checked
 * release are all already solved there, and a second implementation would be a
 * second set of those bugs. `phases/post-land.js` is the other consumer.
 *
 * **Posture: best-effort, never load-bearing.** Failing to acquire — a
 * contended wait that expires, an I/O error, an unresolvable lock home —
 * falls through to spawning the suite anyway. The lock is a collision damper,
 * not mutual exclusion; turning it load-bearing would let a stale lockfile
 * fail a delivery, which is strictly worse than the contention it prevents.
 *
 * **It covers only the spawn.** Callers acquire immediately around the child
 * process, never around the freshness/digest checks that precede it, so a
 * capture that is already credited never waits.
 */
import fs from 'node:fs';
import path from 'node:path';

import { mainCheckoutRoot } from './config/temp-paths.js';
import {
  acquireLockWithWait,
  acquireSweepLock,
  readLockHolderPid,
} from './single-story-sweep/sweep-lock.js';

/** Environment escape hatch: set to `0`/`false`/`off`/`no` to disable. */
export const FULL_SUITE_LOCK_ENV = 'MANDREL_FULL_SUITE_LOCK';

/**
 * Lockfile name, resolved under the **git common dir's parent** so every
 * linked worktree of one checkout contends on one file — the whole point of a
 * host-level lock is that `.worktrees/story-A` and `.worktrees/story-B` must
 * not each get their own.
 */
const FULL_SUITE_LOCK_FILENAME = 'mandrel-full-suite.lock';

/** Stale-holder threshold. A suite legitimately runs for minutes. */
const DEFAULT_STALE_MS = 15 * 60_000;

/** Total bounded wait before giving up and spawning anyway. */
const DEFAULT_WAIT_MS = 20 * 60_000;

/** Poll interval while waiting. */
const DEFAULT_POLL_MS = 2_000;

const FALSEY = /^(0|false|off|no)$/i;

/**
 * Is the full-suite lock enabled for this process?
 *
 * The environment wins over config so an operator can disable it for one
 * invocation without editing `.agentrc.json`. Both hatches are one-way: they
 * only ever turn the lock **off**, because an operator disabling a
 * best-effort damper is always safe while forcing it on is not.
 *
 * @param {{ config?: object, env?: Record<string, string|undefined> }} [opts]
 * @returns {boolean}
 */
export function isFullSuiteLockEnabled({ config, env = process.env } = {}) {
  const raw = env?.[FULL_SUITE_LOCK_ENV];
  if (typeof raw === 'string' && FALSEY.test(raw.trim())) return false;
  return config?.delivery?.execution?.fullSuiteLock !== false;
}

/**
 * Resolve the one lockfile path shared by a checkout and all of its linked
 * worktrees, or `null` when the checkout root cannot be resolved (not a git
 * repo, git unavailable). A `null` disables the lock for that call rather
 * than inventing a cwd-local path that would never actually collide with the
 * sibling it is meant to serialize against.
 *
 * @param {{ cwd: string, mainCheckoutRootFn?: typeof mainCheckoutRoot }} opts
 * @returns {string|null}
 */
export function resolveFullSuiteLockPath({
  cwd,
  mainCheckoutRootFn = mainCheckoutRoot,
}) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  const root = mainCheckoutRootFn(cwd);
  if (typeof root !== 'string' || root.length === 0) return null;
  return path.join(root, '.git', FULL_SUITE_LOCK_FILENAME);
}

/**
 * Emit the operator-facing wait line. Naming the holding pid is what keeps a
 * multi-minute wait from reading as a hang — it is the difference between
 * "nothing is happening" and "pid 4711 is running the suite; mine is next".
 *
 * @param {(m: string) => void} log
 * @param {string} lockPath
 * @param {object} fsImpl
 */
function logWait(log, lockPath, fsImpl) {
  const pid = readLockHolderPid(lockPath, fsImpl);
  log(
    `[full-suite-lock] ⏳ another full suite is already running on this host (holding pid ${pid ?? 'unknown'}) — waiting for it to finish before spawning.`,
  );
}

/**
 * Shared preamble for both wrappers: decide whether to lock at all, take the
 * uncontended fast path, and emit the wait line when a wait is about to
 * happen.
 *
 * @returns {{ lock: object|null, lockPath: string|null }} `lock` is a held
 *   lock when the fast path won, `null` when the caller must wait (or when
 *   locking is off, in which case `lockPath` is `null` too).
 */
function beginLock({
  cwd,
  enabled,
  log,
  staleMs,
  fsImpl,
  acquireOnceFn,
  lockPath: explicitLockPath,
}) {
  if (!enabled) return { lock: null, lockPath: null };
  const lockPath = explicitLockPath ?? resolveFullSuiteLockPath({ cwd });
  if (lockPath === null) return { lock: null, lockPath: null };
  const first = acquireOnceFn({
    lockPath,
    timeoutMs: staleMs,
    fsImpl,
  });
  if (first.acquired) return { lock: first, lockPath };
  // A hard I/O error will not resolve by waiting — proceed unserialized.
  if (first.reason === 'error') return { lock: null, lockPath: null };
  logWait(log, lockPath, fsImpl);
  return { lock: null, lockPath };
}

/**
 * Block a synchronous caller for `ms` without a timer. `runCapture` spawns the
 * suite with `spawnSync`, so its whole call stack is synchronous and there is
 * no event loop to yield to; `Atomics.wait` on a throwaway buffer is the
 * sanctioned way to sleep on that stack.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `spawn` with the full-suite lock held, from a **synchronous** caller.
 *
 * Never throws on the lock's account and always runs `spawn` exactly once:
 * every lock outcome — disabled, acquired, contended past the wait budget,
 * I/O error — ends in the same call, so a lock defect can slow a suite down
 * but can never skip or duplicate it.
 *
 * @template T
 * @param {{
 *   cwd: string,
 *   enabled?: boolean,
 *   log?: (m: string) => void,
 *   waitMs?: number,
 *   pollMs?: number,
 *   staleMs?: number,
 *   fsImpl?: object,
 *   nowFn?: () => number,
 *   sleepFn?: (ms: number) => void,
 *   acquireOnceFn?: typeof acquireSweepLock,
 *   lockPath?: string,
 * }} opts
 * @param {() => T} spawn
 * @returns {T}
 */
export function withFullSuiteLockSync(
  {
    cwd,
    enabled = true,
    log = () => {},
    waitMs = DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
    staleMs = DEFAULT_STALE_MS,
    fsImpl = fs,
    nowFn = Date.now,
    sleepFn = sleepSync,
    acquireOnceFn = acquireSweepLock,
    lockPath: explicitLockPath,
  },
  spawn,
) {
  const { lock, lockPath } = beginLock({
    cwd,
    enabled,
    log,
    staleMs,
    fsImpl,
    acquireOnceFn,
    lockPath: explicitLockPath,
  });
  let held = lock;
  if (held === null && lockPath !== null) {
    const deadline = nowFn() + Math.max(0, waitMs);
    for (;;) {
      if (nowFn() >= deadline) break;
      sleepFn(Math.max(0, pollMs));
      const attempt = acquireOnceFn({ lockPath, timeoutMs: staleMs, fsImpl });
      if (attempt.acquired) {
        held = attempt;
        break;
      }
      if (attempt.reason === 'error') break;
    }
  }
  try {
    return spawn();
  } finally {
    if (held?.acquired) held.release();
  }
}

/**
 * Decorate a capture runner so its spawn is serialized behind the host lock.
 *
 * The lock composes *over* `runCapture` rather than living inside it, for two
 * reasons. `runCapture` has no config in scope — it is reached from pre-push
 * and from unit tests as a pure spawn helper — and every decision that can
 * avoid the suite (the changed-file skip, the digest/mtime freshness probe)
 * happens in the capture paths *above* it. Wrapping the runner at the one
 * production call site therefore puts the lock exactly around the spawn: an
 * already-credited capture returns before the wrapper is ever invoked, so it
 * never waits (AC-9).
 *
 * @param {Function} runCaptureFn The runner to wrap (`runCapture`).
 * @param {object} [config] Resolved config; both escape hatches are read here.
 * @returns {Function} A runner with the same `(opts) => exitCode` contract.
 */
export function lockedCapture(runCaptureFn, config) {
  const enabled = isFullSuiteLockEnabled({ config });
  return (captureOpts = {}) =>
    withFullSuiteLockSync(
      { cwd: captureOpts.cwd, log: captureOpts.log, enabled },
      () => runCaptureFn(captureOpts),
    );
}

/**
 * Run `spawn` with the full-suite lock held, from an **async** caller.
 *
 * Same contract as {@link withFullSuiteLockSync}, but it waits on the shipped
 * promise-based `acquireLockWithWait` so it never blocks the event loop — the
 * close-validation gate runner drives sibling gates on that loop, and a
 * blocking wait there would stall them behind this one.
 *
 * @template T
 * @param {Parameters<typeof withFullSuiteLockSync>[0] & {
 *   acquireWithWaitFn?: typeof acquireLockWithWait,
 * }} opts
 * @param {() => Promise<T>} spawn
 * @returns {Promise<T>}
 */
export async function withFullSuiteLockAsync(
  {
    cwd,
    enabled = true,
    log = () => {},
    waitMs = DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
    staleMs = DEFAULT_STALE_MS,
    fsImpl = fs,
    acquireOnceFn = acquireSweepLock,
    acquireWithWaitFn = acquireLockWithWait,
    lockPath: explicitLockPath,
  },
  spawn,
) {
  const { lock, lockPath } = beginLock({
    cwd,
    enabled,
    log,
    staleMs,
    fsImpl,
    acquireOnceFn,
    lockPath: explicitLockPath,
  });
  let held = lock;
  if (held === null && lockPath !== null) {
    const waited = await acquireWithWaitFn({
      lockPath,
      waitMs,
      pollMs,
      timeoutMs: staleMs,
      fsImpl,
    });
    if (waited.acquired) held = waited;
  }
  try {
    return await spawn();
  } finally {
    if (held?.acquired) held.release();
  }
}
