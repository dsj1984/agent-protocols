/**
 * worktree/lifecycle-manager.js
 *
 * Core git-worktree lifecycle operations: `ensure`, `reap`, `isSafeToRemove`,
 * `list`, `gc`, `prune`, `sweepStaleLocks`, and the Windows-lock-aware remove
 * helper `removeWorktreeWithRecovery`.
 *
 * All helpers accept an explicit `ctx` bag holding `repoRoot`, `config`,
 * `logger`, `git`, `platform`, a mutable `worktreeRoot` path, and a mutable
 * `listCache` slot. The facade `WorktreeManager` class owns the bag and
 * delegates method bodies here.
 */

import fs from 'node:fs';
import { rm as fsPromisesRm } from 'node:fs/promises';
import path from 'node:path';
import {
  dropAllSubmoduleGitlinksFromIndex,
  purgePerWorktreeSubmoduleDir,
  removeCopiedAgents,
} from './bootstrapper.js';
import {
  isInsideWorktree,
  parseWorktreePorcelain,
  samePath,
  storyIdFromPath,
} from './inspector.js';
import {
  applyNodeModulesStrategy,
  installDependencies,
  sleepSync,
} from './node-modules-strategy.js';
import { recordPendingCleanup } from './pending-cleanup.js';

const STORY_BRANCH_RE = /^story-\d+$/;

function validateStoryId(storyId) {
  const n =
    typeof storyId === 'number' ? storyId : Number.parseInt(storyId, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`WorktreeManager: invalid storyId: ${storyId}`);
  }
  return n;
}

function validateBranch(branch) {
  if (typeof branch !== 'string' || !STORY_BRANCH_RE.test(branch)) {
    throw new Error(
      `WorktreeManager: branch must match ${STORY_BRANCH_RE}, got: ${branch}`,
    );
  }
  return branch;
}

function getWorktreeList(ctx) {
  const now = Date.now();
  if (ctx.listCache.list && now - ctx.listCache.ts < 5_000) {
    return ctx.listCache.list;
  }
  const res = ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  if (res.status !== 0) return [];
  const parsed = parseWorktreePorcelain(res.stdout);
  ctx.listCache.list = parsed;
  ctx.listCache.ts = now;
  return parsed;
}

function invalidateWorktreeCache(ctx) {
  ctx.listCache.list = null;
  ctx.listCache.ts = 0;
}

function findByPath(ctx, absPath) {
  return (
    getWorktreeList(ctx).find((r) => samePath(r.path, absPath, ctx.platform)) ??
    null
  );
}

export function pathFor(ctx, storyId) {
  const n = validateStoryId(storyId);
  return path.join(ctx.worktreeRoot, `story-${n}`);
}

export async function ensure(ctx, storyId, branch) {
  const id = validateStoryId(storyId);
  const br = validateBranch(branch);
  if (br !== `story-${id}`) {
    throw new Error(
      `WorktreeManager: branch ${br} does not match storyId ${id}`,
    );
  }

  const wtPath = pathFor(ctx, id);
  const existing = findByPath(ctx, wtPath);

  if (existing) {
    if (existing.branch && existing.branch !== br) {
      throw new Error(
        `WorktreeManager: worktree at ${wtPath} is on branch ${existing.branch}, expected ${br}`,
      );
    }
    return { path: wtPath, created: false };
  }

  fs.mkdirSync(ctx.worktreeRoot, { recursive: true });

  const windowsPathWarning = ctx.maybeWarnWindowsPath(wtPath);

  const branchExists =
    ctx.git.gitSpawn(
      ctx.repoRoot,
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${br}`,
    ).status === 0;

  const addArgs = branchExists
    ? ['worktree', 'add', wtPath, br]
    : ['worktree', 'add', '-b', br, wtPath];

  const res = ctx.git.gitSpawn(ctx.repoRoot, ...addArgs);
  if (res.status !== 0) {
    const stderr = res.stderr || res.stdout || '';
    if (/already (exists|checked out)/.test(stderr)) {
      const raceExisting = findByPath(ctx, wtPath);
      if (raceExisting) {
        ctx.logger.info(
          `worktree.ensure race: worktree appeared concurrently for story-${id}, reusing`,
        );
        return { path: wtPath, created: false };
      }
    }
    throw new Error(
      `WorktreeManager: git worktree add failed for story-${id}: ${stderr}`,
    );
  }

  invalidateWorktreeCache(ctx);

  if (ctx.platform === 'win32') {
    ctx.git.gitSpawn(wtPath, 'config', '--local', 'core.longpaths', 'true');
  }

  applyNodeModulesStrategy(ctx, wtPath);
  ctx.copyBootstrapFiles(wtPath);
  const installOk = installDependencies(ctx, wtPath);
  ctx.copyAgentsFromRoot(wtPath);

  ctx.logger.info(`worktree.created storyId=${id} path=${wtPath}`);
  return {
    path: wtPath,
    created: true,
    installFailed: !installOk,
    ...(windowsPathWarning ? { windowsPathWarning } : {}),
  };
}

export async function list(ctx) {
  const res = ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  if (res.status !== 0) {
    throw new Error(`WorktreeManager: git worktree list failed: ${res.stderr}`);
  }
  return parseWorktreePorcelain(res.stdout);
}

export async function isSafeToRemove(ctx, wtPath, opts = {}) {
  if (!fs.existsSync(wtPath)) {
    return { safe: true, reason: 'path-missing' };
  }

  const status = ctx.git.gitSpawn(wtPath, 'status', '--porcelain');
  if (status.status !== 0) {
    return { safe: false, reason: `status-failed: ${status.stderr}` };
  }
  if (status.stdout.length > 0) {
    return { safe: false, reason: 'uncommitted-changes' };
  }

  const headRes = ctx.git.gitSpawn(wtPath, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (headRes.status !== 0) {
    return { safe: false, reason: `rev-parse-failed: ${headRes.stderr}` };
  }
  const branch = headRes.stdout;
  if (branch === 'HEAD') {
    return { safe: false, reason: 'detached-head' };
  }

  const epicBranch = opts.epicBranch ?? null;
  if (epicBranch) {
    const res = ctx.git.gitSpawn(
      ctx.repoRoot,
      'merge-base',
      '--is-ancestor',
      branch,
      epicBranch,
    );
    if (res.status === 1) {
      return { safe: false, reason: 'unmerged-commits' };
    }
    if (res.status !== 0) {
      return {
        safe: false,
        reason: `merge-check-failed: ${res.stderr || res.stdout || 'unknown'}`,
      };
    }
  }

  return { safe: true };
}

export function prune(ctx) {
  const res = ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'prune');
  if (res.status !== 0) {
    return {
      pruned: false,
      reason: res.stderr || res.stdout || 'worktree-prune-failed',
    };
  }
  invalidateWorktreeCache(ctx);
  return { pruned: true };
}

export async function reap(ctx, storyId, opts = {}) {
  if (opts.force) {
    throw new Error(
      'WorktreeManager.reap: --force is not permitted by the framework',
    );
  }
  const wtPath = pathFor(ctx, storyId);

  const known = opts.worktrees
    ? opts.worktrees.some((r) => samePath(r.path, wtPath, ctx.platform))
    : findByPath(ctx, wtPath) !== null;
  if (!known) {
    return { removed: false, reason: 'not-a-worktree', path: wtPath };
  }

  if (storyIdFromPath(wtPath, ctx.worktreeRoot) !== null && !opts.epicBranch) {
    return { removed: false, reason: 'epic-branch-required', path: wtPath };
  }

  const safety = await isSafeToRemove(ctx, wtPath, {
    epicBranch: opts.epicBranch ?? null,
  });
  if (!safety.safe) {
    if (ctx.config.warnOnUncommittedOnReap) {
      ctx.logger.warn(
        `reap-skipped storyId=${storyId} reason=${safety.reason} path=${wtPath}`,
      );
    }
    return { removed: false, reason: safety.reason, path: wtPath };
  }

  removeCopiedAgents(ctx, wtPath);
  dropAllSubmoduleGitlinksFromIndex(ctx, wtPath);

  if (isInsideWorktree(process.cwd(), wtPath, ctx.platform)) {
    try {
      process.chdir(ctx.repoRoot);
    } catch (err) {
      ctx.logger.warn(
        `worktree.reap chdir-to-root failed: ${err.message} (continuing)`,
      );
    }
  }

  const storyIdN = validateStoryId(storyId);
  const branch = `story-${storyIdN}`;
  const removeResult = await removeWorktreeWithRecovery(ctx, wtPath, {
    storyId: storyIdN,
    branch,
    push: opts.push === true,
  });
  if (!removeResult.removed) {
    return {
      removed: false,
      reason: `remove-failed: ${removeResult.reason}`,
      path: wtPath,
      method: removeResult.method,
      pendingCleanup: removeResult.pendingCleanup,
    };
  }
  invalidateWorktreeCache(ctx);

  if (fs.existsSync(wtPath)) {
    try {
      fs.rmSync(wtPath, { recursive: true, force: true });
    } catch (err) {
      ctx.logger.warn(
        `worktree.reap post-remove rmSync failed path=${wtPath}: ${err.message}`,
      );
    }
  }

  ctx.logger.info(`worktree.reaped storyId=${storyId} path=${wtPath}`);
  return {
    removed: true,
    path: wtPath,
    ...(removeResult.method ? { method: removeResult.method } : {}),
    ...(removeResult.branchDeleted !== undefined
      ? { branchDeleted: removeResult.branchDeleted }
      : {}),
  };
}

const WINDOWS_LOCK_RE =
  /(permission denied|access is denied|directory not empty|resource busy|device or resource busy|sharing violation|EACCES|EBUSY|ENOTEMPTY)/i;

/**
 * Stage 1 recovery after `git worktree remove` exhausts its retries with a
 * Windows-lock-class error: retry `fs.rm` up to `maxRetries` times, then
 * prune the registration, delete the local branch, and (if `push`) delete
 * the remote branch. Returns `{ success: true, attempts }` or
 * `{ success: false, attempts, error }` on final failure.
 */
async function fsRmWithRetry(
  fsRm,
  wtPath,
  { maxRetries = 5, retryDelay = 200 } = {},
) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fsRm(wtPath, { recursive: true, force: true });
      return { success: true, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }
  }
  return { success: false, attempts: maxRetries, error: lastErr };
}

export async function removeWorktreeWithRecovery(ctx, wtPath, opts = {}) {
  const { storyId = null, branch = null, push = false } = opts;
  const maxAttempts = ctx.platform === 'win32' ? 6 : 2;
  const retryDelaysMs = [0, 150, 350, 700, 1200, 2000];
  let lastReason = 'worktree-remove-failed';
  let lastWasLockLike = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'remove', wtPath);
    if (res.status === 0) return { removed: true };

    const stderr = (res.stderr || res.stdout || '').trim();
    lastReason = stderr || 'worktree-remove-failed';
    const isSubmoduleGuard =
      /working trees containing submodules cannot be moved or removed/i.test(
        stderr,
      );
    const isLockLike = WINDOWS_LOCK_RE.test(stderr);
    lastWasLockLike = isLockLike;

    if (isSubmoduleGuard && attempt < maxAttempts) {
      ctx.logger.warn(
        `worktree.reap remove blocked by submodule guard; retrying (${attempt}/${maxAttempts})`,
      );
      dropAllSubmoduleGitlinksFromIndex(ctx, wtPath);
      purgePerWorktreeSubmoduleDir(ctx, wtPath);
      continue;
    }
    if (isLockLike && attempt < maxAttempts) {
      const delay = retryDelaysMs[attempt] ?? 300;
      ctx.logger.warn(
        `worktree.reap remove hit lock-like error; retrying in ${delay}ms (${attempt}/${maxAttempts})`,
      );
      sleepSync(delay);
      continue;
    }
    break;
  }

  // Stage 1: Windows-lock-class fallback. After `git worktree remove` has
  // exhausted its retries on a lock-like stderr, try to clear the directory
  // with `fs.rm` (Node-native, built for transient Windows locks), prune the
  // registration, delete the local branch, and optionally delete the remote
  // branch. This is categorically different from a shell `rm -rf`: no
  // subprocess, no argv parsing, path is always an internally-constructed
  // `.worktrees/story-<id>` path.
  if (lastWasLockLike) {
    const fsRm = ctx.fsRm ?? fsPromisesRm;
    const rmResult = await fsRmWithRetry(fsRm, wtPath, {
      maxRetries: 5,
      retryDelay: 200,
    });

    if (!rmResult.success) {
      ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'prune');
      invalidateWorktreeCache(ctx);
      const errMsg =
        (rmResult.error && rmResult.error.message) ||
        String(rmResult.error) ||
        'fs-rm-failed';
      // Stage 2 hand-off: append the entry to `.worktrees/.pending-cleanup.json`
      // so the plan-time worktree-sweep can drain it on the next run.
      let manifestEntry = null;
      if (storyId != null && ctx.worktreeRoot) {
        try {
          manifestEntry = recordPendingCleanup(ctx.worktreeRoot, {
            storyId,
            branch,
            path: wtPath,
            push,
          });
        } catch (err) {
          ctx.logger.warn(
            `worktree.reap pending-cleanup manifest write failed: ${err.message}`,
          );
        }
      }
      ctx.logger.error(
        `OPERATOR ACTION REQUIRED: worktree reap exhausted Stage 1 (fs-rm-retry) after ${rmResult.attempts} ` +
          `attempts path=${wtPath} — deferred to plan-time worktree-sweep. Reason: ${errMsg}`,
      );
      return {
        removed: false,
        method: 'deferred-to-sweep',
        reason: errMsg,
        lockReason: lastReason,
        attempts: rmResult.attempts,
        pendingCleanup: manifestEntry ?? { storyId, branch, path: wtPath, push },
      };
    }

    ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'prune');
    invalidateWorktreeCache(ctx);

    let branchDeleted = false;
    let remoteBranchDeleted = false;
    if (branch) {
      const localDel = ctx.git.gitSpawn(
        ctx.repoRoot,
        'branch',
        '-D',
        branch,
      );
      if (localDel.status === 0) {
        branchDeleted = true;
      } else {
        const stderr = (localDel.stderr || localDel.stdout || '').trim();
        if (/not found|not match|no such/i.test(stderr)) {
          // Already gone — treat as deleted.
          branchDeleted = true;
        } else {
          ctx.logger.warn(
            `worktree.reap fs-rm-retry branch -D ${branch} failed: ${stderr || 'unknown'} (continuing)`,
          );
        }
      }
      if (push) {
        const remoteDel = ctx.git.gitSpawn(
          ctx.repoRoot,
          'push',
          '--no-verify',
          'origin',
          '--delete',
          branch,
        );
        if (remoteDel.status === 0) {
          remoteBranchDeleted = true;
        } else {
          const stderr = (remoteDel.stderr || remoteDel.stdout || '').trim();
          if (/remote ref does not exist|not found|unable to delete/i.test(stderr)) {
            remoteBranchDeleted = true;
          } else {
            ctx.logger.warn(
              `worktree.reap fs-rm-retry push --delete ${branch} failed: ${stderr || 'unknown'} (continuing)`,
            );
          }
        }
      }
    }

    ctx.logger.warn(
      `worktree.reap recovered via fs-rm-retry path=${wtPath} attempts=${rmResult.attempts} lockReason=${lastReason}`,
    );
    return {
      removed: true,
      success: true,
      method: 'fs-rm-retry',
      attempts: rmResult.attempts,
      branchDeleted,
      remoteBranchDeleted,
    };
  }

  // Non-lock failure: keep the prune-cleared-registration legacy recovery.
  ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'prune');
  invalidateWorktreeCache(ctx);
  const stillRegistered = findByPath(ctx, wtPath) !== null;
  if (!stillRegistered) {
    ctx.logger.warn(
      `worktree.reap registration cleared after remove failure: ${lastReason}`,
    );
    return { removed: true, registrationOnly: true, reason: lastReason };
  }

  return { removed: false, reason: lastReason };
}

export async function gc(ctx, openStoryIds, opts = {}) {
  const open = new Set((openStoryIds ?? []).map((x) => validateStoryId(x)));
  const worktrees = await list(ctx);
  const reaped = [];
  const skipped = [];

  for (const wt of worktrees) {
    const id = storyIdFromPath(wt.path, ctx.worktreeRoot);
    if (id === null) continue;
    if (open.has(id)) continue;

    const result = await reap(ctx, id, {
      epicBranch: opts.epicBranch ?? null,
      worktrees,
    });
    if (result.removed) {
      reaped.push({ storyId: id, path: wt.path });
    } else {
      skipped.push({
        storyId: id,
        path: wt.path,
        reason: result.reason ?? 'unknown',
      });
    }
  }

  return { reaped, skipped };
}

export async function sweepStaleLocks(ctx, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? 300_000;
  const now = Date.now();
  const removed = [];
  const skipped = [];

  const gitDir = path.join(ctx.repoRoot, '.git');
  const candidates = [
    path.join(gitDir, 'index.lock'),
    path.join(gitDir, 'HEAD.lock'),
    path.join(gitDir, 'packed-refs.lock'),
    path.join(gitDir, 'config.lock'),
    path.join(gitDir, 'shallow.lock'),
  ];

  const worktreesDir = path.join(gitDir, 'worktrees');
  if (fs.existsSync(worktreesDir)) {
    for (const name of fs.readdirSync(worktreesDir)) {
      candidates.push(path.join(worktreesDir, name, 'index.lock'));
      candidates.push(path.join(worktreesDir, name, 'HEAD.lock'));
    }
  }

  for (const lockPath of candidates) {
    let stat;
    try {
      stat = fs.statSync(lockPath);
    } catch {
      continue;
    }
    const ageMs = now - stat.mtimeMs;
    if (ageMs < maxAgeMs) {
      skipped.push({ path: lockPath, ageMs });
      continue;
    }
    try {
      fs.unlinkSync(lockPath);
      removed.push({ path: lockPath, ageMs });
      ctx.logger.warn(
        `stale-lock removed path=${lockPath} ageMs=${Math.round(ageMs)}`,
      );
    } catch (err) {
      ctx.logger.warn(
        `stale-lock unlink failed path=${lockPath}: ${err.message}`,
      );
    }
  }

  return { removed, skipped };
}

export { getWorktreeList, invalidateWorktreeCache, findByPath };
