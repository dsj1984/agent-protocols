#!/usr/bin/env node
/* node:coverage ignore file */

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

import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { parseBlockedBy } from './lib/dependency-parser.js';
import { buildGraph, topologicalSort } from './lib/Graph.js';
import {
  getEpicBranch,
  getStoryBranch,
  gitFetchWithRetry,
  gitSpawn,
  gitSync,
} from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import { STATE_LABELS } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';
import {
  batchTransitionTickets,
  fetchChildTasks,
  resolveStoryHierarchy,
} from './lib/story-lifecycle.js';

// ---------------------------------------------------------------------------
// Helper Modules
// ---------------------------------------------------------------------------

async function resolveStoryContext(provider, storyId) {
  let story;
  try {
    story = await provider.getTicket(storyId);
  } catch (err) {
    throw new Error(`Failed to fetch Story #${storyId}: ${err.message}`);
  }

  if (!story.labels.includes('type::story')) {
    throw new Error(
      `Issue #${storyId} is not a Story (labels: ${story.labels.join(', ')}). Use the dispatcher for Epics.`,
    );
  }

  const body = story.body ?? '';
  const { epicId, featureId } = resolveStoryHierarchy(body);

  if (!epicId) {
    throw new Error(
      `Story #${storyId} has no "Epic: #N" reference in its body. Cannot resolve hierarchy.`,
    );
  }

  let prdId = null;
  let techSpecId = null;
  try {
    const epic = await provider.getEpic(epicId);
    prdId = epic.linkedIssues?.prd ?? null;
    techSpecId = epic.linkedIssues?.techSpec ?? null;
  } catch (err) {
    console.error(
      `[sprint-story-init] Warning: Could not fetch Epic #${epicId}: ${err.message}`,
    );
  }

  return { story, body, epicId, featureId, prdId, techSpecId };
}

async function checkBlockers(provider, _storyId, body) {
  const blockedBy = parseBlockedBy(body);
  if (blockedBy.length === 0) return [];

  progress(
    'BLOCKERS',
    `Checking ${blockedBy.length} dependency/dependencies...`,
  );

  const blockerPromises = blockedBy.map(async (depId) => {
    try {
      const dep = await provider.getTicket(depId);
      const isDone =
        dep.labels.includes(STATE_LABELS.DONE) || dep.state === 'closed';
      if (!isDone) {
        const currentState =
          dep.labels.find((l) => l.startsWith('agent::')) ?? 'no agent:: label';
        return { id: depId, title: dep.title, state: currentState };
      }
      return null;
    } catch (err) {
      return {
        id: depId,
        title: '(fetch failed)',
        state: err.message,
      };
    }
  });

  const results = await Promise.all(blockerPromises);
  return results.filter((b) => b !== null);
}

function extractAndSortTasks(tasks) {
  if (tasks.length <= 1) return tasks;

  const graphTasks = tasks.map((t) => ({
    ...t,
    dependsOn: parseBlockedBy(t.body ?? '').filter((dep) =>
      tasks.some((tt) => tt.id === dep),
    ),
  }));
  try {
    const { adjacency, taskMap } = buildGraph(graphTasks);
    return topologicalSort(adjacency, taskMap);
  } catch {
    console.error(
      '[sprint-story-init] Warning: Could not topologically sort tasks. Using original order.',
    );
    return tasks;
  }
}

function branchExistsLocally(branch) {
  return (
    gitSpawn(
      PROJECT_ROOT,
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ).status === 0
  );
}

function branchExistsRemotely(branch) {
  const result = gitSpawn(
    PROJECT_ROOT,
    'ls-remote',
    '--heads',
    'origin',
    branch,
  );
  return result.status === 0 && result.stdout.length > 0;
}

function assertWorkingTreeClean() {
  const status = gitSpawn(PROJECT_ROOT, 'status', '--porcelain');
  if (status.status !== 0) {
    throw new Error(
      `Failed to read git status: ${status.stderr || '(no stderr)'}`,
    );
  }
  if (status.stdout.length > 0) {
    throw new Error(
      `Working tree is dirty. Refusing to switch branches — uncommitted/untracked files may belong to another agent.\nRun \`git status\` and resolve before retrying.\n--- dirty entries ---\n${status.stdout}`,
    );
  }
}

function ensureEpicBranch(epicBranch, baseBranch) {
  const local = branchExistsLocally(epicBranch);
  const remote = branchExistsRemotely(epicBranch);

  if (!local && !remote) {
    progress('GIT', `Creating Epic branch: ${epicBranch} (from ${baseBranch})`);
    gitSync(PROJECT_ROOT, 'checkout', baseBranch);
    gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', baseBranch);
    gitSync(PROJECT_ROOT, 'checkout', '-b', epicBranch);
    gitSync(PROJECT_ROOT, 'push', '--no-verify', '-u', 'origin', epicBranch);
    return;
  }

  if (local && !remote) {
    progress(
      'GIT',
      `Epic branch exists locally only: ${epicBranch}. Publishing.`,
    );
    gitSync(PROJECT_ROOT, 'checkout', epicBranch);
    gitSync(PROJECT_ROOT, 'push', '--no-verify', '-u', 'origin', epicBranch);
    return;
  }

  if (!local && remote) {
    progress('GIT', `Tracking remote Epic branch: ${epicBranch}`);
    gitSync(PROJECT_ROOT, 'checkout', '-b', epicBranch, `origin/${epicBranch}`);
    gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', epicBranch);
    return;
  }

  progress('GIT', `Epic branch exists. Syncing: ${epicBranch}`);
  gitSync(PROJECT_ROOT, 'checkout', epicBranch);
  gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', epicBranch);
}

function checkoutStoryBranch(storyBranch, epicBranch) {
  const local = branchExistsLocally(storyBranch);
  const remote = branchExistsRemotely(storyBranch);

  if (local || remote) {
    progress(
      'GIT',
      `Story branch already exists (local=${local}, remote=${remote}). Checking out non-destructively: ${storyBranch}`,
    );
    if (local) {
      gitSync(PROJECT_ROOT, 'checkout', storyBranch);
      if (remote) {
        gitSpawn(PROJECT_ROOT, 'pull', '--rebase', 'origin', storyBranch);
      }
    } else {
      gitSync(
        PROJECT_ROOT,
        'checkout',
        '-b',
        storyBranch,
        `origin/${storyBranch}`,
      );
    }
    return;
  }

  progress('GIT', `Creating Story branch: ${storyBranch} (from ${epicBranch})`);
  gitSync(PROJECT_ROOT, 'checkout', '-b', storyBranch, epicBranch);
}

async function bootstrapBranch(epicBranch, storyBranch, baseBranch) {
  progress('GIT', 'Fetching remote refs...');
  const fetchResult = await gitFetchWithRetry(PROJECT_ROOT, 'origin');
  if (fetchResult.attempts > 1) {
    progress(
      'GIT',
      `Fetch completed after ${fetchResult.attempts} attempt(s) — packed-refs contention.`,
    );
  }

  assertWorkingTreeClean();

  ensureEpicBranch(epicBranch, baseBranch);
  checkoutStoryBranch(storyBranch, epicBranch);

  const currentBranch = gitSpawn(PROJECT_ROOT, 'branch', '--show-current');
  if (currentBranch.stdout !== storyBranch) {
    throw new Error(
      `Branch verification failed. Expected: ${storyBranch}, Got: ${currentBranch.stdout}.`,
    );
  }
  progress('GIT', `✅ On branch: ${currentBranch.stdout}`);
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

/**
 * Orchestrate the Story initialization.
 * Exported for testing.
 */
export async function runStoryInit({
  storyId: storyIdParam,
  dryRun: dryRunParam,
  injectedProvider,
  injectedConfig,
} = {}) {
  const { storyId, dryRun } =
    storyIdParam !== undefined
      ? { storyId: storyIdParam, dryRun: !!dryRunParam }
      : parseSprintArgs();

  if (!storyId) {
    Logger.fatal(
      'Usage: node sprint-story-init.js --story <STORY_ID> [--dry-run]',
    );
  }

  const { settings, orchestration } = injectedConfig || resolveConfig();
  const provider = injectedProvider || createProvider(orchestration);

  progress('INIT', `Initializing Story #${storyId}...`);

  let storyContext;
  try {
    storyContext = await resolveStoryContext(provider, storyId);
  } catch (err) {
    throw new Error(err.message);
  }

  const { story, body, epicId, featureId, prdId, techSpecId } = storyContext;
  progress(
    'CONTEXT',
    `Epic: #${epicId}, Feature/Parent: #${featureId ?? 'none'}`,
  );
  progress(
    'CONTEXT',
    `PRD: #${prdId ?? 'none'}, Tech Spec: #${techSpecId ?? 'none'}`,
  );

  const openBlockers = await checkBlockers(provider, storyId, body);
  if (openBlockers.length > 0) {
    console.error(
      `\n❌ BLOCKED: Story #${storyId} is blocked by ${openBlockers.length} incomplete prerequisite(s):`,
    );
    for (const b of openBlockers) {
      console.error(`   - #${b.id} "${b.title}" (${b.state})`);
    }
    return { success: false, blocked: true, openBlockers };
  }
  if (parseBlockedBy(body).length > 0)
    progress('BLOCKERS', '✅ All blockers resolved');

  const tasks = await fetchChildTasks(provider, storyId);

  if (tasks.length === 0) {
    console.error(
      `[sprint-story-init] Warning: Story #${storyId} has no child Tasks. The agent will need to work from the Story body directly.`,
    );
  }

  const sortedTasks = extractAndSortTasks(tasks);
  progress(
    'TASKS',
    `Found ${sortedTasks.length} child Task(s) in dependency order`,
  );

  const epicBranch = getEpicBranch(epicId);
  const storyBranch = getStoryBranch(epicId, storyId);

  if (!dryRun) {
    const baseBranch = settings.baseBranch ?? 'main';
    try {
      await bootstrapBranch(epicBranch, storyBranch, baseBranch);
    } catch (err) {
      throw new Error(err.message);
    }

    progress(
      'TICKETS',
      `Transitioning ${sortedTasks.length} Task(s) to agent::executing...`,
    );
    await batchTransitionTickets(
      provider,
      sortedTasks,
      STATE_LABELS.EXECUTING,
      { progress },
    );
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

  return { success: true, result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const progress = Logger.createProgress('sprint-story-init', { stderr: true });

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

runAsCli(import.meta.url, runStoryInit, { source: 'sprint-story-init' });
