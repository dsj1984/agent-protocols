/**
 * lib/orchestration/dispatcher.js — Core Dispatch Engine (SDK)
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
import { createAdapter } from '../adapter-factory.js';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { isSafeBranchComponent } from '../dependency-parser.js';
import { buildGraph, computeWaves, detectCycle } from '../Graph.js';
import { getEpicBranch, gitSync } from '../git-utils.js';
import { createProvider } from '../provider-factory.js';
import { VerboseLogger } from '../VerboseLogger.js';
import { hydrateContext } from './context-hydrator.js';
import { autoSerializeOverlaps } from './dependency-analyzer.js';
import { buildManifest, getResolvedBranch } from './manifest-builder.js';
import { resolveModel } from './model-resolver.js';
import { reconcileClosedTasks, reconcileHierarchy } from './reconciler.js';
import { parseTasks } from './task-fetcher.js';
import { executeStory } from './story-executor.js';

import { notify } from '../../notify.js';
import { fetchTelemetry } from './telemetry.js';
import { STATE_LABELS } from './ticketing.js';

const { settings: globalSettings } = resolveConfig();
const vlog = VerboseLogger.init(globalSettings, PROJECT_ROOT, {
  source: 'dispatcher',
});

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
    '### Next Steps',
    'The Bookend Lifecycle phases (Integration → QA → Code Review → Retro → Close-Out) ',
    'will now execute sequentially per `agentSettings.bookendRequirements`.',
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
export async function dispatch(options) {
  const { epicId, dryRun = false, executorOverride } = options;

  const { settings, orchestration } = resolveConfig();
  const provider = options.provider ?? createProvider(orchestration);
  const adapter =
    options.adapter ??
    createAdapter(orchestration, { executor: executorOverride });

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

  // ── Step 6: Determine next wave to dispatch ──────────────────────────────
  const dispatched = [];
  const heldForApproval = [];

  for (const wave of allWaves) {
    const eligible = wave.filter(
      (t) =>
        t.status !== AGENT_DONE_LABEL && t.status !== AGENT_EXECUTING_LABEL,
    );

    if (eligible.length === 0) {
      vlog.info('orchestration', 'Wave fully complete, moving to next...');
      continue;
    }

    const waveDepsComplete = eligible.every((task) =>
      task.dependsOn.every((depId) => {
        const dep = taskMap.get(depId);
        return dep?.status === AGENT_DONE_LABEL;
      }),
    );

    if (!waveDepsComplete) {
      vlog.info(
        'orchestration',
        'Wave dependencies not yet complete. Halting.',
      );
      break;
    }

    for (const task of eligible) {
      const taskBranch = getResolvedBranch(task, allTicketsById, epicId);
      const resolvedModel = resolveModel(task.model, settings);

      if (task.isRiskHigh) {
        vlog.info(
          'orchestration',
          `⚠️  Task #${task.id} flagged risk::high — held for approval.`,
        );
        heldForApproval.push({
          taskId: task.id,
          reason: 'risk::high label requires operator approval.',
        });

        if (!dryRun) {
          await provider.postComment(task.id, {
            body: `⚠️ **HITL Gate**: This task is flagged \`risk::high\` and requires operator approval before dispatch.\n\nTo approve, reply with: \`/approve ${task.id}\``,
            type: 'notification',
          });
        }
        continue;
      }

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
        dispatched.push({
          taskId: task.id,
          dispatchId: `dry-run-${task.id}`,
          status: 'dispatched',
        });
      } else {
        ensureBranch(taskBranch, epicBranch);

        await provider.updateTicket(task.id, {
          labels: { add: [AGENT_EXECUTING_LABEL], remove: [AGENT_READY_LABEL] },
        });

        const result = await adapter.dispatchTask(taskDispatch);
        dispatched.push({ taskId: task.id, ...result });
        vlog.info(
          'orchestration',
          `✅ Dispatched Task #${task.id} — dispatchId: ${result.dispatchId}`,
        );
      }
    }

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
