/**
 * branches-detect.js — the branch-reap phase's detection signals beyond
 * the PR probe, and the whole remote-only walk (Stories #4395, #5188).
 *
 * Split out of `branches.js` for the same reason `branches-reap.js` was:
 * each phase file stays small enough to read in one pass. `branches.js`
 * keeps the two walks' orchestration (`planCleanup`) and the reap
 * (`executeCleanup`); this module owns what a branch with no reapable PR
 * verdict is measured against.
 *
 * @module lib/orchestration/git-cleanup/phases/branches-detect
 */

import { classifyLatestPr } from './git-probes.js';

/** Fields a planner verdict forwards onto its `skipped[]` entry. */
const SKIP_DETAIL_FIELDS = ['prNumber', 'tipSha', 'mergedSha', 'detail'];

export function skipEntryFromVerdict(branch, verdict) {
  const entry = { branch, reason: verdict.reason };
  for (const field of SKIP_DETAIL_FIELDS) {
    if (verdict[field] != null) entry[field] = verdict[field];
  }
  return entry;
}

/**
 * Story #4395 — the third detection signal, shared by the local and
 * remote-only walks (Story #5188). Reached only when the branch has no
 * reapable PR verdict and is not an ancestor of `<base>` (or
 * `origin/<base>`). Probes content-equivalence via `git merge-tree
 * --write-tree` and, when the probe is conclusive and the merge is a
 * no-op, classifies the branch as `content-merged` instead of falling
 * through to the `not-merged` skip.
 *
 * `rev` is the revision handed to git, `branch` the short name every
 * output reports. They differ on the remote-only path, where names are
 * enumerated with the `<remote>/` prefix stripped: handing `git
 * merge-tree` the bare short name resolves to no ref, so the probe would
 * report `{ supported: false }` for every candidate and degrade the whole
 * signal to silence. Defaulting `rev` to `branch` keeps the local walk
 * unchanged.
 */
export function evaluateContentEquivalence({
  branch,
  rev = branch,
  baseBranch,
  cwd,
  contentEquivalentFn,
  branchLastCommitFn,
  lastCommitOpts,
  skipExtra,
}) {
  const verdict = contentEquivalentFn({ cwd, base: baseBranch, branch: rev });
  if (verdict?.supported && verdict.equivalent) {
    return { detectedBy: 'content-merged' };
  }
  return {
    skip: {
      branch,
      reason: 'not-merged',
      lastCommitAt: branchLastCommitFn(cwd, branch, lastCommitOpts),
      ...skipExtra,
    },
  };
}

/**
 * Story #5188 — the remote-only walk's no-PR cascade, the mirror of the
 * local walk's: ancestry against the base first, then content-equivalence,
 * else a `not-merged` skip. Reaching this at all is the fix — the walk
 * used to return early on a `no-pr` verdict, recording the branch in
 * neither `candidates[]` nor `skipped[]`, so a provably-merged orphan ref
 * was absent from the rendered log and the `--json` envelope alike.
 *
 * `mergedRemote` is the `-r` ancestry set ({@link listRemoteMergedBranches}):
 * the local `git branch --merged` listing that feeds the local cascade
 * enumerates local heads only and can never contain a remote branch name.
 * Both signals read the local object database, so the sweep stays offline.
 *
 * A hit carries a `detectedBy` distinct from the PR-detected
 * `'remote-only'` — `'remote-git-merged'` for ancestry, and the existing
 * `'content-merged'` for the weaker content signal, so every consumer that
 * already treats that value as report-only keeps doing so here.
 */
function evaluateRemoteOnlyNoPr({
  branch,
  rev,
  baseBranch,
  cwd,
  mergedRemote,
  contentEquivalentFn,
  branchLastCommitFn,
  remoteName,
}) {
  if (mergedRemote.has(branch)) return { detectedBy: 'remote-git-merged' };
  return evaluateContentEquivalence({
    branch,
    rev,
    baseBranch,
    cwd,
    contentEquivalentFn,
    branchLastCommitFn,
    lastCommitOpts: { localExists: false, remoteName },
    skipExtra: { localExists: false },
  });
}

/**
 * Story #5188 — resolve one remote-only branch's PR verdict into either a
 * detection provenance or a skip. Split out of the walk so the loop reads
 * as enumerate → resolve → record and every arm of the cascade is visibly
 * total: each branch that passes the protected and filter checks leaves
 * this function as exactly one of `{ detectedBy, prInfo }` or `{ skip }`.
 */
function resolveRemoteOnlyBranch({ verdict, branch, rev, noPrArgs }) {
  if (verdict.kind === 'skip') {
    return { skip: skipEntryFromVerdict(branch, verdict) };
  }
  if (verdict.kind === 'candidate') {
    return { detectedBy: 'remote-only', prInfo: verdict.prInfo };
  }
  const out = evaluateRemoteOnlyNoPr({ ...noPrArgs, branch, rev });
  return out.skip ? out : { detectedBy: out.detectedBy, prInfo: null };
}

export function collectRemoteOnlyCandidates({
  remoteLister,
  remoteName,
  cwd,
  baseBranch,
  localSet,
  classify,
  filter,
  prProbe,
  branchTipShaFn,
  ancestryFn,
  mergedRemote,
  contentEquivalentFn,
  branchLastCommitFn,
  skipped,
}) {
  const noPrArgs = {
    baseBranch,
    cwd,
    mergedRemote,
    contentEquivalentFn,
    branchLastCommitFn,
    remoteName,
  };
  const out = [];
  for (const branch of remoteLister(cwd, remoteName)) {
    if (localSet.has(branch)) continue;
    if (classify(branch)) continue;
    if (!filter(branch)) continue;
    const verdict = classifyLatestPr({
      prInfo: prProbe(branch, cwd),
      branch,
      cwd,
      remoteName,
      localExists: false,
      branchTipShaFn,
      ancestryFn,
    });
    const resolved = resolveRemoteOnlyBranch({
      verdict,
      branch,
      rev: `${remoteName}/${branch}`,
      noPrArgs,
    });
    if (resolved.skip) {
      skipped.push(resolved.skip);
      continue;
    }
    out.push({
      branch,
      prNumber: resolved.prInfo?.number ?? null,
      mergedAt: resolved.prInfo?.mergedAt ?? null,
      hasWorktree: false,
      worktreePath: null,
      detectedBy: resolved.detectedBy,
      localExists: false,
      behindMerge: verdict.reason === 'tip-behind-merge',
    });
  }
  return out;
}
