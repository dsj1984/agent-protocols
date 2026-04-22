#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-story-close.js — Story Execution Closure
 *
 * Deterministic script that replaces Steps 5, 5b, and 6 of the sprint-execute
 * Mode B workflow. Performs all post-implementation orchestration:
 *
 *   1. Validates the Story branch exists and is currently checked out.
 *   2. Merges the Story branch into epic/<epicId> with --no-ff.
 *   3. Pushes the Epic branch.
 *   4. Deletes the Story branch (local + remote).
 *   5. Batch transitions all child Tasks → agent::done (with cascade).
 *   6. Transitions the Story → agent::done (with cascade).
 *   7. Runs health-monitor.js.
 *
 * Usage:
 *   node sprint-story-close.js --story <STORY_ID> [--epic <EPIC_ID>]
 *
 * If --epic is omitted, the script resolves it from the Story ticket body.
 *
 * Exit codes:
 *   0 — Story closed and merged successfully.
 *   1 — Error.
 *
 * @see .agents/workflows/sprint-execute.md Mode B
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { runCloseValidation } from './lib/close-validation.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import {
  acquireEpicMergeLock,
  releaseEpicMergeLock,
} from './lib/epic-merge-lock.js';
import { mergeFeatureBranch } from './lib/git-merge-orchestrator.js';
import {
  getEpicBranch,
  getStoryBranch,
  gitSpawn,
  gitSync,
} from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import { createNotifier } from './lib/notifications/notifier.js';
import { createFrictionEmitter } from './lib/orchestration/friction-emitter.js';
import { runPostMergePipeline } from './lib/orchestration/post-merge-pipeline.js';
import {
  computeRecoveryMode,
  detectPriorPhase,
  RECOVERY_ACTIONS,
} from './lib/orchestration/sprint-story-close-recovery.js';
import { createProvider } from './lib/provider-factory.js';
import {
  fetchChildTasks,
  resolveStoryHierarchy,
} from './lib/story-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const progress = Logger.createProgress('sprint-story-close', { stderr: true });

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Pre-merge rebase of the Story branch onto `origin/<epicBranch>`.
 *
 * Parallel wave execution lets two Stories land on the Epic between the time
 * a later Story branched off and the time it closes. Rebasing the Story on
 * the latest Epic before the close-merge shrinks the conflict surface to the
 * Story's real delta and lets `mergeFeatureBranch`'s minor-conflict auto-
 * resolve apply surgically instead of against stale base content.
 *
 * Runs inside the per-story worktree so it does not disturb the main
 * checkout. On any failure (fetch error, rebase conflict) the rebase is
 * aborted and the caller falls through to the plain merge path, which will
 * surface the same conflict via triage.
 *
 * @returns {{ rebased: boolean, reason?: string }}
 */
function rebaseStoryOnEpic({
  orchestration,
  storyId,
  epicBranch,
  storyBranch,
  repoRoot,
}) {
  const wtConfig = orchestration?.worktreeIsolation;
  if (!wtConfig?.enabled) {
    return { rebased: false, reason: 'isolation-disabled' };
  }
  const wtRoot = wtConfig.root ?? '.worktrees';
  const wtPath = path.join(repoRoot, wtRoot, `story-${storyId}`);
  if (!fs.existsSync(wtPath)) {
    return { rebased: false, reason: 'worktree-missing' };
  }

  progress('GIT', `Rebasing ${storyBranch} onto origin/${epicBranch}...`);
  const fetch = gitSpawn(wtPath, 'fetch', 'origin', epicBranch);
  if (fetch.status !== 0) {
    progress(
      'GIT',
      `⚠️ fetch origin ${epicBranch} failed; skipping pre-merge rebase`,
    );
    return { rebased: false, reason: 'fetch-failed' };
  }
  const rebase = gitSpawn(wtPath, 'rebase', `origin/${epicBranch}`);
  if (rebase.status !== 0) {
    gitSpawn(wtPath, 'rebase', '--abort');
    progress(
      'GIT',
      '⚠️ rebase conflicted; aborted — merge triage will handle overlap',
    );
    return { rebased: false, reason: 'rebase-conflict' };
  }
  progress('GIT', `✅ Rebased ${storyBranch} onto origin/${epicBranch}`);
  return { rebased: true };
}

async function finalizeMerge(
  epicBranch,
  storyBranch,
  storyTitle,
  storyId,
  cwd,
  orchestration,
  epicId,
) {
  // Acquire the per-Epic filesystem merge lock before any rebase/merge/push
  // activity so two concurrent story closures cannot race on the Epic
  // branch. Lock is always released in the `finally` block.
  let lockHandle;
  try {
    progress('LOCK', `Acquiring epic-merge lock for epic #${epicId}...`);
    lockHandle = await acquireEpicMergeLock(epicId, {
      repoRoot: cwd,
      timeoutMs: 60_000,
    });
    progress('LOCK', `🔒 Acquired ${path.basename(lockHandle.filePath)}`);
  } catch (err) {
    Logger.fatal(
      `Could not acquire epic-merge lock for epic #${epicId}: ${err.message}. ` +
        `Another story closure may be in progress, or a stale lock is present at ` +
        `${lockPathDisplay(cwd, epicId)} — inspect and remove it manually if no ` +
        `other process is running.`,
    );
  }

  try {
    rebaseStoryOnEpic({
      orchestration,
      storyId,
      epicBranch,
      storyBranch,
      repoRoot: cwd,
    });

    progress('GIT', `Checking out ${epicBranch}...`);
    gitSync(cwd, 'checkout', epicBranch);
    gitSpawn(cwd, 'pull', '--rebase', 'origin', epicBranch);

    progress('GIT', `Merging ${storyBranch} into ${epicBranch} (--no-ff)...`);
    const mergeMsg = `feat: ${storyTitle.charAt(0).toLowerCase() + storyTitle.slice(1)} (resolves #${storyId})`;
    const vlog = (_level, _ctx, msg, meta) => {
      const tail = meta ? ` ${JSON.stringify(meta)}` : '';
      Logger.error(`[merge] ${msg}${tail}`);
    };
    const result = mergeFeatureBranch(cwd, storyBranch, vlog, {
      message: mergeMsg,
    });

    if (!result.merged && result.major) {
      Logger.fatal(
        `Major merge conflict on story close: ` +
          `${result.conflicts.files} file(s), ${result.conflicts.lines} marker(s). ` +
          `Conflicting files: ${result.conflicts.fileList.join(', ')}. ` +
          `Merge has been aborted. Resolve manually on ${epicBranch}, then ` +
          `re-run this script.`,
      );
    }
    if (result.autoResolved) {
      progress(
        'GIT',
        `✅ Merge completed with auto-resolved minor conflicts ` +
          `(${result.conflicts.files} file(s) resolved to theirs)`,
      );
      for (const f of result.autoResolvedFiles ?? []) {
        progress(
          'GIT',
          `  ↳ auto-resolved ${f.file} (${f.discardedLines} base line(s) discarded; trailer in merge commit)`,
        );
      }
    } else {
      progress('GIT', '✅ Merge successful');
    }

    progress('GIT', `Pushing ${epicBranch}...`);
    const pushResult = gitSpawn(
      cwd,
      'push',
      '--no-verify',
      'origin',
      epicBranch,
    );
    if (pushResult.status !== 0) {
      Logger.fatal(`Push failed: ${pushResult.stderr}`);
    }

    // Branch cleanup is deferred to after worktree reap: git refuses to
    // delete a branch that's still "checked out" by a worktree, and the
    // per-story worktree still has storyBranch checked out at this point.
    // See runStoryClose for the ordering.
  } finally {
    releaseEpicMergeLock(lockHandle);
    progress('LOCK', '🔓 Released epic-merge lock');
  }
}

function lockPathDisplay(cwd, epicId) {
  return path.join(cwd, '.git', `epic-${epicId}.merge.lock`);
}

/**
 * Complete an in-progress merge whose conflicts have been resolved by the
 * operator, then push. Used by the `--resume` path when prior state is
 * `partial-merge`.
 */
async function completeInProgressMerge({
  cwd,
  epicBranch,
  storyBranch,
  storyTitle,
  storyId,
  epicId,
}) {
  let lockHandle;
  try {
    progress('LOCK', `Acquiring epic-merge lock for epic #${epicId}...`);
    lockHandle = await acquireEpicMergeLock(epicId, {
      repoRoot: cwd,
      timeoutMs: 60_000,
    });
    progress('LOCK', `🔒 Acquired ${path.basename(lockHandle.filePath)}`);

    const mergeHeadPath = path.join(cwd, '.git', 'MERGE_HEAD');
    if (fs.existsSync(mergeHeadPath)) {
      progress('GIT', 'Finalizing in-progress merge (git commit --no-verify)');
      const mergeMsg = `feat: ${storyTitle.charAt(0).toLowerCase() + storyTitle.slice(1)} (resolves #${storyId})`;
      const commit = gitSpawn(cwd, 'commit', '--no-verify', '-m', mergeMsg);
      if (commit.status !== 0) {
        Logger.fatal(
          `Failed to finalize merge commit: ${commit.stderr || commit.stdout || 'unknown'}. ` +
            `Check that all conflicts are resolved and staged on ${epicBranch}.`,
        );
      }
      progress('GIT', `✅ Merge of ${storyBranch} finalized on ${epicBranch}`);
    } else {
      progress(
        'GIT',
        '⚠️ No MERGE_HEAD found — merge already committed; proceeding to push',
      );
    }

    progress('GIT', `Pushing ${epicBranch}...`);
    const pushResult = gitSpawn(
      cwd,
      'push',
      '--no-verify',
      'origin',
      epicBranch,
    );
    if (pushResult.status !== 0) {
      Logger.fatal(`Push failed: ${pushResult.stderr}`);
    }
  } finally {
    if (lockHandle) {
      releaseEpicMergeLock(lockHandle);
      progress('LOCK', '🔓 Released epic-merge lock');
    }
  }
}

/**
 * Restart path: abort any in-progress merge, drop the worktree, delete the
 * story branch ref, and re-seed branch + worktree from the Epic branch. The
 * caller then falls through to the normal fresh-close flow.
 */
function restartStoryState({
  cwd,
  orchestration,
  storyId,
  epicBranch,
  storyBranch,
}) {
  progress('RESTART', `Resetting prior state for Story #${storyId}...`);

  // 1. Abort any in-progress merge in the main checkout (idempotent — exits
  //    non-zero if no merge is in progress, which we ignore).
  gitSpawn(cwd, 'merge', '--abort');

  // 2. Drop the worktree if isolation is enabled.
  const wtConfig = orchestration?.worktreeIsolation;
  if (wtConfig?.enabled) {
    const wtRoot = wtConfig.root ?? '.worktrees';
    const wtPath = path.join(cwd, wtRoot, `story-${storyId}`);
    if (fs.existsSync(wtPath)) {
      progress('RESTART', `Removing worktree ${wtPath}`);
      const remove = gitSpawn(cwd, 'worktree', 'remove', '--force', wtPath);
      if (remove.status !== 0) {
        Logger.error(
          `[sprint-story-close] Worktree remove failed: ${remove.stderr || 'unknown'}. ` +
            'Attempting prune to clean stale registration.',
        );
      }
      gitSpawn(cwd, 'worktree', 'prune');
    }
  }

  // 3. Delete the story branch ref (if it exists locally). Force-delete
  //    because the branch likely has unmerged commits relative to main.
  gitSpawn(cwd, 'branch', '-D', storyBranch);

  // 4. Recreate the story branch ref from the local Epic branch.
  const create = gitSpawn(cwd, 'branch', storyBranch, epicBranch);
  if (create.status !== 0) {
    Logger.fatal(
      `Failed to recreate ${storyBranch} from ${epicBranch}: ${create.stderr || 'unknown'}`,
    );
  }

  // 5. Recreate the worktree if isolation is enabled.
  if (wtConfig?.enabled) {
    const wtRoot = wtConfig.root ?? '.worktrees';
    const wtPath = path.join(cwd, wtRoot, `story-${storyId}`);
    const add = gitSpawn(cwd, 'worktree', 'add', wtPath, storyBranch);
    if (add.status !== 0) {
      Logger.fatal(
        `Failed to re-seed worktree at ${wtPath}: ${add.stderr || 'unknown'}`,
      );
    }
    progress('RESTART', `✅ Re-seeded worktree at ${wtPath}`);
  }
}

/**
 * Orchestrate the Story initialization.
 * Exported for testing.
 */
export async function runStoryClose({
  storyId: storyIdParam,
  epicId: epicIdParam,
  skipDashboard: skipDashboardParam,
  skipValidation: skipValidationParam,
  cwd: cwdParam,
  resume: resumeParam,
  restart: restartParam,
  injectedProvider,
} = {}) {
  const parsed =
    storyIdParam !== undefined
      ? {
          storyId: storyIdParam,
          epicId: epicIdParam,
          skipDashboard: !!skipDashboardParam,
          cwd: cwdParam ?? null,
          resume: !!resumeParam,
          restart: !!restartParam,
        }
      : parseSprintArgs();
  const {
    storyId,
    epicId: argEpicId,
    skipDashboard,
    resume: resumeFlag,
    restart: restartFlag,
  } = parsed;
  // Worktree-aware cwd resolution: explicit param > --cwd flag > env > PROJECT_ROOT.
  const cwd = path.resolve(cwdParam ?? parsed.cwd ?? PROJECT_ROOT);

  if (!storyId) {
    Logger.fatal(
      'Usage: node sprint-story-close.js --story <STORY_ID> [--epic <EPIC_ID>]',
    );
  }

  let epicId = argEpicId;

  const { orchestration } = resolveConfig({ cwd });
  const provider = injectedProvider || createProvider(orchestration);
  const notifier = createNotifier(orchestration, provider, { cwd });

  progress('INIT', `Closing Story #${storyId}...`);

  // -------------------------------------------------------------------------
  // Resolve Epic ID if not provided
  // -------------------------------------------------------------------------

  const story = await provider.getTicket(storyId);

  if (!epicId) {
    const resolved = resolveStoryHierarchy(story.body);
    if (!resolved.epicId) {
      Logger.fatal(
        `Story #${storyId} has no "Epic: #N" reference. Pass --epic <id> explicitly.`,
      );
    }
    epicId = resolved.epicId;
  }

  const epicBranch = getEpicBranch(epicId);
  const storyBranch = getStoryBranch(epicId, storyId);

  // -------------------------------------------------------------------------
  // Prior-state detection + --resume / --restart dispatch
  // -------------------------------------------------------------------------

  if (resumeFlag && restartFlag) {
    Logger.fatal('--resume and --restart are mutually exclusive');
  }

  const priorPhase = detectPriorPhase({ cwd, storyId, epicId });
  const mode = computeRecoveryMode({
    state: priorPhase.phase,
    resume: resumeFlag,
    restart: restartFlag,
  });

  if (mode.action === RECOVERY_ACTIONS.EXIT_PRIOR_STATE) {
    Logger.error(
      `[phase=prior-state]\nPrior close state detected: ${priorPhase.phase}\n` +
        `${JSON.stringify(priorPhase.detail, null, 2)}\n\n` +
        'Re-run with --resume to continue from the detected state, or ' +
        '--restart to abort prior state and re-init.',
    );
    // Signal exit-2 to the runAsCli wrapper.
    const err = new Error(`prior-state:${priorPhase.phase}`);
    err.exitCode = mode.exitCode ?? 2;
    throw err;
  }

  if (mode.action === RECOVERY_ACTIONS.RESTART) {
    progress(
      'RESTART',
      `--restart: aborting prior state (${priorPhase.phase}) and re-initializing`,
    );
    restartStoryState({
      cwd,
      orchestration,
      storyId,
      epicBranch,
      storyBranch,
    });
  }

  const resumeFromConflict =
    mode.action === RECOVERY_ACTIONS.RESUME_FROM_CONFLICT;
  const resumeFromMerge = mode.action === RECOVERY_ACTIONS.RESUME_FROM_MERGE;
  if (resumeFromConflict) {
    progress(
      'RESUME',
      `--resume: resuming from conflict resolution (phase=${priorPhase.phase})`,
    );
  } else if (resumeFromMerge) {
    progress(
      'RESUME',
      `--resume: resuming from merge (phase=${priorPhase.phase})`,
    );
  } else if (mode.action === RECOVERY_ACTIONS.RESUME_FROM_VALIDATE) {
    progress(
      'RESUME',
      `--resume: resuming from validate (phase=${priorPhase.phase})`,
    );
  }

  // -------------------------------------------------------------------------
  // Enumerate child Tasks
  // -------------------------------------------------------------------------

  const tasks = await fetchChildTasks(provider, storyId);

  // Prime the provider's per-instance ticket cache: cascadeCompletion and
  // transitionTicketState will re-read these same ids, so feeding the
  // already-hydrated list prevents redundant REST round-trips.
  if (typeof provider.primeTicketCache === 'function') {
    provider.primeTicketCache([story, ...tasks]);
  }

  progress('TASKS', `Found ${tasks.length} child Task(s)`);

  // -------------------------------------------------------------------------
  // Pre-merge validation — shift-left gates so formatting drift or
  // maintainability regressions surface in the worktree rather than on the
  // Epic branch at pre-push time.
  // -------------------------------------------------------------------------

  const skipValidation =
    !!skipValidationParam || resumeFromConflict || resumeFromMerge;
  if (!skipValidation) {
    progress(
      'VALIDATE',
      'Running pre-merge gates (lint, test, format, maintainability)...',
    );
    const validation = runCloseValidation({
      cwd,
      log: (m) => Logger.info(m),
    });
    if (!validation.ok) {
      const [{ gate, status }] = validation.failed;
      Logger.fatal(
        `Pre-merge validation failed at "${gate.name}" (exit ${status}).` +
          (gate.hint ? ` ${gate.hint}` : ''),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 5 — Merge
  // -------------------------------------------------------------------------

  if (resumeFromConflict) {
    await completeInProgressMerge({
      cwd,
      epicBranch,
      storyBranch,
      storyTitle: story.title,
      storyId,
      epicId,
    });
  } else {
    await finalizeMerge(
      epicBranch,
      storyBranch,
      story.title,
      storyId,
      cwd,
      orchestration,
      epicId,
    );
  }

  // Reap must precede branch cleanup: git refuses to delete a branch that
  // is still checked out by a live worktree. The pipeline runs the phases
  // in this order — see post-merge-pipeline.js.
  const frictionEmitter = createFrictionEmitter({
    provider,
    logger: { warn: (m) => Logger.warn?.(m), debug: () => {} },
  });
  const pipelineState = await runPostMergePipeline({
    orchestration,
    storyId,
    epicId,
    story,
    storyBranch,
    epicBranch,
    repoRoot: cwd,
    projectRoot: PROJECT_ROOT,
    provider,
    notifier,
    frictionEmitter,
    tasks,
    skipDashboard,
    progress,
    logger: Logger,
  });
  const branchCleanup = pipelineState.branchCleanup;
  const { closedTickets, cascadedTo, cascadeFailed } =
    pipelineState.ticketClosure;
  const healthUpdated = pipelineState.healthUpdated;
  const manifestUpdated = pipelineState.manifestUpdated;

  // -------------------------------------------------------------------------
  // Output — structured result
  // -------------------------------------------------------------------------

  const result = {
    storyId,
    epicId,
    action: 'merged',
    merged: true,
    branchDeleted: branchCleanup.localDeleted && branchCleanup.remoteDeleted,
    branchLocalDeleted: branchCleanup.localDeleted,
    branchRemoteDeleted: branchCleanup.remoteDeleted,
    ticketsClosed: closedTickets,
    cascadedTo: cascadedTo ?? [],
    cascadeFailed: cascadeFailed ?? [],
    healthUpdated,
    manifestUpdated,
  };

  console.log('\n--- STORY CLOSE RESULT ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('--- END RESULT ---\n');

  progress(
    'DONE',
    `✅ Story #${storyId} merged into ${epicBranch}. ` +
      `${closedTickets.length} ticket(s) closed.`,
  );

  return { success: true, result };
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

runAsCli(import.meta.url, runStoryClose, {
  source: 'sprint-story-close',
  onError: (err) => {
    // Prior-state detection throws with `exitCode: 2` to signal "operator
    // must choose --resume / --restart" — the body was already printed to
    // stderr, so skip the default stack trace and just propagate the code.
    if (err?.exitCode === 2) {
      process.exit(2);
    }
    Logger.error(
      `[phase=fatal] [sprint-story-close] ${err.stack || err.message}`,
    );
    process.exit(1);
  },
});
