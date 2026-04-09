#!/usr/bin/env node

/**
 * sprint-story-init.js — Story Execution Initialization
 *
 * Deterministic script that replaces Steps 0-2 of the sprint-execute
 * Mode B workflow. Performs all pre-implementation setup:
 *
 *   1. Fetches the Story ticket and validates it exists.
 *   2. Checks blockers — exits non-zero if any `blocked by` are open.
 *   3. Traces the hierarchy (Feature → Epic → PRD / Tech Spec).
 *   4. Enumerates child Tasks in dependency order.
 *   5. Bootstraps the Epic branch if it doesn't exist remotely.
 *   6. Checks out the Story branch with -B from epic/<epicId>.
 *   7. Verifies the checkout succeeded.
 *   8. Batch transitions all child Tasks to agent::executing.
 *
 * Usage:
 *   node sprint-story-init.js --story <STORY_ID> [--dry-run]
 *
 * Exit codes:
 *   0 — Initialization complete. Agent can start implementation.
 *   1 — Blocked or error (details in stderr).
 *
 * @see .agents/workflows/sprint-execute.md Mode B
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { parseBlockedBy } from './lib/dependency-parser.js';
import { getEpicBranch, getStoryBranch, gitSpawn, gitSync } from './lib/git-utils.js';
import { buildGraph, topologicalSort } from './lib/Graph.js';
import { Logger } from './lib/Logger.js';
import { STATE_LABELS, transitionTicketState } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      story: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: false,
  });

  const storyId = parseInt(values.story ?? '', 10);
  const dryRun = values['dry-run'] ?? false;

  if (Number.isNaN(storyId) || storyId <= 0) {
    Logger.fatal(
      'Usage: node sprint-story-init.js --story <STORY_ID> [--dry-run]',
    );
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  progress('INIT', `Initializing Story #${storyId}...`);

  // -------------------------------------------------------------------------
  // Step 0 — Context Gathering
  // -------------------------------------------------------------------------

  // 0a. Fetch the Story ticket
  let story;
  try {
    story = await provider.getTicket(storyId);
  } catch (err) {
    Logger.fatal(`Failed to fetch Story #${storyId}: ${err.message}`);
  }

  if (!story.labels.includes('type::story')) {
    Logger.fatal(
      `Issue #${storyId} is not a Story (labels: ${story.labels.join(', ')}). ` +
        `Use the dispatcher for Epics.`,
    );
  }

  // 0b. Parse hierarchy metadata
  const body = story.body ?? '';
  const epicMatch = body.match(/(?:^epic:\s*#(\d+))/im);
  const parentMatch = body.match(/(?:^parent:\s*#(\d+))/im);

  const epicId = epicMatch ? parseInt(epicMatch[1], 10) : null;
  const featureId = parentMatch ? parseInt(parentMatch[1], 10) : null;

  if (!epicId) {
    Logger.fatal(
      `Story #${storyId} has no "Epic: #N" reference in its body. Cannot resolve hierarchy.`,
    );
  }

  progress('CONTEXT', `Epic: #${epicId}, Feature/Parent: #${featureId ?? 'none'}`);

  // 0c. Fetch Epic and linked planning artifacts
  let prdId = null;
  let techSpecId = null;
  try {
    const epic = await provider.getEpic(epicId);
    prdId = epic.linkedIssues?.prd ?? null;
    techSpecId = epic.linkedIssues?.techSpec ?? null;
    progress('CONTEXT', `PRD: #${prdId ?? 'none'}, Tech Spec: #${techSpecId ?? 'none'}`);
  } catch (err) {
    console.error(`[sprint-story-init] Warning: Could not fetch Epic #${epicId}: ${err.message}`);
  }

  // 0d. Blocker check
  const blockedBy = parseBlockedBy(body);
  if (blockedBy.length > 0) {
    progress('BLOCKERS', `Checking ${blockedBy.length} dependency/dependencies...`);
    const openBlockers = [];

    for (const depId of blockedBy) {
      try {
        const dep = await provider.getTicket(depId);
        const isDone =
          dep.labels.includes(STATE_LABELS.DONE) || dep.state === 'closed';
        if (!isDone) {
          const currentState =
            dep.labels.find((l) => l.startsWith('agent::')) ?? 'no agent:: label';
          openBlockers.push({ id: depId, title: dep.title, state: currentState });
        }
      } catch (err) {
        openBlockers.push({ id: depId, title: '(fetch failed)', state: err.message });
      }
    }

    if (openBlockers.length > 0) {
      console.error(
        `\n❌ BLOCKED: Story #${storyId} is blocked by ${openBlockers.length} incomplete prerequisite(s):`,
      );
      for (const b of openBlockers) {
        console.error(`   - #${b.id} "${b.title}" (${b.state})`);
      }
      process.exit(1);
    }
    progress('BLOCKERS', '✅ All blockers resolved');
  }

  // 0e. Enumerate child Tasks
  const subTickets = await provider.getSubTickets(storyId);
  const tasks = subTickets.filter((t) => t.labels.includes('type::task'));

  if (tasks.length === 0) {
    console.error(
      `[sprint-story-init] Warning: Story #${storyId} has no child Tasks. ` +
        `The agent will need to work from the Story body directly.`,
    );
  }

  // 0f. Sort tasks by dependency order
  let sortedTasks = tasks;
  if (tasks.length > 1) {
    // Adapt to Graph.js API: tasks need .dependsOn arrays
    const graphTasks = tasks.map((t) => ({
      ...t,
      dependsOn: parseBlockedBy(t.body ?? '').filter((dep) =>
        tasks.some((tt) => tt.id === dep),
      ),
    }));
    try {
      const { adjacency, taskMap } = buildGraph(graphTasks);
      sortedTasks = topologicalSort(adjacency, taskMap);
    } catch {
      // Cycle detected or sort failure — use original order
      console.error('[sprint-story-init] Warning: Could not topologically sort tasks. Using original order.');
    }
  }

  progress('TASKS', `Found ${sortedTasks.length} child Task(s) in dependency order`);

  // -------------------------------------------------------------------------
  // Step 1 — Epic Branch Bootstrap
  // -------------------------------------------------------------------------

  const epicBranch = getEpicBranch(epicId);
  const storyBranch = getStoryBranch(epicId, storyId);

  if (!dryRun) {
    progress('GIT', 'Fetching remote refs...');
    gitSpawn(PROJECT_ROOT, 'fetch', 'origin');

    const lsRemote = gitSpawn(PROJECT_ROOT, 'ls-remote', '--heads', 'origin', epicBranch);
    const epicExistsRemotely = lsRemote.stdout.length > 0;

    if (!epicExistsRemotely) {
      progress('GIT', `Creating Epic branch: ${epicBranch} (from main)`);
      const baseBranch = orchestration?.baseBranch ?? 'main';
      gitSync(PROJECT_ROOT, 'checkout', baseBranch);
      gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', baseBranch);
      gitSync(PROJECT_ROOT, 'checkout', '-b', epicBranch);
      gitSync(PROJECT_ROOT, 'push', '--no-verify', 'origin', epicBranch);
    } else {
      progress('GIT', `Epic branch exists. Syncing: ${epicBranch}`);
      // Checkout and pull latest
      const checkoutResult = gitSpawn(PROJECT_ROOT, 'checkout', epicBranch);
      if (checkoutResult.status !== 0) {
        // Might not exist locally — create tracking branch
        gitSync(PROJECT_ROOT, 'checkout', '-b', epicBranch, `origin/${epicBranch}`);
      }
      gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', epicBranch);
    }

    // -----------------------------------------------------------------------
    // Step 2 — Story Branch Checkout
    // -----------------------------------------------------------------------

    progress('GIT', `Checking out Story branch: ${storyBranch} (from ${epicBranch})`);
    gitSync(PROJECT_ROOT, 'checkout', '-B', storyBranch, epicBranch);

    // Verify checkout
    const currentBranch = gitSpawn(PROJECT_ROOT, 'branch', '--show-current');
    if (currentBranch.stdout !== storyBranch) {
      Logger.fatal(
        `Branch verification failed. Expected: ${storyBranch}, Got: ${currentBranch.stdout}. STOP.`,
      );
    }
    progress('GIT', `✅ On branch: ${currentBranch.stdout}`);

    // -----------------------------------------------------------------------
    // Batch transition Tasks → agent::executing
    // -----------------------------------------------------------------------

    progress('TICKETS', `Transitioning ${sortedTasks.length} Task(s) to agent::executing...`);
    for (const task of sortedTasks) {
      if (task.labels.includes(STATE_LABELS.EXECUTING)) {
        progress('TICKETS', `  #${task.id} already executing — skipped`);
        continue;
      }
      if (task.labels.includes(STATE_LABELS.DONE)) {
        progress('TICKETS', `  #${task.id} already done — skipped`);
        continue;
      }
      try {
        await transitionTicketState(provider, task.id, STATE_LABELS.EXECUTING);
        progress('TICKETS', `  #${task.id} → agent::executing ✅`);
      } catch (err) {
        console.error(`  #${task.id} → FAILED: ${err.message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Output — structured JSON for the agent to consume
  // -------------------------------------------------------------------------

  const result = {
    storyId,
    epicId,
    storyBranch,
    epicBranch,
    storyTitle: story.title,
    tasks: sortedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      labels: t.labels,
      dependencies: t.dependsOn ?? parseBlockedBy(t.body ?? ''),
    })),
    context: {
      featureId,
      prdId,
      techSpecId,
    },
    dryRun,
  };

  console.log('\n--- STORY INIT RESULT ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('--- END RESULT ---\n');

  progress(
    'DONE',
    dryRun
      ? '✅ Dry-run complete. No git or ticket changes made.'
      : `✅ Story #${storyId} initialized. ${sortedTasks.length} Task(s) ready for implementation.`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progress(phase, message) {
  console.error(`▶ [sprint-story-init] [${phase}] ${message}`);
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    Logger.fatal(`sprint-story-init: ${err.message}`);
  });
}
