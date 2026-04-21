/**
 * dispatch-pipeline.js
 *
 * Internal pipeline helpers composed by `dispatch-engine.js::dispatch()`.
 * Keeping these out of the coordinator keeps the public entry point compact
 * and focused on the 6-step flow: resolve → fetch → reconcile → graph →
 * scaffold → GC → dispatch.
 */

import { createAdapter } from '../adapter-factory.js';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { buildGraph, computeWaves, detectCycle } from '../Graph.js';
import { getEpicBranch } from '../git-utils.js';
import { TYPE_LABELS } from '../label-constants.js';
import { createProvider } from '../provider-factory.js';
import { WorktreeManager } from '../worktree-manager.js';
import { autoSerializeOverlaps } from './dependency-analyzer.js';
import { vlog } from './dispatch-logger.js';
import { ensureSprintHealthIssue } from './health-check-service.js';
import { reconcileClosedTasks, reconcileHierarchy } from './reconciler.js';
import { parseTasks } from './task-fetcher.js';
import { collectOpenStoryIds } from './wave-dispatcher.js';

export const TYPE_TASK_LABEL = TYPE_LABELS.TASK;

/**
 * Resolve the runtime context for a dispatch: settings, provider, adapter,
 * worktree manager, base/epic branch names, and the `ensureBranch` bound
 * helper supplied by the caller.
 *
 * @param {object} options
 * @param {(branchName: string, baseBranch: string) => void} ensureBranch
 */
export function resolveDispatchContext(options, ensureBranch) {
  const { epicId, dryRun = false, executorOverride } = options;

  const { settings, orchestration } = resolveConfig();
  const provider = options.provider ?? createProvider(orchestration);
  const adapter =
    options.adapter ??
    createAdapter(orchestration, { executor: executorOverride });

  const wtConfig = orchestration?.worktreeIsolation;
  let worktreeManager = options.worktreeManager;
  if (!worktreeManager && wtConfig?.enabled && !dryRun) {
    worktreeManager = new WorktreeManager({
      repoRoot: PROJECT_ROOT,
      config: wtConfig,
    });
  }

  return {
    epicId,
    dryRun,
    settings,
    orchestration,
    provider,
    adapter,
    worktreeManager,
    baseBranch: settings.baseBranch ?? 'main',
    epicBranch: getEpicBranch(epicId),
    ensureBranch,
  };
}

/**
 * Fetch Epic + all tickets, prime the provider cache, and parse the Task
 * subset.
 */
export async function fetchEpicContext(ctx) {
  const { provider, epicId } = ctx;

  vlog.info('orchestration', `\nFetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  vlog.info('orchestration', `Fetching all tickets under Epic #${epicId}...`);
  const allTickets = await provider.getTickets(epicId);
  const allTicketsById = new Map(allTickets.map((t) => [t.id, t]));

  if (typeof provider.primeTicketCache === 'function') {
    provider.primeTicketCache(allTickets);
  }

  vlog.info('orchestration', `Filtering Tasks under Epic #${epicId}...`);
  const taskTickets = allTickets.filter((t) =>
    (t.labelSet ?? new Set(t.labels)).has(TYPE_TASK_LABEL),
  );
  const tasks = parseTasks(taskTickets);
  vlog.info('orchestration', `Found ${tasks.length} task(s).`);

  return { epic, allTickets, allTicketsById, tasks };
}

/**
 * Ensure the Sprint Health issue exists, then propagate already-done work
 * up the hierarchy so the manifest reflects reality before dispatch.
 */
export async function reconcileEpicState(ctx, fetched) {
  const { provider, dryRun, epicId } = ctx;
  const { epic, allTickets, tasks } = fetched;

  await ensureSprintHealthIssue(epicId, epic, allTickets, provider, dryRun);
  await reconcileClosedTasks(tasks, provider, dryRun);
  await reconcileHierarchy(provider, epicId, epic, tasks, allTickets, dryRun);
}

/**
 * Build the task DAG, serialize focus-area overlaps, and compute dispatch
 * waves. Throws on cycles.
 */
export function buildDispatchGraph(tasks) {
  const { adjacency, taskMap } = buildGraph(tasks);

  const cycle = detectCycle(adjacency);
  if (cycle) {
    throw new Error(
      `[Dispatcher] Dependency cycle detected: ${cycle.join(' → ')}. ` +
        'Fix the ticket dependencies before re-running.',
    );
  }

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(
    { tasks },
    adjacency,
  );
  if (graphMutated) {
    vlog.info(
      'orchestration',
      'Focus-area conflicts detected; serialized overlapping tasks.',
    );
  }

  const allWaves = computeWaves(finalAdjacency, taskMap);
  vlog.info('orchestration', `Computed ${allWaves.length} execution wave(s).`);
  return { allWaves, taskMap };
}

/**
 * Ensure the Epic base branch exists and capture a lint baseline. Skipped
 * in dry-run.
 *
 * @param {object} ctx
 * @param {(epicBranch: string, settings: object) => Promise<void>} captureLintBaseline
 */
export function ensureEpicScaffolding(ctx, captureLintBaseline) {
  const { dryRun, epicBranch, baseBranch, settings, ensureBranch } = ctx;
  if (dryRun) {
    vlog.info('orchestration', 'Dry-run mode: skipping branch creation.');
    return;
  }
  vlog.info('orchestration', `Ensuring Epic base branch: ${epicBranch}`);
  ensureBranch(epicBranch, baseBranch);
  captureLintBaseline(epicBranch, settings);
}

/**
 * Reap orphaned story worktrees. No-op when isolation is disabled or dry-run.
 */
export async function runWorktreeGc(ctx, fetched) {
  const { worktreeManager, dryRun, epicBranch } = ctx;
  if (!worktreeManager || dryRun) return;
  try {
    const lockSweep = await worktreeManager.sweepStaleLocks();
    if (lockSweep.removed.length > 0) {
      vlog.info(
        'orchestration',
        `Stale lock sweep removed ${lockSweep.removed.length} file(s).`,
      );
    }
    const openStoryIds = collectOpenStoryIds(
      fetched.tasks,
      fetched.allTicketsById,
      {
        reapOnCancel:
          ctx.orchestration?.worktreeIsolation?.reapOnCancel ?? true,
      },
    );
    const gcResult = await worktreeManager.gc(openStoryIds, { epicBranch });
    if (gcResult.reaped.length > 0) {
      vlog.info(
        'orchestration',
        `Worktree GC reaped ${gcResult.reaped.length} orphan(s).`,
      );
    }
  } catch (err) {
    vlog.warn(
      'orchestration',
      `Worktree GC failed (non-fatal): ${err.message}`,
    );
  }
}
