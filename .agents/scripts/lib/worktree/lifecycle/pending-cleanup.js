/**
 * worktree/lifecycle/pending-cleanup.js
 *
 * Stage 2 of the Windows worktree reap fallback (see #386).
 *
 * When Stage 1 (`removeWorktreeWithRecovery` → `fs.rm`) exhausts its retries
 * on a Windows lock-class failure, the entry is appended to
 * `.worktrees/.pending-cleanup.json`. The plan-time `worktree-sweep.js`
 * reader (shipped in Epic #349) picks up the manifest on the next
 * `/mandrel-plan` run and retries removal
 * (`git worktree remove` then `fs.rm`) — by then the live file handles from Node / AV / the Windows
 * Search indexer are almost always gone. If `MAX_SWEEP_ATTEMPTS` elapses
 * without clearing, an `OPERATOR ACTION REQUIRED: persistent-lock` line
 * fires and the entry stays in the manifest so the signal persists.
 *
 * The manifest itself lives under `.worktrees/`, which is already
 * git-ignored; no tracked state is mutated.
 *
 * **Story #5112 — the manifest is shared mutable state.** `recordPendingCleanup`
 * runs from the close reap and `drainPendingCleanup` runs from the `/mandrel-plan`
 * boot, so two concurrent delivery sessions can read-modify-write the same
 * file. Three properties close that:
 *
 *   1. **Atomic write.** Every write lands in a pid-scoped temp file and is
 *      then `rename`d over the manifest, so a reader never observes a half-
 *      written array (`readManifest` treats a torn or absent file as empty,
 *      which used to silently *drop* the backlog).
 *   2. **Mutual exclusion.** Read-modify-write runs under the shared
 *      `acquireSweepLock` primitive on a manifest-adjacent lockfile.
 *   3. **Merge before write.** The drain holds its snapshot across awaited
 *      removals, so it re-reads and merges by `storyId` before its final
 *      write — an entry recorded mid-drain survives instead of being erased
 *      by a stale snapshot.
 */

import fs from 'node:fs';
import { rm as fsPromisesRm } from 'node:fs/promises';
import path from 'node:path';
import { NOOP_LOGGER } from '../../Logger.js';
import { acquireSweepLock } from '../../single-story-sweep/sweep-lock.js';

const MANIFEST_FILENAME = '.pending-cleanup.json';
const MANIFEST_LOCK_FILENAME = '.pending-cleanup.lock';

/**
 * Staleness threshold for the manifest lock. Deliberately short: the guarded
 * section is a read, an in-memory merge and a rename — milliseconds — so a
 * lockfile older than this is a crashed holder, not a slow one.
 */
const MANIFEST_LOCK_TIMEOUT_MS = 5_000;
/**
 * After a reap hands off to the manifest, `attempts` counts failed
 * `drainPendingCleanup` passes (initial hand-off uses `attempts: 0`). The entry
 * becomes `persistent` when `attempts` reaches this threshold after another
 * failed drain (i.e. three consecutive sweep failures).
 */
export const MAX_SWEEP_ATTEMPTS = 3;

export function manifestPath(worktreeRoot) {
  return path.join(worktreeRoot, MANIFEST_FILENAME);
}

/**
 * Path of the lockfile guarding manifest read-modify-write. Manifest-adjacent
 * (same gitignored `.worktrees/` directory) so it needs no extra config and
 * shares the manifest's lifetime. Module-private: the lock is internal to
 * this manifest's read-modify-write, and callers only ever observe that a
 * mutation completed and left nothing behind.
 *
 * @param {string} worktreeRoot
 * @returns {string}
 */
function manifestLockPath(worktreeRoot) {
  return path.join(worktreeRoot, MANIFEST_LOCK_FILENAME);
}

/**
 * Run `fn` under the manifest lock. Best-effort in the same sense as every
 * other use of this primitive: on contention the work still runs (the
 * merge-before-write below is what makes a lost race non-destructive), so a
 * stuck lockfile can never wedge a reap. Always releases.
 *
 * @template T
 * @param {string} worktreeRoot
 * @param {() => T} fn
 * @returns {T}
 */
function withManifestLock(worktreeRoot, fn) {
  const lock = acquireSweepLock({
    lockPath: manifestLockPath(worktreeRoot),
    timeoutMs: MANIFEST_LOCK_TIMEOUT_MS,
  });
  try {
    return fn();
  } finally {
    if (lock.acquired) {
      try {
        lock.release();
      } catch {
        // Release is best-effort; a stale lockfile expires on its own.
      }
    }
  }
}

export function readManifest(worktreeRoot) {
  const p = manifestPath(worktreeRoot);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Write the manifest atomically: serialize into a pid-scoped temp file in the
 * same directory (so `rename` stays within one filesystem and is therefore
 * atomic), then rename it over the manifest. A concurrent reader sees either
 * the whole previous manifest or the whole new one — never a truncated array
 * that `readManifest`'s catch would silently turn into "no pending cleanups".
 */
function writeManifest(worktreeRoot, entries) {
  const p = manifestPath(worktreeRoot);
  if (!Array.isArray(entries) || entries.length === 0) {
    try {
      fs.unlinkSync(p);
    } catch {
      // Manifest already absent — nothing to drop.
    }
    return;
  }
  fs.mkdirSync(worktreeRoot, { recursive: true });
  writeFileAtomic(p, `${JSON.stringify(entries, null, 2)}\n`);
}

/**
 * Write `contents` to `targetPath` atomically: serialize into a pid-scoped
 * temp file beside it (same directory, so the rename stays within one
 * filesystem and is therefore atomic), then rename it into place. On failure
 * the temp file is reaped and the error propagates — a half-written file is
 * never left where a reader could pick it up.
 *
 * @param {string} targetPath
 * @param {string} contents
 */
function writeFileAtomic(targetPath, contents) {
  const tmp = `${targetPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, contents, 'utf8');
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    reapTempFile(tmp);
    throw err;
  }
}

/** Best-effort removal of an abandoned atomic-write temp file. */
function reapTempFile(tmp) {
  try {
    fs.unlinkSync(tmp);
  } catch {
    // Temp file already gone (or never created) — nothing to reap.
  }
}

/**
 * Upsert a pending-cleanup entry by storyId. Preserves `firstFailedAt` on
 * repeated failures; always updates `lastFailedAt` and increments
 * `attempts`. New rows start at `attempts: 0` (hand-off, not yet a failed
 * sweep). Called by Stage 1 when fs.rm exhausts its retries.
 */
export function recordPendingCleanup(
  worktreeRoot,
  { storyId, branch, path: wtPath, push = false },
) {
  // The read, the merge and the write are one critical section: without the
  // lock a concurrent drain's write can land between our read and our write
  // and erase this hand-off entirely.
  return withManifestLock(worktreeRoot, () => {
    const now = new Date().toISOString();
    const entries = readManifest(worktreeRoot);
    const idx = entries.findIndex((e) => e.storyId === storyId);
    if (idx >= 0) {
      entries[idx] = {
        ...entries[idx],
        branch,
        path: wtPath,
        push,
        lastFailedAt: now,
        attempts: (entries[idx].attempts ?? 0) + 1,
      };
    } else {
      entries.push({
        storyId,
        branch,
        path: wtPath,
        push,
        firstFailedAt: now,
        lastFailedAt: now,
        attempts: 0,
      });
    }
    writeManifest(worktreeRoot, entries);
    return entries.find((e) => e.storyId === storyId);
  });
}

export function removePendingCleanup(worktreeRoot, storyId) {
  withManifestLock(worktreeRoot, () => {
    const entries = readManifest(worktreeRoot).filter(
      (e) => e.storyId !== storyId,
    );
    writeManifest(worktreeRoot, entries);
  });
}

async function removeStuckWorktreePath(wtPath, { git, repoRoot, fsRm }) {
  if (!fs.existsSync(wtPath)) return { ok: true };
  let rm = git.gitSpawn(repoRoot, 'worktree', 'remove', wtPath);
  if (rm.status !== 0) {
    rm = git.gitSpawn(repoRoot, 'worktree', 'remove', '--force', wtPath);
  }
  if (fs.existsSync(wtPath)) {
    try {
      await fsRm(wtPath, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: err };
    }
  }
  if (fs.existsSync(wtPath)) {
    return {
      ok: false,
      error: new Error(
        `path still exists after worktree remove + fs.rm: ${wtPath}`,
      ),
    };
  }
  return { ok: true };
}

function sweepBranchLocal(branch, { git, repoRoot, logger }) {
  const localDel = git.gitSpawn(repoRoot, 'branch', '-D', branch);
  if (localDel.status === 0) return true;
  const stderr = (localDel.stderr || localDel.stdout || '').trim();
  if (/not found|no such|not match/i.test(stderr)) return true;
  logger.warn(
    `worktree-sweep: branch -D ${branch} failed: ${stderr || 'unknown'} (continuing)`,
  );
  return false;
}

function sweepBranchRemote(branch, { git, repoRoot, logger }) {
  const remoteDel = git.gitSpawn(
    repoRoot,
    'push',
    '--no-verify',
    'origin',
    '--delete',
    branch,
  );
  if (remoteDel.status === 0) return true;
  const stderr = (remoteDel.stderr || remoteDel.stdout || '').trim();
  if (/remote ref does not exist|not found/i.test(stderr)) return true;
  logger.warn(
    `worktree-sweep: push --delete ${branch} failed: ${stderr || 'unknown'} (continuing)`,
  );
  return false;
}

function sweepBranchCleanup(entry, ctx) {
  const { branch, push } = entry;
  if (!branch) return { localBranchDeleted: null, remoteBranchDeleted: null };
  const localBranchDeleted = sweepBranchLocal(branch, ctx);
  const remoteBranchDeleted = push ? sweepBranchRemote(branch, ctx) : null;
  return { localBranchDeleted, remoteBranchDeleted };
}

async function retryStage1ForEntry(entry, ctx) {
  const removal = await removeStuckWorktreePath(entry.path, ctx);
  if (!removal.ok) {
    return { success: false, error: removal.error };
  }
  ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'prune');
  const cleanup = sweepBranchCleanup(entry, ctx);
  return { success: true, ...cleanup };
}

/**
 * Write the drain's result, merged against whatever the manifest holds *now*.
 *
 * The drain awaits a removal per entry, so its `entries` snapshot can be
 * minutes old by the time it writes. Writing that snapshot back wholesale
 * erased any entry a concurrent `recordPendingCleanup` added mid-drain — the
 * exact hand-off that reap had just decided it could not complete. Merging by
 * `storyId` keeps it: rows this pass re-computed win, rows it successfully
 * drained are dropped, and everything else the manifest has gained survives.
 *
 * @param {string} worktreeRoot
 * @param {object[]} next          Rows this drain re-computed (still pending).
 * @param {Set<number|string>} drainedIds Story ids this drain cleared.
 */
function commitDrainedManifest(worktreeRoot, next, drainedIds) {
  withManifestLock(worktreeRoot, () => {
    const byId = new Map(next.map((entry) => [entry.storyId, entry]));
    for (const entry of readManifest(worktreeRoot)) {
      if (byId.has(entry.storyId)) continue;
      if (drainedIds.has(entry.storyId)) continue;
      byId.set(entry.storyId, entry);
    }
    writeManifest(worktreeRoot, [...byId.values()]);
  });
}

/**
 * Drain the pending-cleanup manifest: for each entry, retry Stage 1
 * cleanup. Successful entries are removed; failing entries have their
 * `attempts` incremented. Entries whose attempts reach `MAX_SWEEP_ATTEMPTS`
 * trigger an `OPERATOR ACTION REQUIRED: persistent-lock` log line but
 * remain in the manifest so the signal persists across subsequent sweeps.
 */
export async function drainPendingCleanup({
  repoRoot,
  worktreeRoot,
  git,
  fsRm = fsPromisesRm,
  logger = NOOP_LOGGER,
}) {
  const entries = readManifest(worktreeRoot);
  if (entries.length === 0) {
    return {
      drained: [],
      drainedDetails: [],
      persistent: [],
      persistentDetails: [],
      stillPending: [],
      stillPendingDetails: [],
    };
  }

  const drained = [];
  const drainedDetails = [];
  const persistent = [];
  const persistentDetails = [];
  const stillPending = [];
  const stillPendingDetails = [];
  const next = [];

  for (const entry of entries) {
    const result = await retryStage1ForEntry(entry, {
      git,
      repoRoot,
      fsRm,
      logger,
    });
    if (result.success) {
      drained.push(entry.storyId);
      drainedDetails.push({
        storyId: entry.storyId,
        path: entry.path,
        branch: entry.branch,
        localBranchDeleted: result.localBranchDeleted,
        remoteBranchDeleted: result.remoteBranchDeleted,
      });
      logger.info(
        `worktree-sweep: drained pending-cleanup storyId=${entry.storyId} path=${entry.path}`,
      );
      continue;
    }
    const updatedAttempts = (entry.attempts ?? 0) + 1;
    const updated = {
      ...entry,
      attempts: updatedAttempts,
      lastFailedAt: new Date().toISOString(),
    };
    if (updatedAttempts >= MAX_SWEEP_ATTEMPTS) {
      logger.error(
        `OPERATOR ACTION REQUIRED: persistent-lock on worktree path=${entry.path} ` +
          `branch=${entry.branch} storyId=${entry.storyId} — manual cleanup required ` +
          `(attempts=${updatedAttempts}, firstFailedAt=${entry.firstFailedAt}).`,
      );
      persistent.push(entry.storyId);
      persistentDetails.push(updated);
    } else {
      stillPending.push(entry.storyId);
      stillPendingDetails.push(updated);
    }
    next.push(updated);
  }

  commitDrainedManifest(worktreeRoot, next, new Set(drained));
  return {
    drained,
    drainedDetails,
    persistent,
    persistentDetails,
    stillPending,
    stillPendingDetails,
  };
}
