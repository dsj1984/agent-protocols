/**
 * worktree/lifecycle/drift-detection.js
 *
 * Sweep stale `*.lock` files left behind under `.git/` and per-worktree admin
 * directories after crashed git processes — a frequent residue from AV /
 * search-indexer scans on Windows that blocks subsequent git operations with
 * an `unable to lock` error.
 */

import fs from 'node:fs';
import path from 'node:path';

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
