/**
 * worktree/lifecycle/registry-sync.js
 *
 * Worktree registry/cache helpers — lookup, list, prune, and the absolute-path
 * computation. Each helper accepts the shared lifecycle `ctx` bag holding
 * `repoRoot`, `git`, `platform`, `worktreeRoot`, and a mutable `listCache`
 * slot. Mutation is confined to `ctx.listCache`.
 */

import path from 'node:path';
import { parseWorktreePorcelain, samePath } from '../inspector.js';
import { validateStoryId } from './shared.js';

/**
 * Resolve the absolute worktree path for a given `storyId`. Accepts an
 * optional `{ git }` opts bag for API symmetry with `getWorktreeList`; the
 * path computation is pure and does not touch git, so the override is
 * accepted and ignored.
 *
 * @param {object} ctx
 * @param {number|string} storyId
 * @param {{ git?: object }} [_opts]
 */
export function pathFor(ctx, storyId, _opts = {}) {
  const n = validateStoryId(storyId);
  return path.join(ctx.worktreeRoot, `story-${n}`);
}

/**
 * Returns the cached worktree-list, re-running `git worktree list --porcelain`
 * when the cache is cold or older than 5s.
 *
 * The optional `git` override lets tests (or alternative runtime contexts)
 * inject a fake git interface without having to build the whole `ctx` bag.
 * When omitted, falls back to `ctx.git`, preserving the existing default.
 *
 * @param {object} ctx
 * @param {{ git?: { gitSpawn: Function } }} [opts]
 */
export function getWorktreeList(ctx, { git } = {}) {
  const now = Date.now();
  if (ctx.listCache.list && now - ctx.listCache.ts < 5_000) {
    return ctx.listCache.list;
  }
  const gitImpl = git ?? ctx.git;
  const res = gitImpl.gitSpawn(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  if (res.status !== 0) return [];
  const parsed = parseWorktreePorcelain(res.stdout);
  ctx.listCache.list = parsed;
  ctx.listCache.ts = now;
  return parsed;
}

/**
 * Drop the cached worktree list. Accepts an optional `{ git }` opts bag for
 * API symmetry with `getWorktreeList`; the cache-invalidation itself does
 * not touch git, so the override is accepted and ignored.
 *
 * @param {object} ctx
 * @param {{ git?: object }} [_opts]
 */
export function invalidateWorktreeCache(ctx, _opts = {}) {
  ctx.listCache.list = null;
  ctx.listCache.ts = 0;
}

export function findByPath(ctx, absPath) {
  return (
    getWorktreeList(ctx).find((r) => samePath(r.path, absPath, ctx.platform)) ??
    null
  );
}

export async function list(ctx) {
  const res = ctx.git.gitSpawn(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  if (res.status !== 0) {
    throw new Error(`WorktreeManager: git worktree list failed: ${res.stderr}`);
  }
  return parseWorktreePorcelain(res.stdout);
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
