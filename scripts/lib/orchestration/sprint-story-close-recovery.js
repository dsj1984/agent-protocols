/**
 * sprint-story-close-recovery.js — prior-state detection for sprint-story-close.
 *
 * Reconstructs close-recovery state from git + filesystem signals at invocation
 * time. No on-disk schema — every signal is observable in the checkout.
 *
 * States (priority order, first match wins):
 *   - `partial-merge`        — a merge is in progress in the main checkout.
 *   - `uncommitted-worktree` — the story worktree exists with uncommitted work.
 *   - `pushed-unmerged`      — the story branch is on origin and not yet merged.
 *   - `fresh`                — no prior close activity detected.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gitSpawn } from '../git-utils.js';

export const RECOVERY_STATES = Object.freeze({
  FRESH: 'fresh',
  PARTIAL_MERGE: 'partial-merge',
  UNCOMMITTED_WORKTREE: 'uncommitted-worktree',
  PUSHED_UNMERGED: 'pushed-unmerged',
});

const DEFAULT_GIT_ADAPTER = {
  status(cwd) {
    return gitSpawn(cwd, 'status', '--porcelain=v1');
  },
  lsRemote(cwd, ref) {
    return gitSpawn(cwd, 'ls-remote', '--heads', 'origin', ref);
  },
  isAncestor(cwd, ancestor, descendant) {
    return gitSpawn(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
  },
};

const DEFAULT_FS_ADAPTER = {
  existsSync: fs.existsSync,
};

function storyWorktreePath(cwd, storyId, worktreeRoot) {
  return path.join(cwd, worktreeRoot ?? '.worktrees', `story-${storyId}`);
}

/**
 * Return true if `git status --porcelain=v1` output contains an unmerged
 * marker (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`). These are the entries
 * git emits while a merge is in progress with unresolved content.
 */
function hasUnmergedMarkers(porcelainOutput) {
  if (!porcelainOutput) return false;
  return porcelainOutput
    .split('\n')
    .some((line) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(line));
}

/**
 * Return true if the porcelain output has any non-empty entries (i.e. the
 * working tree is not clean).
 */
function hasAnyUncommittedChanges(porcelainOutput) {
  if (!porcelainOutput) return false;
  return porcelainOutput.split('\n').some((line) => line.trim().length > 0);
}

/**
 * Detect the prior-close state for a Story.
 *
 * @param {object} opts
 * @param {string} opts.cwd             Main checkout root.
 * @param {number|string} opts.storyId
 * @param {number|string} [opts.epicId] Epic id, used to form `origin/epic/<id>`.
 * @param {string} [opts.worktreeRoot]  Worktree root relative to cwd. Default `.worktrees`.
 * @param {object} [opts.git]           Git adapter. Defaults to real git via gitSpawn.
 * @param {object} [opts.fs]            FS adapter with `existsSync`. Defaults to node:fs.
 * @returns {{ state: string, detail: object }}
 */
export function detectPriorState({
  cwd,
  storyId,
  epicId,
  worktreeRoot,
  git = DEFAULT_GIT_ADAPTER,
  fs: fsAdapter = DEFAULT_FS_ADAPTER,
} = {}) {
  if (!cwd) throw new Error('detectPriorState: cwd is required');
  if (!storyId) throw new Error('detectPriorState: storyId is required');

  const storyBranch = `story-${storyId}`;
  const detail = { storyId, storyBranch };

  // 1. partial-merge — UU markers in the main checkout.
  const mainStatus = git.status(cwd);
  const mainStatusOut = (mainStatus?.stdout ?? '').toString();
  if (hasUnmergedMarkers(mainStatusOut)) {
    return {
      state: RECOVERY_STATES.PARTIAL_MERGE,
      detail: { ...detail, checkout: cwd },
    };
  }

  // 2. uncommitted-worktree — worktree present + dirty.
  const wtPath = storyWorktreePath(cwd, storyId, worktreeRoot);
  if (fsAdapter.existsSync(wtPath)) {
    const wtStatus = git.status(wtPath);
    const wtStatusOut = (wtStatus?.stdout ?? '').toString();
    if (hasAnyUncommittedChanges(wtStatusOut)) {
      return {
        state: RECOVERY_STATES.UNCOMMITTED_WORKTREE,
        detail: { ...detail, worktreePath: wtPath },
      };
    }
  }

  // 3. pushed-unmerged — remote story branch exists and not yet merged.
  const lsr = git.lsRemote(cwd, storyBranch);
  const lsrOut = (lsr?.stdout ?? '').toString().trim();
  if (lsrOut.length > 0) {
    let alreadyMerged = false;
    if (epicId) {
      // `merge-base --is-ancestor A B` exits 0 iff A is reachable from B —
      // i.e. the story tip has already been merged into the epic.
      const ancestor = git.isAncestor(
        cwd,
        `origin/${storyBranch}`,
        `origin/epic/${epicId}`,
      );
      alreadyMerged = ancestor?.status === 0;
    }
    if (!alreadyMerged) {
      return {
        state: RECOVERY_STATES.PUSHED_UNMERGED,
        detail: { ...detail, remoteRef: lsrOut.split('\n')[0] },
      };
    }
  }

  return { state: RECOVERY_STATES.FRESH, detail };
}

export const RECOVERY_ACTIONS = Object.freeze({
  PROCEED: 'proceed',
  EXIT_PRIOR_STATE: 'exit-prior-state',
  RESUME_FROM_VALIDATE: 'resume-from-validate',
  RESUME_FROM_MERGE: 'resume-from-merge',
  RESUME_FROM_CONFLICT: 'resume-from-conflict',
  RESTART: 'restart',
});

/**
 * Decide how to dispatch given a detected prior state and CLI flags.
 *
 * Exactly one of `resume` / `restart` may be truthy. Passing both throws.
 *
 * @param {object} opts
 * @param {string} opts.state     One of RECOVERY_STATES.
 * @param {boolean} [opts.resume]
 * @param {boolean} [opts.restart]
 * @returns {{ action: string, exitCode?: number, reason?: string }}
 */
export function computeRecoveryMode({ state, resume, restart } = {}) {
  if (resume && restart) {
    throw new Error(
      'computeRecoveryMode: --resume and --restart are mutually exclusive',
    );
  }

  if (state === RECOVERY_STATES.FRESH) {
    // Flags are no-ops on fresh state — proceed normally.
    return { action: RECOVERY_ACTIONS.PROCEED };
  }

  if (restart) {
    return { action: RECOVERY_ACTIONS.RESTART };
  }

  if (resume) {
    switch (state) {
      case RECOVERY_STATES.PARTIAL_MERGE:
        return { action: RECOVERY_ACTIONS.RESUME_FROM_CONFLICT };
      case RECOVERY_STATES.UNCOMMITTED_WORKTREE:
        return { action: RECOVERY_ACTIONS.RESUME_FROM_VALIDATE };
      case RECOVERY_STATES.PUSHED_UNMERGED:
        return { action: RECOVERY_ACTIONS.RESUME_FROM_MERGE };
      default:
        throw new Error(`computeRecoveryMode: unknown state "${state}"`);
    }
  }

  // Prior state detected + no flag → refuse to silently proceed.
  return {
    action: RECOVERY_ACTIONS.EXIT_PRIOR_STATE,
    exitCode: 2,
    reason: state,
  };
}
