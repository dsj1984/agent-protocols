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

import fs from 'node:fs';
import path from 'node:path';
import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { parseBlockedBy } from './lib/dependency-parser.js';
import { buildGraph, detectCycle, topologicalSort } from './lib/Graph.js';
import {
  branchExistsLocally,
  branchExistsRemotely,
  checkoutStoryBranch,
  ensureEpicBranch,
  ensureEpicBranchRef,
} from './lib/git-branch-lifecycle.js';
import {
  getEpicBranch,
  getStoryBranch,
  gitFetchWithRetry,
  gitSpawn,
} from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import {
  injectRecutMarker,
  parseRecutMarker,
} from './lib/orchestration/recut.js';
import { STATE_LABELS } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';
import {
  batchTransitionTickets,
  fetchChildTasks,
  resolveStoryHierarchy,
} from './lib/story-lifecycle.js';
import {
  resolveWorkspaceFiles,
  verify as verifyWorkspace,
} from './lib/workspace-provisioner.js';
import { WorktreeManager } from './lib/worktree-manager.js';

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
        fetchError: true,
      };
    }
  });

  const results = await Promise.all(blockerPromises);
  const active = results.filter((b) => b !== null);

  // Treat verification failures as blocking. Proceeding when dependency state
  // is unknown is riskier than requiring the operator to retry once the
  // provider/API is healthy again.
  const fetchErrors = active.filter((b) => b.fetchError);
  if (fetchErrors.length > 0) {
    progress(
      'BLOCKERS',
      `⚠️ Could not verify ${fetchErrors.length} blocker(s) (network/API error): ${fetchErrors.map((b) => `#${b.id}`).join(', ')}. Treating as blocking until verified.`,
    );
  }
  return active;
}

function extractAndSortTasks(tasks) {
  if (tasks.length <= 1) return tasks;

  const graphTasks = tasks.map((t) => ({
    ...t,
    dependsOn: parseBlockedBy(t.body ?? '').filter((dep) =>
      tasks.some((tt) => tt.id === dep),
    ),
  }));
  const { adjacency, taskMap } = buildGraph(graphTasks);

  const cycle = detectCycle(adjacency);
  if (cycle) {
    throw new Error(
      `[sprint-story-init] Dependency cycle detected among child tasks: ` +
        `#${cycle.join(' → #')}. Fix the \`blocked by\` references before retrying.`,
    );
  }

  return topologicalSort(adjacency, taskMap);
}

function assertWorkingTreeClean(cwd) {
  const status = gitSpawn(cwd, 'status', '--porcelain');
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

async function bootstrapBranch(epicBranch, storyBranch, baseBranch, cwd) {
  progress('GIT', 'Fetching remote refs...');
  const fetchResult = await gitFetchWithRetry(cwd, 'origin');
  if (fetchResult.attempts > 1) {
    progress(
      'GIT',
      `Fetch completed after ${fetchResult.attempts} attempt(s) — packed-refs contention.`,
    );
  }

  assertWorkingTreeClean(cwd);

  await ensureEpicBranch(epicBranch, baseBranch, cwd, { progress });
  await checkoutStoryBranch(storyBranch, epicBranch, cwd, { progress });

  const currentBranch = gitSpawn(cwd, 'branch', '--show-current');
  if (currentBranch.stdout !== storyBranch) {
    throw new Error(
      `Branch verification failed. Expected: ${storyBranch}, Got: ${currentBranch.stdout}.`,
    );
  }
  progress('GIT', `✅ On branch: ${currentBranch.stdout}`);
}

/**
 * Worktree-isolated bootstrap. Prepares the epic branch and story branch ref
 * in the main checkout without moving its HEAD, then spins up the per-story
 * worktree at `.worktrees/story-<id>/`. Returns the worktree's absolute path.
 *
 * @returns {Promise<{ worktreePath: string, created: boolean }>}
 */
async function bootstrapWorktree({
  epicBranch,
  storyBranch,
  storyId,
  baseBranch,
  mainCwd,
  wtConfig,
}) {
  progress('GIT', 'Fetching remote refs (main checkout)...');
  const fetchResult = await gitFetchWithRetry(mainCwd, 'origin');
  if (fetchResult.attempts > 1) {
    progress(
      'GIT',
      `Fetch completed after ${fetchResult.attempts} attempt(s) — packed-refs contention.`,
    );
  }

  // Use the HEAD-safe variant — the main checkout must not switch branches
  // because a parallel agent may be working there or the tree may be dirty.
  ensureEpicBranchRef(epicBranch, baseBranch, mainCwd, { progress });

  // Pre-seed the story branch ref without moving main's HEAD. WorktreeManager
  // requires the branch to exist before `git worktree add` can check it out.
  const localHas = branchExistsLocally(storyBranch, mainCwd);
  const remoteHas = branchExistsRemotely(storyBranch, mainCwd);
  if (!localHas && remoteHas) {
    progress('GIT', `Fetching remote story branch: ${storyBranch}`);
    gitSpawn(mainCwd, 'fetch', 'origin', `${storyBranch}:${storyBranch}`);
  } else if (!localHas && !remoteHas) {
    progress(
      'GIT',
      `Creating story branch ref: ${storyBranch} from ${epicBranch}`,
    );
    gitSpawn(mainCwd, 'branch', storyBranch, epicBranch);
  }

  const wm = new WorktreeManager({
    repoRoot: mainCwd,
    config: wtConfig,
    logger: {
      info: (m) => progress('WORKTREE', m),
      warn: (m) => progress('WORKTREE', `⚠️ ${m}`),
      error: (m) => Logger.error(`[sprint-story-init] ${m}`),
    },
  });

  const ensured = await wm.ensure(storyId, storyBranch);
  progress(
    'WORKTREE',
    `${ensured.created ? '✨ Created' : '♻️  Reusing'} worktree: ${ensured.path}`,
  );

  // Post-condition: every workspace file that exists in the main checkout
  // must also exist in the worktree. Surfaces the "silent breakage" class of
  // bug where `.env` / `.mcp.json` fail to propagate.
  try {
    const workspaceFiles = resolveWorkspaceFiles(wtConfig);
    const presentAtSource = workspaceFiles.filter((rel) =>
      fs.existsSync(path.join(mainCwd, rel)),
    );
    if (presentAtSource.length > 0) {
      verifyWorkspace({ worktree: ensured.path, files: presentAtSource });
    }
  } catch (err) {
    progress('WORKTREE', `⚠️ ${err.message}`);
    throw err;
  }

  if (ensured.installFailed) {
    progress(
      'WORKTREE',
      `⚠️ Dependency install failed. Agent must run package-manager install in the worktree before proceeding.`,
    );
  }

  if (ensured.windowsPathWarning) {
    const { path: p, length, threshold } = ensured.windowsPathWarning;
    progress(
      'WORKTREE',
      `⚠️ Windows long-path: ${p} (${length} >= ${threshold}). Consider relocating orchestration.worktreeIsolation.root.`,
    );
  }

  return {
    worktreePath: ensured.path,
    created: ensured.created,
    installFailed: !!ensured.installFailed,
  };
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
  cwd: cwdParam,
  recutOf: recutOfParam,
  injectedProvider,
  injectedConfig,
} = {}) {
  const parsed =
    storyIdParam !== undefined
      ? {
          storyId: storyIdParam,
          dryRun: !!dryRunParam,
          cwd: cwdParam ?? null,
          recutOf: recutOfParam ?? null,
        }
      : parseSprintArgs();
  const { storyId, dryRun } = parsed;
  const recutOf = recutOfParam ?? parsed.recutOf ?? null;
  // Worktree-aware cwd resolution: explicit param > --cwd flag > env > PROJECT_ROOT.
  const cwd = path.resolve(cwdParam ?? parsed.cwd ?? PROJECT_ROOT);

  if (!storyId) {
    Logger.fatal(
      'Usage: node sprint-story-init.js --story <STORY_ID> [--dry-run]',
    );
  }

  const { settings, orchestration } = injectedConfig || resolveConfig({ cwd });
  const provider = injectedProvider || createProvider(orchestration);

  progress('INIT', `Initializing Story #${storyId}...`);

  let { story, body, epicId, featureId, prdId, techSpecId } =
    await resolveStoryContext(provider, storyId);

  if (recutOf) {
    if (recutOf === storyId) {
      throw new Error(
        `[sprint-story-init] --recut-of #${recutOf} cannot point at the Story itself.`,
      );
    }
    const existing = parseRecutMarker(body);
    if (existing && existing.parentStoryId !== recutOf) {
      progress(
        'RECUT',
        `⚠️ Story #${storyId} already marked recut-of #${existing.parentStoryId}; overwriting with #${recutOf}.`,
      );
    }
    if (!existing || existing.parentStoryId !== recutOf) {
      const patched = injectRecutMarker(body, recutOf);
      if (!dryRun) {
        await provider.updateTicket(storyId, { body: patched });
        progress(
          'RECUT',
          `🪪 Marked Story #${storyId} as recut-of #${recutOf} on the ticket body.`,
        );
      } else {
        progress(
          'RECUT',
          `[DRY-RUN] Would mark Story #${storyId} as recut-of #${recutOf}.`,
        );
      }
      body = patched;
      story = { ...story, body: patched };
    } else {
      progress(
        'RECUT',
        `Story #${storyId} already carries recut-of #${recutOf} marker.`,
      );
    }
  }

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
    if (dryRun) {
      progress(
        'BLOCKERS',
        `⚠️ ${openBlockers.length} open blocker(s) detected (dry-run — not blocking):`,
      );
      for (const b of openBlockers) {
        progress('BLOCKERS', `   - #${b.id} "${b.title}" (${b.state})`);
      }
    } else {
      console.error(
        `\n❌ BLOCKED: Story #${storyId} is blocked by ${openBlockers.length} incomplete prerequisite(s):`,
      );
      for (const b of openBlockers) {
        console.error(`   - #${b.id} "${b.title}" (${b.state})`);
      }
      return { success: false, blocked: true, openBlockers };
    }
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

  let workCwd = cwd;
  let worktreeCreated = false;
  let installFailed = false;
  const wtConfig = orchestration?.worktreeIsolation;
  const worktreeEnabled = !!wtConfig?.enabled;

  if (!dryRun) {
    const baseBranch = settings.baseBranch ?? 'main';
    if (worktreeEnabled) {
      const wtResult = await bootstrapWorktree({
        epicBranch,
        storyBranch,
        storyId,
        baseBranch,
        mainCwd: cwd,
        wtConfig,
      });
      workCwd = wtResult.worktreePath;
      worktreeCreated = wtResult.created;
      installFailed = wtResult.installFailed;
    } else {
      await bootstrapBranch(epicBranch, storyBranch, baseBranch, cwd);
    }

    progress(
      'TICKETS',
      `Transitioning ${sortedTasks.length} Task(s) to agent::executing...`,
    );
    const transitionResult = await batchTransitionTickets(
      provider,
      sortedTasks,
      STATE_LABELS.EXECUTING,
      { progress },
    );
    if (transitionResult.failed.length > 0) {
      const failedSummary = transitionResult.failed
        .map((f) => `#${f.id} (${f.attempts}x: ${f.error})`)
        .join(', ');
      const continueOnPartial =
        orchestration?.storyInit?.continueOnPartialTransition === true;
      if (continueOnPartial) {
        progress(
          'TICKETS',
          `⚠️ ${transitionResult.failed.length} task(s) failed to transition after retries: ${failedSummary}. Continuing (continueOnPartialTransition=true) — agent may be working with stale state.`,
        );
      } else {
        console.error(
          `\n❌ ${transitionResult.failed.length} task(s) failed to transition after retries: ${failedSummary}`,
        );
        console.error(
          'Story init aborted. Fix the underlying error and re-run, or set ' +
            '`orchestration.storyInit.continueOnPartialTransition: true` to opt into ' +
            'the old lenient behavior.',
        );
        return {
          success: false,
          reason: 'partial-transition-failure',
          failed: transitionResult.failed,
        };
      }
    }
  }

  const result = buildStoryInitResult({
    storyId,
    epicId,
    storyBranch,
    epicBranch,
    story,
    worktreeEnabled,
    workCwd,
    worktreeCreated,
    installFailed,
    sortedTasks,
    featureId,
    prdId,
    techSpecId,
    dryRun,
    recutOf,
  });

  emitStoryInitResult(result, {
    storyId,
    dryRun,
    taskCount: sortedTasks.length,
  });

  return { success: true, result };
}

function buildStoryInitResult({
  storyId,
  epicId,
  storyBranch,
  epicBranch,
  story,
  worktreeEnabled,
  workCwd,
  worktreeCreated,
  installFailed,
  sortedTasks,
  featureId,
  prdId,
  techSpecId,
  dryRun,
  recutOf,
}) {
  return {
    storyId,
    epicId,
    storyBranch,
    epicBranch,
    storyTitle: story.title,
    worktreeEnabled,
    workCwd,
    worktreeCreated,
    installFailed,
    recutOf: recutOf ?? null,
    tasks: sortedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      labels: t.labels,
      dependencies: t.dependsOn ?? parseBlockedBy(t.body ?? ''),
    })),
    context: { featureId, prdId, techSpecId },
    dryRun,
  };
}

function emitStoryInitResult(result, { storyId, dryRun, taskCount }) {
  console.log('\n--- STORY INIT RESULT ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('--- END RESULT ---\n');

  progress(
    'DONE',
    dryRun
      ? '✅ Dry-run complete. No git or ticket changes made.'
      : `✅ Story #${storyId} initialized. ${taskCount} Task(s) ready for implementation.`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const progress = Logger.createProgress('sprint-story-init', { stderr: true });

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

runAsCli(import.meta.url, runStoryInit, { source: 'sprint-story-init' });
