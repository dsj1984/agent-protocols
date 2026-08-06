/**
 * worktree/lifecycle/merge-reachability.js
 *
 * The "is the worktree's work integrated upstream?" half of
 * `isSafeToRemove`. Runs the two-phase reachability gate the parent
 * documents: primary `merge-base --is-ancestor HEAD baseRef`, and a
 * `git cherry` patch-equivalence fallback when the ancestry check returns
 * "not an ancestor".
 *
 * The fallback exists because a post-merge rebase or force-push can drop
 * the local branch ref off the merged tip, so SHA reachability alone
 * under-reports integration.
 *
 * A third phase used to sit between the two: a `git log --merges
 * --grep=resolves #<storyId>` probe for the `(resolves #N)` token on the
 * Epic's `--no-ff` merge commit. Story #5006 removed it — v2 lands every
 * Story as a **squash** merge onto `main`, which never writes that token,
 * and the `--no-ff` emitter (`story-close/merge-runner.js`) went with the
 * Epic pipeline. The probe could only ever return `false`.
 *
 * Pure with respect to the supplied `ctx` bag; the only side effects are
 * the `gitSpawn` calls.
 */

/**
 * Resolve a worktree's `HEAD` to a full commit SHA via
 * `git rev-parse HEAD` (run inside the worktree). Returns
 * `{ ok: true, sha, short }` on success, or `{ ok: false, reason }` when
 * the spawn fails. The short form is sliced from the full SHA so callers
 * can build operator-facing reason strings without a second round-trip.
 *
 * @param {object} ctx
 * @param {string} wtPath
 * @returns {{ok: true, sha: string, short: string} | {ok: false, reason: string}}
 */
export function resolveHeadSha(ctx, wtPath) {
  const res = ctx.git.gitSpawn(wtPath, 'rev-parse', 'HEAD');
  if (res.status !== 0) {
    return { ok: false, reason: `rev-parse-failed: ${res.stderr || 'HEAD'}` };
  }
  const sha = res.stdout.trim();
  return { ok: true, sha, short: sha.slice(0, 7) || 'HEAD' };
}

/**
 * Run `git merge-base --is-ancestor headSha epicRef` from the main
 * checkout. Returns one of:
 *
 *   - `{ outcome: 'ancestor' }` — exit 0, head is reachable.
 *   - `{ outcome: 'not-ancestor' }` — exit 1, head is not reachable; the
 *     caller should fall back to the merge-commit-grep path.
 *   - `{ outcome: 'error', reason }` — any other exit; treat as unsafe.
 *
 * @param {object} ctx
 * @param {string} headSha
 * @param {string} epicRef
 * @returns {{outcome: 'ancestor'} | {outcome: 'not-ancestor'} | {outcome: 'error', reason: string}}
 */
export function checkHeadAncestor(ctx, headSha, epicRef) {
  const res = ctx.git.gitSpawn(
    ctx.repoRoot,
    'merge-base',
    '--is-ancestor',
    headSha,
    epicRef,
  );
  if (res.status === 0) return { outcome: 'ancestor' };
  if (res.status === 1) return { outcome: 'not-ancestor' };
  return {
    outcome: 'error',
    reason: res.stderr || res.stdout || 'unknown',
  };
}

/**
 * Predicate: are every commit on `branch` patch-equivalent to a commit
 * already on `epicRef`? Runs `git cherry <epicRef> <branch>` and returns
 * `true` when every output line starts with `- ` (already upstream by
 * patch-id). Returns `false` when:
 *
 *   - `git cherry` exits non-zero,
 *   - the output is empty (no commits to compare — the trivial-ancestor
 *     case is already covered by `checkHeadAncestor`), or
 *   - any output line starts with `+ ` (a commit on `branch` whose
 *     patch-id is not present upstream).
 *
 * Surfaces the "Story diff already integrated as rebased equivalents"
 * recovery case: operator manually rebased the Story's content onto
 * `epic/<id>` during recovery, so the diff is on the Epic branch as
 * commits with **different SHAs** but the same patch-ids. The ancestor
 * check returns `false` (Story tip's own commits are not ancestors), and
 * no `(resolves #<id>)` merge commit exists — but the work is
 * functionally integrated.
 *
 * Story #3161 — surfaced during Epic #3078 delivery on Story #3122.
 *
 * @param {object} ctx
 * @param {string} branch Branch with commits to test (e.g. `story-3122`).
 * @param {string} epicRef Epic ref to test against (e.g. `origin/epic/3078`).
 * @returns {boolean}
 */
export function hasRebasedEquivalents(ctx, branch, epicRef) {
  const res = ctx.git.gitSpawn(ctx.repoRoot, 'cherry', epicRef, branch);
  if (res.status !== 0) return false;
  const lines = (res.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.every((line) => line.startsWith('- '));
}

/**
 * Run the full two-phase merge-reachability gate. Returns the same
 * `{ safe, reason }` envelope `isSafeToRemove` does, so callers can chain
 * the verdict directly into the parent return value.
 *
 * @param {object} ctx
 * @param {string} wtPath
 * @param {string} branch Working branch name from the precheck.
 * @param {string} epicRef Epic ref (e.g. `epic/1831`).
 * @returns {Promise<{safe: boolean, reason: string}>}
 */
export async function checkMergeReachability(ctx, wtPath, branch, epicRef) {
  const head = resolveHeadSha(ctx, wtPath);
  if (!head.ok) return { safe: false, reason: head.reason };

  const ancestor = checkHeadAncestor(ctx, head.sha, epicRef);
  if (ancestor.outcome === 'ancestor') {
    return { safe: true, reason: 'head-reachable-from-epic' };
  }
  if (ancestor.outcome === 'error') {
    return {
      safe: false,
      reason: `merge-check-failed: head=${head.short} epic=${epicRef}: ${ancestor.reason}`,
    };
  }

  if (hasRebasedEquivalents(ctx, branch, epicRef)) {
    return { safe: true, reason: 'rebased-equivalents' };
  }
  return {
    safe: false,
    reason: `unmerged-commits: head=${head.short} epic=${epicRef}`,
  };
}
