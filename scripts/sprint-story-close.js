#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-story-close.js — Story Execution Closure
 *
 * Deterministic script that replaces Steps 5, 5b, and 6 of the sprint-execute
 * Mode B workflow. Performs all post-implementation orchestration:
 *
 *   1. Validates the Story branch exists and is currently checked out.
 *   2. Checks for risk::high label — prints an in-chat HITL pause prompt to
 *      stderr and exits non-zero (no PR, no push, no comment, no label
 *      mutation). The invoking agent relays the options to the operator in
 *      chat; the story branch is left untouched.
 *   3. Merges the Story branch into epic/<epicId> with --no-ff.
 *   4. Pushes the Epic branch.
 *   5. Deletes the Story branch (local + remote).
 *   6. Batch transitions all child Tasks → agent::done (with cascade).
 *   7. Transitions the Story → agent::done (with cascade).
 *   8. Runs health-monitor.js.
 *
 * Usage:
 *   node sprint-story-close.js --story <STORY_ID> [--epic <EPIC_ID>]
 *
 * If --epic is omitted, the script resolves it from the Story ticket body.
 *
 * Exit codes:
 *   0 — Story closed and merged successfully.
 *   1 — Error or risk::high gate (paused for operator decision).
 *
 * @see .agents/workflows/sprint-execute.md Mode B
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateAndSaveManifest } from './dispatcher.js';
import { updateHealthMetrics } from './health-monitor.js';
import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
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
import {
  cascadeCompletion,
  STATE_LABELS,
  transitionTicketState,
} from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';
import {
  batchTransitionTickets,
  fetchChildTasks,
  resolveStoryHierarchy,
} from './lib/story-lifecycle.js';
import { WorktreeManager } from './lib/worktree-manager.js';
import { notify } from './notify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const progress = Logger.createProgress('sprint-story-close', { stderr: true });

function cleanupBranches(storyBranch, cwd) {
  progress('CLEANUP', `Deleting story branch: ${storyBranch}`);

  let localDeleted = false;
  const softDelete = gitSpawn(cwd, 'branch', '-d', storyBranch);
  if (softDelete.status === 0) {
    localDeleted = true;
  } else {
    const forceDelete = gitSpawn(cwd, 'branch', '-D', storyBranch);
    if (forceDelete.status === 0) {
      localDeleted = true;
    } else {
      // Most common cause: the branch is still "checked out" by a lingering
      // worktree registration — git refuses to delete a checked-out branch.
      // Surface the failure instead of silently swallowing it so the caller
      // can report accurately and the operator can remediate.
      const stderr = (forceDelete.stderr || softDelete.stderr || '').trim();
      Logger.error(
        `  Local branch ${storyBranch} delete failed: ${stderr || 'unknown'}. ` +
          `Check for stale worktrees (git worktree list).`,
      );
    }
  }

  let remoteDeleted = false;
  const remoteDelete = gitSpawn(
    cwd,
    'push',
    '--no-verify',
    'origin',
    '--delete',
    storyBranch,
  );
  if (remoteDelete.status !== 0) {
    progress('CLEANUP', `Remote branch ${storyBranch} not found — skipped`);
  } else {
    remoteDeleted = true;
    progress('CLEANUP', `✅ Remote branch ${storyBranch} deleted`);
  }

  return { localDeleted, remoteDeleted };
}

async function ticketClosureCascade(provider, tasks, storyId) {
  progress(
    'TICKETS',
    `Transitioning ${tasks.length} Task(s) to agent::done...`,
  );
  const batch = await batchTransitionTickets(
    provider,
    tasks,
    STATE_LABELS.DONE,
    { progress },
  );
  const closedTickets = [...batch.transitioned, ...batch.skipped];

  progress('TICKETS', `Transitioning Story #${storyId} to agent::done...`);
  try {
    await transitionTicketState(provider, storyId, STATE_LABELS.DONE);
    closedTickets.push(storyId);
    progress('TICKETS', `  #${storyId} → agent::done ✅`);
  } catch (err) {
    console.error(`  Story #${storyId} → FAILED: ${err.message}`);
  }

  progress('TICKETS', 'Running cascade completion...');
  let cascadedTo = [];
  let cascadeFailed = [];
  try {
    const cascade = (await cascadeCompletion(provider, storyId)) ?? {
      cascadedTo: [],
      failed: [],
    };
    cascadedTo = cascade.cascadedTo ?? [];
    cascadeFailed = cascade.failed ?? [];
    if (cascadedTo.length > 0) {
      progress(
        'TICKETS',
        `  Cascaded to: ${cascadedTo.map((id) => `#${id}`).join(', ')}`,
      );
    }
    for (const { parentId, error } of cascadeFailed) {
      Logger.error(
        `  Cascade partial-failure on parent #${parentId}: ${error}`,
      );
    }
  } catch (err) {
    Logger.error(`  Cascade fully failed (non-fatal): ${err.message}`);
  }

  return { closedTickets, cascadedTo, cascadeFailed };
}

// ---------------------------------------------------------------------------
// Post-merge phase helpers
// ---------------------------------------------------------------------------
//
// Each helper covers one discrete phase of the close-out after the merge
// succeeds. They log via `progress` and use `Logger.error` for non-fatal
// failures so the orchestrator keeps going. See
// `.agents/README.md#error-handling-convention`.
// ---------------------------------------------------------------------------

async function reapStoryWorktree({
  orchestration,
  storyId,
  epicBranch,
  repoRoot,
}) {
  const wtConfig = orchestration?.worktreeIsolation;
  if (!wtConfig?.enabled || !(wtConfig.reapOnSuccess ?? true)) return;

  try {
    const wm = new WorktreeManager({
      // Must use the resolved runtime repo root (`--cwd` in worktree mode),
      // not module PROJECT_ROOT (which may point at a copied .agents tree).
      repoRoot,
      config: wtConfig,
    });
    const reapResult = await wm.reap(storyId, { epicBranch });
    if (reapResult.removed) {
      progress('WORKTREE', `🗑️  Reaped worktree: ${reapResult.path}`);
    } else if (reapResult.reason) {
      // Previously the `not-a-worktree` branch was silent, which hid a drive-
      // letter-case bug in `_findByPath` on Windows and let stale worktrees
      // accumulate across runs. Always surface a reap-skip with remediation.
      progress(
        'WORKTREE',
        `⚠️  Worktree not reaped (${reapResult.reason}): ${reapResult.path}`,
      );
    }

    // Defense in depth: regardless of what `reap()` reported, probe
    // `git worktree list --porcelain` directly. If the story worktree is
    // still registered after close, the branch delete that follows will
    // fail and the operator needs a loud, specific hint.
    const leftover = await wm.list();
    const stillRegistered = leftover.find((r) =>
      /[/\\]story-\d+$/.test(r.path)
        ? Number(r.path.match(/story-(\d+)$/)?.[1]) === Number(storyId)
        : false,
    );
    if (stillRegistered) {
      progress(
        'WORKTREE',
        `⚠️  Worktree still registered after reap: ${stillRegistered.path}. ` +
          'Run `git worktree remove <path> --force && git worktree prune` to clean up.',
      );
    }
  } catch (err) {
    Logger.error(
      `[sprint-story-close] Worktree reap failed (non-fatal): ${err.message}`,
    );
  }
}

async function notifyStoryComplete({
  epicId,
  storyId,
  story,
  epicBranch,
  closedTickets,
  orchestration,
}) {
  progress(
    'NOTIFY',
    `Sending story-complete notification for Story #${storyId}...`,
  );
  try {
    await notify(
      epicId,
      {
        type: 'notification',
        message: `✅ Story #${storyId} — *${story.title}* — has been completed and merged into \`${epicBranch}\`. ${closedTickets.length} ticket(s) closed.`,
        actionRequired: true,
      },
      { orchestration },
    );
    progress('NOTIFY', '✅ Notification sent');
  } catch (err) {
    Logger.error(
      `[sprint-story-close] Notification failed (non-fatal): ${err.message}`,
    );
  }
}

async function updateHealth(epicId) {
  progress('HEALTH', 'Updating sprint health metrics...');
  try {
    await updateHealthMetrics(epicId);
    progress('HEALTH', '✅ Health metrics updated');
    return true;
  } catch (err) {
    Logger.error(
      `[sprint-story-close] Health monitor failed (non-fatal): ${err.message}`,
    );
    return false;
  }
}

async function refreshDashboard({ epicId, provider, skipDashboard }) {
  if (skipDashboard) {
    progress(
      'DASHBOARD',
      '⏭️ Skipping dashboard refresh (--skip-dashboard flag set)',
    );
    return false;
  }
  progress('DASHBOARD', 'Regenerating dispatch manifest...');
  try {
    // Reuse our primed provider so dashboard regeneration does not re-fetch
    // tickets already in this process's memoization cache.
    await generateAndSaveManifest(epicId, true, null, { provider });
    progress('DASHBOARD', '✅ Dashboard manifest updated (temp/)');
    return true;
  } catch (err) {
    Logger.error(
      `[sprint-story-close] Dashboard refresh failed (non-fatal): ${err.message}`,
    );
    return false;
  }
}

async function cleanupTempFiles(storyId) {
  try {
    const { unlink } = await import('node:fs/promises');
    const manifestBase = path.join(
      PROJECT_ROOT,
      'temp',
      `story-manifest-${storyId}`,
    );
    for (const ext of ['.md', '.json']) {
      try {
        await unlink(`${manifestBase}${ext}`);
        progress('CLEANUP', `🗑️  Deleted temp/story-manifest-${storyId}${ext}`);
      } catch {
        // File may not exist — deletion is idempotent.
      }
    }
  } catch (err) {
    Logger.error(
      `[sprint-story-close] Story manifest cleanup failed (non-fatal): ${err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

async function handleHighRiskGate(
  _provider,
  storyBranch,
  storyId,
  _epicId,
  _cwd,
) {
  // Pure pause. No PR, no push, no ticket comment, no label change — the
  // invoking agent (running /sprint-execute) sees this stderr block and the
  // non-zero exit, stops the workflow, and relays the options to the human
  // in chat. The human replies in chat and the agent resumes accordingly.
  progress(
    'RISK',
    `⚠️ Story #${storyId} is risk::high — pausing the workflow for operator input.`,
  );
  Logger.error('');
  Logger.error(
    `[HITL GATE] Story #${storyId} (\`${storyBranch}\`) is labelled risk::high.`,
  );
  Logger.error('All child tasks are complete, but the story has NOT been');
  Logger.error('pushed, merged, or deleted. Ask the operator to choose:');
  Logger.error('');
  Logger.error(
    '  (1) Auto-merge — the AGENT removes the `risk::high` label via',
  );
  Logger.error(
    '      `update-ticket-state.js --ticket <id> --remove-label risk::high`',
  );
  Logger.error('      and re-runs sprint-story-close for this story.');
  Logger.error(
    '  (2) Merge manually — operator inspects the diff and merges by hand.',
  );
  Logger.error(
    '  (3) Reject / rework — leave the branch alone and open follow-up work.',
  );
  Logger.error('');
  Logger.error(
    'Reply in chat with `Proceed` or `Proceed Option 1/2/3`. The agent',
  );
  Logger.error('will remove the label automatically for Option 1.');
  Logger.error('');
  Logger.error(
    'To skip this gate globally, set `orchestration.hitl.riskHighApproval` to',
  );
  Logger.error('false in `.agentrc.json`.');
  Logger.error('');

  try {
    await notify(storyId, {
      type: 'action',
      message:
        `HITL gate: Story #${storyId} (\`${storyBranch}\`) is risk::high ` +
        'and awaiting operator decision (Proceed / Option 1 / Option 2 / ' +
        'Option 3). Story branch not merged.',
    });
  } catch (err) {
    Logger.warn(
      `[sprint-story-close] HITL webhook/mention failed (non-fatal): ${err.message}`,
    );
  }

  return {
    action: 'paused-for-approval',
    reason:
      'risk::high — operator must reply in chat with `Proceed` / ' +
      '`Proceed Option 1` (agent auto-removes the label and re-runs), ' +
      '`Proceed Option 2` (manual merge), or `Proceed Option 3` ' +
      '(reject/rework). No ticket mutations were made. Story branch ' +
      'left untouched.',
  };
}

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
 * Orchestrate the Story initialization.
 * Exported for testing.
 */
export async function runStoryClose({
  storyId: storyIdParam,
  epicId: epicIdParam,
  skipDashboard: skipDashboardParam,
  cwd: cwdParam,
  injectedProvider,
} = {}) {
  const parsed =
    storyIdParam !== undefined
      ? {
          storyId: storyIdParam,
          epicId: epicIdParam,
          skipDashboard: !!skipDashboardParam,
          cwd: cwdParam ?? null,
        }
      : parseSprintArgs();
  const { storyId, epicId: argEpicId, skipDashboard } = parsed;
  // Worktree-aware cwd resolution: explicit param > --cwd flag > env > PROJECT_ROOT.
  const cwd = path.resolve(cwdParam ?? parsed.cwd ?? PROJECT_ROOT);

  if (!storyId) {
    Logger.fatal(
      'Usage: node sprint-story-close.js --story <STORY_ID> [--epic <EPIC_ID>]',
    );
  }

  let epicId = argEpicId;

  const { orchestration } = resolveConfig();
  const provider = injectedProvider || createProvider(orchestration);

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
  // Step 5 — Risk check and merge
  // -------------------------------------------------------------------------

  const riskHighGateEnabled = orchestration?.hitl?.riskHighApproval !== false;
  const isHighRisk = story.labels.includes('risk::high') && riskHighGateEnabled;

  let branchCleanup = { localDeleted: false, remoteDeleted: false };
  if (isHighRisk) {
    const riskResult = await handleHighRiskGate(
      provider,
      storyBranch,
      storyId,
      epicId,
      cwd,
    );
    const result = { storyId, epicId, ...riskResult };
    console.log('\n--- STORY CLOSE RESULT ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('--- END RESULT ---\n');
    return { success: false, result };
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
    // Reap must precede branch cleanup: git refuses to delete a branch
    // that is still checked out by a live worktree. A failed reap will
    // leave the worktree registration in place and the subsequent branch
    // delete will fail — which is now reported in the structured result
    // rather than silently swallowed.
    await reapStoryWorktree({
      orchestration,
      storyId,
      epicBranch,
      repoRoot: cwd,
    });
    branchCleanup = cleanupBranches(storyBranch, cwd);
  }

  // Cascade Completion (Ticket Closure)
  const { closedTickets, cascadedTo, cascadeFailed } =
    await ticketClosureCascade(provider, tasks, storyId);

  // Notification, health, and dashboard are each best-effort; failures log
  // but do not abort the close-out. See each helper for the specific
  // failure mode it tolerates.
  await notifyStoryComplete({
    epicId,
    storyId,
    story,
    epicBranch,
    closedTickets,
    orchestration,
  });
  const healthUpdated = await updateHealth(epicId);
  const manifestUpdated = await refreshDashboard({
    epicId,
    provider,
    skipDashboard,
  });

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

  await cleanupTempFiles(storyId);

  return { success: true, result };
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

runAsCli(import.meta.url, runStoryClose, { source: 'sprint-story-close' });
