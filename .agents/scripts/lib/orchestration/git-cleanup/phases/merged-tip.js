/**
 * merged-tip.js — resolve a MERGED PR's head against the branch tip
 * (Story #5086).
 *
 * Owns the ancestry probe and the taxonomy the branches-phase classifier
 * applies when a merged PR's `headRefOid` and the branch tip disagree.
 * Split out of `git-probes.js` so the classifier reads as one call and
 * the taxonomy's own documentation sits next to the code it governs.
 *
 * @module lib/orchestration/git-cleanup/phases/merged-tip
 */

import { gitSpawn } from '../../../git-utils.js';

/**
 * Tri-state ancestry probe: is `ancestorSha` reachable from
 * `descendantSha`?
 *
 * Mirrors the contract `checkHeadAncestor` in
 * `lib/worktree/lifecycle/merge-reachability.js` proved out for the
 * worktree-reap gate — the two cannot share an implementation because
 * that one takes a `ctx.git.gitSpawn` / `ctx.repoRoot` bag while
 * git-cleanup's probes take a bare `cwd`.
 *
 * `git merge-base --is-ancestor` exits **0** (ancestor), **1** (not an
 * ancestor) or **128** (a rev it cannot resolve). Folding 128 into
 * "not an ancestor" is the bug this probe exists to prevent: a merged
 * head absent from the local object DB would silently read as a
 * divergence and re-emit the wrong post-merge-force-push diagnosis. Both
 * revs are therefore resolved with `git rev-parse -q --verify` first, and
 * any failure fails closed to the `error` arm — so `merge-base` never
 * runs against a rev git cannot resolve.
 *
 * @param {{ cwd: string, ancestorSha: string, descendantSha: string, spawn?: typeof gitSpawn }} args
 * @returns {{ outcome: 'ancestor' } | { outcome: 'not-ancestor' } | { outcome: 'error', reason: string }}
 */
export function probeAncestry({
  cwd,
  ancestorSha,
  descendantSha,
  spawn = gitSpawn,
}) {
  for (const rev of [ancestorSha, descendantSha]) {
    const res = spawn(
      cwd,
      'rev-parse',
      '--quiet',
      '--verify',
      `${rev}^{commit}`,
    );
    if (res.status !== 0) {
      return { outcome: 'error', reason: `unresolvable rev ${rev}` };
    }
  }
  const res = spawn(
    cwd,
    'merge-base',
    '--is-ancestor',
    ancestorSha,
    descendantSha,
  );
  if (res.status === 0) return { outcome: 'ancestor' };
  if (res.status === 1) return { outcome: 'not-ancestor' };
  return {
    outcome: 'error',
    reason: (res.stderr || res.stdout || 'unknown').trim(),
  };
}

/**
 * Resolve a MERGED PR's `headRefOid` against the branch's current tip.
 *
 * Returns `null` when there is nothing to resolve — the PR row carries no
 * `headRefOid`, the tip cannot be read, or the tip already matches the
 * merged head — leaving the caller's plain-candidate path untouched.
 *
 * Otherwise the tip is classified by **ancestry**, never by the bare SHA
 * inequality this replaced. That inequality could not tell a branch that
 * is *behind* the merged head from one force-pushed *past* it, and
 * reported both as the latter — advising the operator to push a follow-up
 * commit that, for a stale pre-merge snapshot, does not exist. The three
 * arms:
 *
 *   - **ancestor** — 0 commits ahead, every commit landed with the PR:
 *     a reap candidate tagged `reason: 'tip-behind-merge'`.
 *   - **not-ancestor** — equivalently "≥1 commit ahead", which is why one
 *     probe settles the whole taxonomy and no `rev-list` count is needed:
 *     the unchanged `tip-diverged-from-merge` force-push skip.
 *   - **error** — a rev the local object DB cannot resolve:
 *     `reason: 'unverifiable'` carrying the probe's `detail`. Never a
 *     silent pass, and never a force-push label.
 *
 * @param {object} args
 * @returns {{ kind: 'candidate', prInfo: object, reason: string, tipSha: string, mergedSha: string } | { kind: 'skip', reason: string, prNumber: number|null, tipSha: string, mergedSha: string, detail?: string } | null}
 */
export function resolveMergedTip({
  prInfo,
  branch,
  cwd,
  remoteName,
  localExists,
  branchTipShaFn,
  ancestryFn = probeAncestry,
}) {
  const mergedSha = prInfo.headRefOid;
  if (!mergedSha) return null;
  const tipSha = branchTipShaFn({ cwd, branch, remoteName, localExists });
  if (!tipSha || tipSha === mergedSha) return null;
  const ancestry = ancestryFn({
    cwd,
    ancestorSha: tipSha,
    descendantSha: mergedSha,
  });
  if (ancestry.outcome === 'ancestor') {
    return {
      kind: 'candidate',
      prInfo,
      reason: 'tip-behind-merge',
      tipSha,
      mergedSha,
    };
  }
  const errored = ancestry.outcome === 'error';
  return {
    kind: 'skip',
    reason: errored ? 'unverifiable' : 'tip-diverged-from-merge',
    prNumber: prInfo.number ?? null,
    tipSha,
    mergedSha,
    ...(errored ? { detail: ancestry.reason } : {}),
  };
}
