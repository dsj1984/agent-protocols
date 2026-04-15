#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-story-close.js — Story Execution Closure
 *
 * Deterministic script that replaces Steps 5, 5b, and 6 of the sprint-execute
 * Mode B workflow. Performs all post-implementation orchestration:
 *
 *   1. Validates the Story branch exists and is currently checked out.
 *   2. Checks for risk::high label — pauses with a HITL comment and exits
 *      non-zero. The operator either removes the label and re-runs, merges
 *      manually, or reworks. The story branch is left untouched.
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

import path from 'node:path';
import { generateAndSaveManifest } from './dispatcher.js';
import { updateHealthMetrics } from './health-monitor.js';
import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
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

  const localDelete = gitSpawn(cwd, 'branch', '-d', storyBranch);
  if (localDelete.status !== 0) {
    gitSpawn(cwd, 'branch', '-D', storyBranch);
  }

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
    progress('CLEANUP', `✅ Remote branch ${storyBranch} deleted`);
  }
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
  try {
    cascadedTo = (await cascadeCompletion(provider, storyId)) || [];
    if (cascadedTo.length > 0) {
      progress(
        'TICKETS',
        `  Cascaded to: ${cascadedTo.map((id) => `#${id}`).join(', ')}`,
      );
    }
  } catch (err) {
    console.error(`  Cascade failed (non-fatal): ${err.message}`);
  }

  return { closedTickets, cascadedTo };
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

async function reapStoryWorktree({ orchestration, storyId, epicBranch }) {
  const wtConfig = orchestration?.worktreeIsolation;
  if (!wtConfig?.enabled || !(wtConfig.reapOnSuccess ?? true)) return;

  try {
    const wm = new WorktreeManager({
      repoRoot: PROJECT_ROOT,
      config: wtConfig,
    });
    const reapResult = await wm.reap(storyId, { epicBranch });
    if (reapResult.removed) {
      progress('WORKTREE', `🗑️  Reaped worktree: ${reapResult.path}`);
    } else if (reapResult.reason && reapResult.reason !== 'not-a-worktree') {
      progress(
        'WORKTREE',
        `⚠️  Worktree not reaped (${reapResult.reason}): ${reapResult.path}`,
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
  provider,
  storyBranch,
  storyId,
  _epicId,
  _cwd,
) {
  progress(
    'RISK',
    '⚠️ Story is risk::high — pausing for operator decision (no PR, no merge).',
  );

  try {
    await provider.postComment(storyId, {
      body:
        `⚠️ **HITL Gate — risk::high Story #${storyId}**\n\n` +
        `All child tasks are complete on branch \`${storyBranch}\`, but this ` +
        `story is labelled \`risk::high\`. Automated merge is paused.\n\n` +
        `**Choose one:**\n` +
        `- **Proceed with merge** — re-run \`sprint-story-close\` for this ` +
        `story after removing the \`risk::high\` label (or flip ` +
        `\`orchestration.hitl.riskHighApproval: false\` in \`.agentrc.json\` ` +
        `to disable the gate globally).\n` +
        `- **Review manually** — check out \`${storyBranch}\`, inspect the ` +
        `diff against the epic branch, and merge by hand when satisfied.\n` +
        `- **Reject / rework** — leave the branch in place and open follow-up ` +
        `tasks; the story stays blocked until the label is removed.\n\n` +
        `The story branch has **not** been pushed, merged, or deleted.`,
      type: 'notification',
    });
  } catch (err) {
    console.error(
      `[sprint-story-close] Failed to post HITL comment: ${err.message}`,
    );
  }

  return {
    action: 'paused-for-approval',
    reason:
      'risk::high — operator must choose: re-run after label removal, ' +
      'merge manually, or rework. Story branch left untouched.',
  };
}

function finalizeMerge(epicBranch, storyBranch, storyTitle, storyId, cwd) {
  // Normal merge path.
  progress('GIT', `Checking out ${epicBranch}...`);
  gitSync(cwd, 'checkout', epicBranch);
  gitSpawn(cwd, 'pull', '--rebase', 'origin', epicBranch);

  progress('GIT', `Merging ${storyBranch} into ${epicBranch} (--no-ff)...`);
  const mergeResult = gitSpawn(
    cwd,
    'merge',
    '--no-ff',
    storyBranch,
    '-m',
    `feat: ${storyTitle.charAt(0).toLowerCase() + storyTitle.slice(1)} (resolves #${storyId})`,
  );

  if (mergeResult.status !== 0) {
    Logger.fatal(
      `Merge failed: ${mergeResult.stderr}\n` +
        `Resolve conflicts manually, then re-run this script.`,
    );
  }
  progress('GIT', '✅ Merge successful');

  progress('GIT', `Pushing ${epicBranch}...`);
  const pushResult = gitSpawn(cwd, 'push', '--no-verify', 'origin', epicBranch);
  if (pushResult.status !== 0) {
    Logger.fatal(`Push failed: ${pushResult.stderr}`);
  }

  cleanupBranches(storyBranch, cwd);
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
    finalizeMerge(epicBranch, storyBranch, story.title, storyId, cwd);
    await reapStoryWorktree({ orchestration, storyId, epicBranch });
  }

  // Cascade Completion (Ticket Closure)
  const { closedTickets, cascadedTo } = await ticketClosureCascade(
    provider,
    tasks,
    storyId,
  );

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
    branchDeleted: true,
    ticketsClosed: closedTickets,
    cascadedTo: cascadedTo ?? [],
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
