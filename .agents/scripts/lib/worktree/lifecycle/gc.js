/**
 * worktree/lifecycle/gc.js
 *
 * Sweep abandoned worktrees: enumerate every story-<id> worktree git knows
 * about, drop the ones not in `openStoryIds`, and forward each candidate to
 * `reap`. Reuses pure helpers from sibling submodules; never touches state
 * outside `ctx`.
 */

import { storyIdFromPath } from '../inspector.js';
import { reap } from './reap.js';
import { list } from './registry-sync.js';
import { validateStoryId } from './shared.js';

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
      discardAfterMerge: opts.discardAfterMerge,
    });
    if (result.removed) {
      reaped.push({
        storyId: id,
        path: wt.path,
        ...(result.discardedPaths
          ? { discardedPaths: result.discardedPaths }
          : {}),
      });
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
