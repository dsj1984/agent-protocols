/**
 * lib/orchestration/dispatch-engine.js — Core Dispatch Engine (SDK)
 *
 * Stateless, async orchestration logic extracted from the CLI entry point.
 * This module is the SDK layer — it has no knowledge of CLI arguments,
 * file I/O, or process.exit(). All I/O choices are delegated to the caller.
 *
 * Consumers:
 *   - `.agents/scripts/dispatcher.js`   — CLI thin wrapper
 *   - `.agents/scripts/mcp-server.js`   — MCP tool entry point (future)
 *
 * @see .agents/scripts/lib/ITicketingProvider.js
 * @see .agents/scripts/lib/IExecutionAdapter.js
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { notify } from '../../notify.js';
import { createAdapter } from '../adapter-factory.js';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { isSafeBranchComponent } from '../dependency-parser.js';
import { buildGraph, computeWaves, detectCycle } from '../Graph.js';
import { getEpicBranch, gitSync } from '../git-utils.js';
import { createProvider } from '../provider-factory.js';
import { VerboseLogger } from '../VerboseLogger.js';
import { WorktreeManager } from '../worktree-manager.js';
import { hydrateContext } from './context-hydration-engine.js';
import { autoSerializeOverlaps } from './dependency-analyzer.js';
import { buildManifest, getResolvedBranch } from './manifest-builder.js';
import { resolveModel } from './model-resolver.js';
import { reconcileClosedTasks, reconcileHierarchy } from './reconciler.js';
import { executeStory } from './story-executor.js';
import { parseTasks } from './task-fetcher.js';
import { fetchTelemetry } from './telemetry.js';
import { STATE_LABELS } from './ticketing.js';

// Lazy verbose-logger. Deferring VerboseLogger.init() + resolveConfig() out
// of module scope means importing this SDK no longer triggers filesystem
// reads or .env loading. The proxy keeps existing `vlog.info(...)` call
// sites unchanged; the first access materializes the real logger.
let _vlog = null;
const vlog = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!_vlog) {
        const { settings } = resolveConfig();
        _vlog = VerboseLogger.init(settings, PROJECT_ROOT, {
          source: 'dispatcher',
        });
      }
      const value = _vlog[prop];
      return typeof value === 'function' ? value.bind(_vlog) : value;
    },
  },
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENT_DONE_LABEL = STATE_LABELS.DONE;
export const AGENT_EXECUTING_LABEL = STATE_LABELS.EXECUTING;
export const AGENT_READY_LABEL = STATE_LABELS.READY;
export const RISK_HIGH_LABEL = 'risk::high';
export const TYPE_TASK_LABEL = 'type::task';

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command in the project root.
 * @param {string[]} args
 * @returns {string}
 */
/* node:coverage ignore next */
function git(args) {
  return gitSync(PROJECT_ROOT, ...args);
}

/**
 * Ensure a branch exists locally. Creates it from baseBranch if not found.
 *
 * @param {string} branchName
 * @param {string} baseBranch
 */
/* node:coverage ignore next */
export function ensureBranch(branchName, baseBranch) {
  if (
    !isSafeBranchComponent(branchName) ||
    !isSafeBranchComponent(baseBranch)
  ) {
    throw new Error(
      `[Dispatcher] Unsafe branch name detected: "${branchName}" or "${baseBranch}". ` +
        'Branch names must contain only alphanumeric characters, hyphens, underscores, dots, and slashes.',
    );
  }
  try {
    git(['rev-parse', '--verify', branchName]);
    vlog.info('orchestration', `Branch already exists: ${branchName}`);
  } catch {
    git(['checkout', '-b', branchName, baseBranch]);
    git(['checkout', baseBranch]);
    vlog.info(
      'orchestration',
      `Created branch: ${branchName} from ${baseBranch}`,
    );
  }
}

/**
 * Capture the lint baseline on the Epic branch.
 *
 * @param {string} epicBranch
 * @param {object} settings
 */
/* node:coverage ignore next */
export async function captureLintBaseline(epicBranch, settings) {
  const lintBaselinePath =
    settings.lintBaselinePath ?? 'temp/lint-baseline.json';
  const absPath = path.resolve(PROJECT_ROOT, lintBaselinePath);

  if (fs.existsSync(absPath)) {
    vlog.info(
      'orchestration',
      `Lint baseline already exists, skipping capture.`,
    );
    return;
  }

  vlog.info('orchestration', `Capturing lint baseline on ${epicBranch}...`);
  try {
    execFileSync(
      'node',
      [
        path.join(PROJECT_ROOT, settings.scriptsRoot, 'lint-baseline.js'),
        'capture',
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: process.env.MCP_SERVER ? 'pipe' : 'inherit',
        shell: false,
      },
    );
  } catch (err) {
    vlog.warn(
      'orchestration',
      `Lint baseline capture failed (non-fatal): ${err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Story Execution API (SDK public API)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unified ticket resolution + dispatch (shared by CLI and MCP)
// ---------------------------------------------------------------------------

/**
 * Resolve a single ticket ID, detect its type (Epic or Story), and
 * delegate to the appropriate execution pipeline.
 *
 * This is the single entry point that both the CLI wrapper and the MCP
 * `dispatch_wave` tool should call, eliminating duplicated routing logic.
 *
 * @param {{
 *   ticketId: number,
 *   dryRun?: boolean,
 *   executorOverride?: string,
 *   provider?: import('../ITicketingProvider.js').ITicketingProvider,
 * }} options
 * @returns {Promise<object>} Dispatch or Story Execution manifest
 */
export async function resolveAndDispatch(options) {
  const { ticketId, dryRun = false, executorOverride } = options;
  const { orchestration } = resolveConfig();
  const provider = options.provider ?? createProvider(orchestration);

  const ticket = await provider.getTicket(ticketId);
  const labels = ticket.labels || [];

  const isStory = labels.includes('type::story');
  const isEpic = labels.includes('type::epic');
  const isFeature = labels.includes('type::feature');

  if (isStory) {
    return executeStory({ story: ticket, provider, dryRun });
  }

  if (isEpic) {
    return dispatch({ epicId: ticketId, dryRun, executorOverride, provider });
  }

  if (isFeature) {
    throw new Error(
      `[Dispatcher] Ticket #${ticketId} is a **Feature**. Features are containers and cannot be executed directly. ` +
        `Please execute individual Stories within this Feature using \`/sprint-execute #[Story ID]\`, ` +
        `or dispatch the entire Epic using \`/sprint-execute #${ticket.body?.match(/^parent:\s*#(\d+)/m)?.[1] || 'ID'}\`.`,
    );
  }

  const typeLabel = labels.find((l) => l.startsWith('type::')) || 'unknown';
  throw new Error(
    `[Dispatcher] Ticket #${ticketId} has type "${typeLabel.replace('type::', '')}". ` +
      `Only "epic" or "story" tickets can be dispatched. ` +
      `Please ensure the ticket is correctly categorized before execution.`,
  );
}

// ---------------------------------------------------------------------------
// Epic completion detection
// ---------------------------------------------------------------------------

/**
 * Ensure Sprint Health Issue exists
 */
async function ensureSprintHealthIssue(
  epicId,
  epic,
  allTickets,
  provider,
  dryRun,
) {
  if (dryRun) return;
  const healthIssue = allTickets.find(
    (t) =>
      (t.labels ?? []).includes('type::health') ||
      t.title.startsWith('📉 Sprint Health:'),
  );

  if (!healthIssue) {
    vlog.info(
      'orchestration',
      `Creating Sprint Health issue for Epic #${epicId}...`,
    );
    try {
      const { id } = await provider.createTicket(epicId, {
        epicId,
        title: `📉 Sprint Health: ${epic.title}`,
        body: `## Real-time Sprint Health Monitoring\n\nThis issue tracks the execution metrics, progress, and friction logs for this sprint.\n\n---\nparent: #${epicId}\nEpic: #${epicId}`,
        labels: ['type::health', 'persona::operator'],
        dependencies: [],
      });
      vlog.info('orchestration', `✅ Sprint Health issue created: #${id}`);
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Failed to create Sprint Health ticket: ${err.message}`,
      );
    }
  }
}

/**
 * Detect Epic completion and fire the bookend lifecycle.
 *
 * @param {object} params
 */
/* node:coverage ignore next */
export async function detectEpicCompletion({
  epicId,
  epic: _epic,
  tasks,
  manifest,
  provider,
  settings,
  dryRun,
}) {
  if (tasks.length === 0) return;
  const allDone = tasks.every((t) => t.status === AGENT_DONE_LABEL);
  if (!allDone) return;

  vlog.info(
    'orchestration',
    `🎉 All Tasks under Epic #${epicId} are agent::done. Starting Bookend Lifecycle.`,
  );

  if (dryRun) {
    vlog.info(
      'orchestration',
      '[DRY-RUN] Would post epic-complete comment and fire webhook.',
    );
    return;
  }

  const taskLines = tasks.map((t) => `- ✅ #${t.id}: ${t.title}`).join('\n');
  const summaryComment = [
    `## 🎉 Epic #${epicId} Complete`,
    '',
    `All **${tasks.length}** tasks have been implemented and reviewed.`,
    '',
    '### Completed Tasks',
    taskLines,
    '',
    '### ⚠️ NEXT ACTIONS — Manual Bookend Lifecycle',
    'The dispatcher does **not** auto-run bookend phases. The operator (or a',
    'follow-up agent) must invoke each slash command in order:',
    '',
    `1. \`/audit-quality ${epicId}\` — QA audit`,
    `2. \`/sprint-code-review ${epicId}\` — Mandatory code review gate`,
    `3. \`/sprint-retro ${epicId}\` — Generate retrospective (writes to \`retroPath\`)`,
    `4. \`/sprint-close ${epicId}\` — Merge, tag, close (gated on retro existence)`,
    '',
    'Skipping `/sprint-retro` will cause `/sprint-close` to halt at the',
    'Retrospective Gate (Step 1.5).',
    '',
    `> Progress: ${manifest.summary.progressPercent}% · Generated: ${manifest.generatedAt}`,
  ].join('\n');

  try {
    await provider.postComment(epicId, {
      body: summaryComment,
      type: 'notification',
    });
    vlog.info(
      'orchestration',
      `Posted epic-complete summary comment on Epic #${epicId}.`,
    );
  } catch (err) {
    vlog.warn(
      'orchestration',
      `Failed to post epic-complete comment: ${err.message}`,
    );
  }

  if (settings.notificationWebhookUrl) {
    try {
      await notify(
        epicId,
        {
          type: 'notification',
          message: `Epic #${epicId} complete. All tasks done. Bookend Lifecycle starting.`,
        },
        {
          orchestration: {
            github: { operatorHandle: '' },
            notifications: { webhookUrl: settings.notificationWebhookUrl },
          },
        },
      );
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Webhook notification failed (non-fatal): ${err.message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main dispatch function (SDK public API)
// ---------------------------------------------------------------------------

/**
 * Main dispatcher function. Orchestrates one dispatch cycle for an Epic.
 * This is the primary public export of the orchestration SDK.
 *
 * @param {{
 *   epicId: number,
 *   dryRun?: boolean,
 *   executorOverride?: string,
 *   provider?: import('../ITicketingProvider.js').ITicketingProvider,
 *   adapter?: import('../IExecutionAdapter.js').IExecutionAdapter,
 * }} options
 * @returns {Promise<object>} Dispatch Manifest
 */
/**
 * Handle the `risk::high` approval gate for a single task.
 * Posts a HITL approval comment (skipped in dry-run) and returns the
 * held-for-approval entry the caller should record.
 *
 * @param {object} task
 * @param {object} provider
 * @param {boolean} dryRun
 * @returns {Promise<{ taskId: number, reason: string }>}
 */
async function handleRiskHighGate(task, provider, dryRun) {
  vlog.info(
    'orchestration',
    `⚠️  Task #${task.id} flagged risk::high — held for approval.`,
  );
  if (!dryRun) {
    await provider.postComment(task.id, {
      body: `⚠️ **HITL Gate**: This task is flagged \`risk::high\` and requires operator approval before dispatch.\n\nTo approve, reply with: \`/approve ${task.id}\``,
      type: 'notification',
    });
  }
  return {
    taskId: task.id,
    reason: 'risk::high label requires operator approval.',
  };
}

/**
 * Dispatch a single eligible task within a wave. Builds the task-dispatch
 * payload (prompt hydration, model resolution, branch resolution), then
 * either records a dry-run entry or performs the real dispatch (branch
 * ensure + label transition + adapter call).
 *
 * @param {object} task
 * @param {object} ctx - Dispatch context (provider, adapter, settings, etc.).
 * @returns {Promise<object>} The `dispatched` entry for the manifest.
 */
/**
 * Collect story IDs whose tasks are not all done. These are the worktrees
 * GC must keep alive; everything else is fair game.
 *
 * @param {object[]} tasks - Parsed task tickets under the Epic.
 * @param {Map<number, object>} allTicketsById - Hierarchy lookup.
 * @returns {number[]}
 */
export function collectOpenStoryIds(tasks, allTicketsById) {
  const open = new Set();
  for (const task of tasks) {
    if (task.status === AGENT_DONE_LABEL) continue;
    const parentMatch = task.body?.match(/parent:\s*#(\d+)/i);
    if (!parentMatch) continue;
    const parentId = parseInt(parentMatch[1], 10);
    const parent = allTicketsById.get(parentId);
    if (parent && (parent.labels ?? []).includes('type::story')) {
      open.add(parentId);
    }
  }
  return [...open];
}

async function dispatchTaskInWave(task, ctx) {
  const {
    provider,
    adapter,
    settings,
    allTicketsById,
    epicId,
    epicBranch,
    dryRun,
  } = ctx;

  const taskBranch = getResolvedBranch(task, allTicketsById, epicId);
  const resolvedModel = resolveModel(task.model, settings);

  const hydratedPrompt = await hydrateContext(
    task,
    provider,
    epicBranch,
    taskBranch,
    epicId,
  );

  const taskDispatch = {
    taskId: task.id,
    epicId,
    branch: taskBranch,
    epicBranch,
    prompt: hydratedPrompt,
    persona: task.persona,
    model: resolvedModel,
    mode: task.mode,
    skills: task.skills,
    focusAreas: task.focusAreas,
    metadata: {
      title: task.title,
      protocolVersion: task.protocolVersion,
      dispatchedAt: new Date().toISOString(),
    },
  };

  if (dryRun) {
    vlog.info(
      'orchestration',
      `[DRY-RUN] Would dispatch Task #${task.id}: ${task.title}`,
    );
    return {
      taskId: task.id,
      dispatchId: `dry-run-${task.id}`,
      status: 'dispatched',
    };
  }

  // Worktree-per-story isolation: when a manager is present, ensure the
  // story's worktree exists and pass its absolute path as `cwd`. The agent
  // (or HITL operator) executes inside that path so concurrent stories
  // cannot race on the main checkout's HEAD. Only runs in non-dry-run mode.
  if (ctx.worktreeManager && /^story-\d+$/.test(taskBranch)) {
    const storyId = parseInt(taskBranch.slice('story-'.length), 10);
    const ensured = await ctx.worktreeManager.ensure(storyId, taskBranch);
    taskDispatch.cwd = ensured.path;
  }

  ensureBranch(taskBranch, epicBranch);
  await provider.updateTicket(task.id, {
    labels: { add: [AGENT_EXECUTING_LABEL], remove: [AGENT_READY_LABEL] },
  });

  const result = await adapter.dispatchTask(taskDispatch);
  vlog.info(
    'orchestration',
    `✅ Dispatched Task #${task.id} — dispatchId: ${result.dispatchId}`,
  );
  return { taskId: task.id, ...result };
}

/**
 * Dispatch one wave. Returns `{ dispatched, heldForApproval, shouldHalt }`
 * where `shouldHalt=true` means the caller should stop iterating waves
 * (upstream dependencies not yet complete).
 *
 * @param {object[]} wave
 * @param {Map<number, object>} taskMap
 * @param {object} ctx
 * @returns {Promise<{ dispatched: object[], heldForApproval: object[], shouldHalt: boolean, empty: boolean }>}
 */
async function dispatchWave(wave, taskMap, ctx) {
  const eligible = wave.filter(
    (t) => t.status !== AGENT_DONE_LABEL && t.status !== AGENT_EXECUTING_LABEL,
  );

  if (eligible.length === 0) {
    vlog.info('orchestration', 'Wave fully complete, moving to next...');
    return {
      dispatched: [],
      heldForApproval: [],
      shouldHalt: false,
      empty: true,
    };
  }

  const waveDepsComplete = eligible.every((task) =>
    task.dependsOn.every((depId) => {
      const dep = taskMap.get(depId);
      return dep?.status === AGENT_DONE_LABEL;
    }),
  );
  if (!waveDepsComplete) {
    vlog.info('orchestration', 'Wave dependencies not yet complete. Halting.');
    return {
      dispatched: [],
      heldForApproval: [],
      shouldHalt: true,
      empty: false,
    };
  }

  const dispatched = [];
  const heldForApproval = [];
  for (const task of eligible) {
    if (task.isRiskHigh) {
      heldForApproval.push(
        await handleRiskHighGate(task, ctx.provider, ctx.dryRun),
      );
      continue;
    }
    dispatched.push(await dispatchTaskInWave(task, ctx));
  }
  return { dispatched, heldForApproval, shouldHalt: false, empty: false };
}

export async function dispatch(options) {
  const { epicId, dryRun = false, executorOverride } = options;

  const { settings, orchestration } = resolveConfig();
  const provider = options.provider ?? createProvider(orchestration);
  const adapter =
    options.adapter ??
    createAdapter(orchestration, { executor: executorOverride });

  // Worktree-per-story isolation. Construct only when configured AND not
  // dry-run; dry-run must never touch git worktrees. Tests can inject a
  // mock via `options.worktreeManager`.
  const wtConfig = orchestration?.worktreeIsolation;
  let worktreeManager = options.worktreeManager ?? null;
  if (!worktreeManager && wtConfig?.enabled && !dryRun) {
    worktreeManager = new WorktreeManager({
      repoRoot: PROJECT_ROOT,
      config: wtConfig,
    });
  }

  const baseBranch = settings.baseBranch ?? 'main';
  const epicBranch = getEpicBranch(epicId);

  // ── Step 1: Fetch Epic and all Tickets ────────────────────────────────────
  vlog.info('orchestration', `\nFetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  vlog.info('orchestration', `Fetching all tickets under Epic #${epicId}...`);
  const allTickets = await provider.getTickets(epicId);
  const allTicketsById = new Map(allTickets.map((t) => [t.id, t]));

  vlog.info('orchestration', `Filtering Tasks under Epic #${epicId}...`);
  const taskTickets = allTickets.filter((t) =>
    (t.labels ?? []).includes(TYPE_TASK_LABEL),
  );
  const tasks = parseTasks(taskTickets);
  vlog.info('orchestration', `Found ${tasks.length} task(s).`);

  // ── Step 1a: Ensure Sprint Health Issue exists ───────────────────────────
  await ensureSprintHealthIssue(epicId, epic, allTickets, provider, dryRun);

  // ── Step 1b: Reconcile stale labels on merged tasks ──────────────────────
  await reconcileClosedTasks(tasks, provider, dryRun);

  // ── Step 1c: Propagate completion up the full hierarchy ──────────────────
  await reconcileHierarchy(provider, epicId, epic, tasks, allTickets, dryRun);

  if (tasks.length === 0) {
    vlog.info('orchestration', 'No tasks found. Nothing to dispatch.');
    return buildManifest({
      epicId,
      epic,
      tasks: [],
      allTickets: [],
      waves: [],
      dispatched: [],
      heldForApproval: [],
      dryRun,
      adapter,
      settings,
    });
  }

  // ── Step 2: Build dependency DAG ────────────────────────────────────────
  const { adjacency, taskMap } = buildGraph(tasks);

  const cycle = detectCycle(adjacency);
  if (cycle) {
    throw new Error(
      `[Dispatcher] Dependency cycle detected: ${cycle.join(' → ')}. ` +
        'Fix the ticket dependencies before re-running.',
    );
  }

  // ── Step 3: Auto-serialize focus-area overlaps ───────────────────────────
  const pseudoManifest = { tasks };
  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(
    pseudoManifest,
    adjacency,
  );
  if (graphMutated) {
    vlog.info(
      'orchestration',
      'Focus-area conflicts detected; serialized overlapping tasks.',
    );
  }

  // ── Step 4: Compute execution waves ─────────────────────────────────────
  const allWaves = computeWaves(finalAdjacency, taskMap);
  vlog.info('orchestration', `Computed ${allWaves.length} execution wave(s).`);

  // ── Step 5: Epic branch creation (skip in dry-run) ─────────────────────────
  if (!dryRun) {
    vlog.info('orchestration', `Ensuring Epic base branch: ${epicBranch}`);
    ensureBranch(epicBranch, baseBranch);
    captureLintBaseline(epicBranch, settings);
  } else {
    vlog.info('orchestration', 'Dry-run mode: skipping branch creation.');
  }

  // ── Step 5a: Worktree GC — reap orphaned story worktrees ────────────────
  // A story worktree is "orphaned" once its story has closed (no live tasks
  // remaining). gc() refuses to delete dirty trees, so this is safe even
  // mid-edit. Only runs when isolation is enabled.
  if (worktreeManager && !dryRun) {
    try {
      const openStoryIds = collectOpenStoryIds(tasks, allTicketsById);
      const gcResult = await worktreeManager.gc(openStoryIds, { epicBranch });
      if (gcResult.reaped.length > 0) {
        vlog.info(
          'orchestration',
          `Worktree GC reaped ${gcResult.reaped.length} orphan(s).`,
        );
      }
    } catch (err) {
      vlog.warn('orchestration', `Worktree GC failed (non-fatal): ${err.message}`);
    }
  }

  // ── Step 6: Determine next wave to dispatch ──────────────────────────────
  const dispatched = [];
  const heldForApproval = [];

  const waveCtx = {
    provider,
    adapter,
    settings,
    allTicketsById,
    epicId,
    epicBranch,
    dryRun,
    worktreeManager,
  };

  for (const wave of allWaves) {
    const result = await dispatchWave(wave, taskMap, waveCtx);
    if (result.empty) continue;
    if (result.shouldHalt) break;
    dispatched.push(...result.dispatched);
    heldForApproval.push(...result.heldForApproval);
    // Only dispatch one wave per invocation
    break;
  }

  // ── Step 7: Telemetry & Diagnostics ─────────────────────────────────────
  const agentTelemetry = await fetchTelemetry(provider, tasks);

  // ── Step 8: Build and emit manifest ─────────────────────────────────────
  const manifest = buildManifest({
    epicId,
    epic,
    tasks,
    allTickets,
    waves: allWaves,
    dispatched,
    heldForApproval,
    dryRun,
    adapter,
    settings,
    agentTelemetry,
  });

  // ── Step 9: Epic completion detection ────────────────────────────────────
  await detectEpicCompletion({
    epicId,
    epic,
    tasks,
    manifest,
    provider,
    settings,
    dryRun,
  });

  return manifest;
}
