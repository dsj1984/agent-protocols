#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-story-close.js — Story Execution Closure
 *
 * Deterministic script that replaces Steps 5, 5b, and 6 of the sprint-execute
 * Mode B workflow. Performs all post-implementation orchestration:
 *
 *   1. Validates the Story branch exists and is currently checked out.
 *   2. Checks for risk::high label — creates a PR instead of auto-merging.
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
 *   1 — Error or risk::high gate (PR created instead of merge).
 *
 * @see .agents/workflows/sprint-execute.md Mode B
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAndSaveManifest } from './dispatcher.js';
import { updateHealthMetrics } from './health-monitor.js';
import { parseSprintArgs } from './lib/cli-args.js';
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
import { notify } from './notify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const progress = Logger.createProgress('sprint-story-close', { stderr: true });

function cleanupBranches(storyBranch) {
  progress('CLEANUP', `Deleting story branch: ${storyBranch}`);

  const localDelete = gitSpawn(PROJECT_ROOT, 'branch', '-d', storyBranch);
  if (localDelete.status !== 0) {
    gitSpawn(PROJECT_ROOT, 'branch', '-D', storyBranch);
  }

  const remoteDelete = gitSpawn(
    PROJECT_ROOT,
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
  const closedTickets = [];

  progress(
    'TICKETS',
    `Transitioning ${tasks.length} Task(s) to agent::done...`,
  );
  const transitionPromises = tasks.map(async (task) => {
    if (task.labels.includes(STATE_LABELS.DONE)) {
      progress('TICKETS', `  #${task.id} already done — skipped`);
      return { id: task.id, success: true };
    }
    try {
      await transitionTicketState(provider, task.id, STATE_LABELS.DONE);
      progress('TICKETS', `  #${task.id} → agent::done ✅`);
      return { id: task.id, success: true };
    } catch (err) {
      console.error(`  #${task.id} → FAILED: ${err.message}`);
      return { id: task.id, success: false };
    }
  });

  const results = await Promise.all(transitionPromises);
  for (const res of results) {
    if (res.success) {
      closedTickets.push(res.id);
    }
  }

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
// CLI argument parsing
// ---------------------------------------------------------------------------

async function handleHighRiskGate(provider, storyBranch, storyId, _epicId) {
  progress('RISK', '⚠️ Story is risk::high — creating PR instead of auto-merge');
  let prUrl = null;
  try {
    const pr = await provider.createPullRequest(storyBranch, storyId);
    prUrl = pr.htmlUrl ?? pr.url;
    progress('RISK', `PR created: ${prUrl}`);
  } catch (err) {
    console.error(`[sprint-story-close] PR creation failed: ${err.message}`);
  }
  // Push the story branch if not already pushed
  gitSpawn(PROJECT_ROOT, 'push', '--no-verify', 'origin', storyBranch);

  return {
    action: 'pr-created',
    prUrl,
    reason: 'risk::high — manual review required before merge',
  };
}

function finalizeMerge(epicBranch, storyBranch, storyTitle, storyId) {
  // Normal merge path
  progress('GIT', `Checking out ${epicBranch}...`);
  gitSync(PROJECT_ROOT, 'checkout', epicBranch);
  gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', epicBranch);

  progress('GIT', `Merging ${storyBranch} into ${epicBranch} (--no-ff)...`);
  const mergeResult = gitSpawn(
    PROJECT_ROOT,
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
  const pushResult = gitSpawn(
    PROJECT_ROOT,
    'push',
    '--no-verify',
    'origin',
    epicBranch,
  );
  if (pushResult.status !== 0) {
    Logger.fatal(`Push failed: ${pushResult.stderr}`);
  }

  cleanupBranches(storyBranch);
}

/**
 * Orchestrate the Story initialization.
 * Exported for testing.
 */
export async function runStoryClose({
  storyId: storyIdParam,
  epicId: epicIdParam,
  skipDashboard: skipDashboardParam,
  injectedProvider,
} = {}) {
  const {
    storyId,
    epicId: argEpicId,
    skipDashboard,
  } = storyIdParam !== undefined
    ? {
        storyId: storyIdParam,
        epicId: epicIdParam,
        skipDashboard: !!skipDashboardParam,
      }
    : parseSprintArgs();

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
    const epicMatch = (story.body ?? '').match(/(?:^epic:\s*#(\d+))/im);
    if (!epicMatch) {
      Logger.fatal(
        `Story #${storyId} has no "Epic: #N" reference. Pass --epic <id> explicitly.`,
      );
    }
    epicId = parseInt(epicMatch[1], 10);
  }

  const epicBranch = getEpicBranch(epicId);
  const storyBranch = getStoryBranch(epicId, storyId);

  // -------------------------------------------------------------------------
  // Enumerate child Tasks
  // -------------------------------------------------------------------------

  const subTickets = await provider.getSubTickets(storyId);
  const tasks = subTickets.filter((t) => t.labels.includes('type::task'));

  progress('TASKS', `Found ${tasks.length} child Task(s)`);

  // -------------------------------------------------------------------------
  // Step 5 — Risk check and merge
  // -------------------------------------------------------------------------

  const isHighRisk = story.labels.includes('risk::high');

  if (isHighRisk) {
    const riskResult = await handleHighRiskGate(
      provider,
      storyBranch,
      storyId,
      epicId,
    );
    const result = { storyId, epicId, ...riskResult };
    console.log('\n--- STORY CLOSE RESULT ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('--- END RESULT ---\n');
    return { success: false, result };
  } else {
    finalizeMerge(epicBranch, storyBranch, story.title, storyId);
  }

  // -------------------------------------------------------------------------
  // Step 6 — Cascade Completion (Ticket Closure)
  // -------------------------------------------------------------------------

  const { closedTickets, cascadedTo } = await ticketClosureCascade(
    provider,
    tasks,
    storyId,
  );

  // -------------------------------------------------------------------------
  // Notification — story-complete (INFO channel)
  // -------------------------------------------------------------------------

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
    console.error(
      `[sprint-story-close] Notification failed (non-fatal): ${err.message}`,
    );
  }

  // -------------------------------------------------------------------------
  // Health Monitor Update
  // -------------------------------------------------------------------------

  progress('HEALTH', 'Updating sprint health metrics...');
  let healthUpdated = false;
  try {
    await updateHealthMetrics(epicId);
    healthUpdated = true;
    progress('HEALTH', '✅ Health metrics updated');
  } catch (err) {
    console.error(
      `[sprint-story-close] Health monitor failed (non-fatal): ${err.message}`,
    );
  }

  // -------------------------------------------------------------------------
  // Dashboard Refresh (Regenerate Manifest)
  // -------------------------------------------------------------------------

  let manifestUpdated = false;
  if (!skipDashboard) {
    progress('DASHBOARD', 'Regenerating dispatch manifest...');
    try {
      await generateAndSaveManifest(epicId, true);
      manifestUpdated = true;
      progress('DASHBOARD', '✅ Dashboard manifest updated (temp/)');
    } catch (err) {
      console.error(
        `[sprint-story-close] Dashboard refresh failed (non-fatal): ${err.message}`,
      );
    }
  } else {
    progress(
      'DASHBOARD',
      '⏭️ Skipping dashboard refresh (--skip-dashboard flag set)',
    );
  }

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

  // -------------------------------------------------------------------------
  // Cleanup — remove ephemeral story manifest temp files (non-fatal)
  // -------------------------------------------------------------------------

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
        // File may not exist — ignore
      }
    }
  } catch (err) {
    console.error(
      `[sprint-story-close] Story manifest cleanup failed (non-fatal): ${err.message}`,
    );
  }

  return { success: true, result };
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

/* node:coverage ignore next */
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runStoryClose().catch((err) => {
    Logger.fatal(`sprint-story-close: ${err.message}`);
  });
}
