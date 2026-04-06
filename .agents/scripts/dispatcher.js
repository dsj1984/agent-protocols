#!/usr/bin/env node
/**
 * dispatcher.js — Sprint 3A/3D Execution Dispatcher
 *
 * The Dispatcher is the central orchestration engine for the v5 Epic-centric
 * execution model. Given an Epic ID, it:
 *
 *   1. Fetches all Task tickets under the Epic from the ticketing provider.
 *   2. Builds a dependency DAG from ticket body `blocked by #NNN` relations.
 *   3. Auto-serializes tasks with overlapping focus areas.
 *   4. Creates the Epic base branch and per-task feature branches (Git).
 *   5. Captures the lint baseline on the Epic branch before the first wave.
 *   6. Groups tasks into execution waves (concurrent within wave, sequential across).
 *   7. Holds tasks labelled `risk::high` for HITL approval before dispatch.
 *   8. Dispatches the next eligible wave via the configured IExecutionAdapter.
 *   9. Emits a Dispatch Manifest summarising the full plan.
 *
 * This script is stateless across invocations: re-running it will re-evaluate
 * the DAG from the current ticket state (labels) and skip tasks already done.
 *
 * Usage:
 *   node dispatcher.js --epic <epicId> [--dry-run] [--executor <name>]
 *
 * @see docs/v5-implementation-plan.md Sprint 3A
 * @see .agents/scripts/lib/IExecutionAdapter.js
 * @see .agents/schemas/dispatch-manifest.json
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolveConfig, PROJECT_ROOT } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';
import { createAdapter } from './lib/adapter-factory.js';
import {
  buildGraph,
  detectCycle,
  computeWaves,
  autoSerializeOverlaps,
} from './lib/Graph.js';
import { hydrateContext } from './context-hydrator.js';
import { parseBlockedBy, isSafeBranchComponent, parseTaskMetadata } from './lib/dependency-parser.js';
import { notify } from './notify.js';
import { gitSync } from './lib/git-utils.js';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Label prefix for agent workflow state. */
const AGENT_DONE_LABEL = 'agent::done';
const AGENT_EXECUTING_LABEL = 'agent::executing';
const AGENT_READY_LABEL = 'agent::ready';
const RISK_HIGH_LABEL = 'risk::high';

/** GitHub label that marks a ticket as a Task (vs Feature/Story/Epic). */
const TYPE_TASK_LABEL = 'type::task';

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command, returning stdout. Throws on non-zero exit.
 * Delegates to the shared gitSync utility (lib/git-utils.js).
 *
 * @param {string[]} args
 * @returns {string}
 */
function git(args) {
  return gitSync(PROJECT_ROOT, ...args);
}

/**
 * Ensure a branch exists locally. Creates it from baseBranch if not found.
 *
 * @param {string} branchName
 * @param {string} baseBranch
 */
function ensureBranch(branchName, baseBranch) {
  // Validate branch name components to prevent shell injection (C-3).
  if (!isSafeBranchComponent(branchName) || !isSafeBranchComponent(baseBranch)) {
    throw new Error(
      `[Dispatcher] Unsafe branch name detected: "${branchName}" or "${baseBranch}". ` +
      'Branch names must contain only alphanumeric characters, hyphens, underscores, dots, and slashes.',
    );
  }
  try {
    git(['rev-parse', '--verify', branchName]);
    console.log(`[Dispatcher] Branch already exists: ${branchName}`);
  } catch {
    git(['checkout', '-b', branchName, baseBranch]);
    git(['checkout', baseBranch]);
    console.log(`[Dispatcher] Created branch: ${branchName} from ${baseBranch}`);
  }
}

/**
 * Capture the lint baseline on the Epic branch.
 * Uses the `lintBaselineCommand` from config, writing to `lintBaselinePath`.
 *
 * @param {string} epicBranch
 * @param {object} settings
 */
function captureLintBaseline(epicBranch, settings) {
  const lintBaselinePath = settings.lintBaselinePath ?? 'temp/lint-baseline.json';
  const absPath = path.resolve(PROJECT_ROOT, lintBaselinePath);

  if (fs.existsSync(absPath)) {
    console.log(`[Dispatcher] Lint baseline already exists, skipping capture.`);
    return;
  }

  console.log(`[Dispatcher] Capturing lint baseline on ${epicBranch}...`);
  try {
    execFileSync('node', [path.join(PROJECT_ROOT, '.agents/scripts/lint-baseline.js'), 'capture'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: false,
    });
  } catch (err) {
    console.warn(`[Dispatcher] Lint baseline capture failed (non-fatal): ${err.message}`);
  }
}


// ---------------------------------------------------------------------------
// Model resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve the model to use for a given task.
 * Priority: ticket metadata → bookend config → global default.
 *
 * @param {string} ticketModel - Model from ticket metadata (may be empty).
 * @param {object} settings - agentSettings from config.
 * @returns {string}
 */
function resolveModel(ticketModel, settings) {
  if (ticketModel) return ticketModel;
  return (
    settings.defaultModels?.fastFallback ||
    'Gemini 3 Flash'
  );
}

// ---------------------------------------------------------------------------
// Core dispatcher logic
// ---------------------------------------------------------------------------

/**
 * Fetch all Task-level tickets under an Epic, returning a normalised array.
 *
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @returns {Promise<object[]>}
 */
async function fetchTasks(provider, epicId) {
  const tickets = await provider.getTickets(epicId, { label: TYPE_TASK_LABEL });

  return tickets.map(t => {
    const metadata = parseTaskMetadata(t.body ?? '');
    const blockedBy = parseBlockedBy(t.body ?? '');
    const labels = t.labels ?? [];
    const status = labels.find(l => l.startsWith('agent::')) ?? 'agent::ready';
    const isRiskHigh = labels.includes(RISK_HIGH_LABEL);

    return {
      id: t.id,
      title: t.title,
      labels,
      status,
      isRiskHigh,
      dependsOn: blockedBy,
      body: t.body ?? '',
      ...metadata,
    };
  });
}

/**
 * Main dispatcher function. Orchestrates one dispatch cycle for an Epic.
 *
 * @param {{
 *   epicId: number,
 *   dryRun?: boolean,
 *   executorOverride?: string,
 *   provider?: import('./lib/ITicketingProvider.js').ITicketingProvider,
 *   adapter?: import('./lib/IExecutionAdapter.js').IExecutionAdapter,
 * }} options
 * @returns {Promise<import('./dispatch-manifest.js').DispatchManifest>}
 */
export async function dispatch(options) {
  const { epicId, dryRun = false, executorOverride } = options;

  const { settings, orchestration } = resolveConfig();
  const provider = options.provider ?? createProvider(orchestration);
  const adapter = options.adapter ?? createAdapter(orchestration, {
    executor: executorOverride,
  });

  const baseBranch = settings.baseBranch ?? 'main';
  const epicBranch = `epic/${epicId}`;

  // ── Step 1: Fetch Epic and all Tasks ────────────────────────────────────
  console.log(`\n[Dispatcher] Fetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  console.log(`[Dispatcher] Fetching Tasks under Epic #${epicId}...`);
  const tasks = await fetchTasks(provider, epicId);
  console.log(`[Dispatcher] Found ${tasks.length} task(s).`);

  if (tasks.length === 0) {
    console.log('[Dispatcher] No tasks found. Nothing to dispatch.');
    return buildManifest({ epicId, epic, tasks: [], waves: [], dispatched: [], heldForApproval: [], dryRun, adapter });
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
  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(pseudoManifest, adjacency);
  if (graphMutated) {
    console.log('[Dispatcher] Focus-area conflicts detected; serialized overlapping tasks.');
  }

  // ── Step 4: Compute execution waves ─────────────────────────────────────
  const allWaves = computeWaves(finalAdjacency, taskMap);
  console.log(`[Dispatcher] Computed ${allWaves.length} execution wave(s).`);

  // ── Step 5: Branch creation (skip in dry-run) ────────────────────────────
  if (!dryRun) {
    console.log(`[Dispatcher] Ensuring Epic base branch: ${epicBranch}`);
    ensureBranch(epicBranch, baseBranch);

    captureLintBaseline(epicBranch, settings);

    for (const task of tasks) {
      const taskBranch = `task/epic-${epicId}/${task.id}`;
      ensureBranch(taskBranch, epicBranch);
    }
  } else {
    console.log('[Dispatcher] Dry-run mode: skipping branch creation.');
  }

  // ── Step 6: Determine next wave to dispatch ──────────────────────────────
  // Skip tasks already done or executing. Find the first wave with work to do.
  const dispatched = [];
  const heldForApproval = [];

  for (const wave of allWaves) {
    const eligible = wave.filter(
      t => t.status !== AGENT_DONE_LABEL && t.status !== AGENT_EXECUTING_LABEL,
    );

    if (eligible.length === 0) {
      console.log('[Dispatcher] Wave fully complete, moving to next...');
      continue;
    }

    // Check that all dependencies of this wave are done
    const waveDepsComplete = eligible.every(task =>
      task.dependsOn.every(depId => {
        const dep = taskMap.get(depId);
        return dep?.status === AGENT_DONE_LABEL;
      }),
    );

    if (!waveDepsComplete) {
      console.log('[Dispatcher] Wave dependencies not yet complete. Halting.');
      break;
    }

    // Dispatch this wave
    for (const task of eligible) {
      const taskBranch = `task/epic-${epicId}/${task.id}`;
      const resolvedModel = resolveModel(task.model, settings);

      // Hold risk::high tasks for HITL approval
      if (task.isRiskHigh) {
        console.log(`[Dispatcher] ⚠️  Task #${task.id} flagged risk::high — held for approval.`);
        heldForApproval.push({ taskId: task.id, reason: 'risk::high label requires operator approval.' });

        if (!dryRun) {
          await provider.postComment(task.id, {
            body: `⚠️ **HITL Gate**: This task is flagged \`risk::high\` and requires operator approval before dispatch.\n\nTo approve, reply with: \`/approve ${task.id}\``,
            type: 'notification',
          });
        }
        continue;
      }

      const hydratedPrompt = await hydrateContext(task, provider, epicBranch, taskBranch, epicId);

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
        console.log(`[Dispatcher] [DRY-RUN] Would dispatch Task #${task.id}: ${task.title}`);
        dispatched.push({ taskId: task.id, dispatchId: `dry-run-${task.id}`, status: 'dispatched' });
      } else {
        // Transition ticket to agent::executing
        await provider.updateTicket(task.id, {
          labels: { add: [AGENT_EXECUTING_LABEL], remove: [AGENT_READY_LABEL] },
        });

        const result = await adapter.dispatchTask(taskDispatch);
        dispatched.push({ taskId: task.id, ...result });
        console.log(`[Dispatcher] ✅ Dispatched Task #${task.id} — dispatchId: ${result.dispatchId}`);
      }
    }

    // Only dispatch one wave per invocation
    break;
  }

  // ── Step 7: Build and emit manifest ─────────────────────────────────────
  const manifest = buildManifest({
    epicId,
    epic,
    tasks,
    waves: allWaves,
    dispatched,
    heldForApproval,
    dryRun,
    adapter,
  });

  // ── Step 8: Epic completion detection ────────────────────────────────────
  await detectEpicCompletion({ epicId, epic, tasks, manifest, provider, settings, dryRun });

  return manifest;
}

/**
 * Detect whether all Tasks in the Epic have reached agent::done.
 * If so, post a summary comment on the Epic issue and fire the
 * epic-complete webhook via notify.js (INFO level — no operator action required).
 *
 * @param {object} params
 */
async function detectEpicCompletion({ epicId, epic, tasks, manifest, provider, settings, dryRun }) {
  if (tasks.length === 0) return;

  const allDone = tasks.every(t => t.status === AGENT_DONE_LABEL);
  if (!allDone) return;

  console.log(`[Dispatcher] 🎉 All Tasks under Epic #${epicId} are agent::done. Starting Bookend Lifecycle.`);

  if (dryRun) {
    console.log('[Dispatcher] [DRY-RUN] Would post epic-complete comment and fire webhook.');
    return;
  }

  // Build a summary of completed tasks
  const taskLines = tasks
    .map(t => `- ✅ #${t.id}: ${t.title}`)
    .join('\n');

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
    console.log(`[Dispatcher] Posted epic-complete summary comment on Epic #${epicId}.`);
  } catch (err) {
    console.warn(`[Dispatcher] Failed to post epic-complete comment: ${err.message}`);
  }

  // Fire the epic-complete webhook (INFO — no action required)
  if (settings.notificationWebhookUrl) {
    try {
      await notify(epicId, {
        type: 'notification',
        message: `Epic #${epicId} complete. All tasks done. Bookend Lifecycle starting.`,
      }, { orchestration: { github: { operatorHandle: '' }, notifications: { webhookUrl: settings.notificationWebhookUrl } } });
    } catch (err) {
      console.warn(`[Dispatcher] Webhook notification failed (non-fatal): ${err.message}`);
    }
  }
}

/**
 * Build a Dispatch Manifest object conforming to dispatch-manifest.json schema.
 *
 * @param {object} params
 * @returns {object}
 */
function buildManifest({ epicId, epic, tasks, waves, dispatched, heldForApproval, dryRun, adapter }) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === AGENT_DONE_LABEL).length;
  const progress = totalTasks > 0
    ? Math.round((doneTasks / totalTasks) * 100)
    : 0;

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    epicId,
    epicTitle: epic?.title ?? '',
    executor: adapter.executorId,
    dryRun,
    summary: {
      totalTasks,
      doneTasks,
      progressPercent: progress,
      totalWaves: waves.length,
      dispatched: dispatched.length,
      heldForApproval: heldForApproval.length,
    },
    waves: waves.map((wave, i) => ({
      waveIndex: i,
      tasks: wave.map(t => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        branch: `task/epic-${epicId}/${t.id}`,
        persona: t.persona,
        model: t.model,
        mode: t.mode,
        skills: t.skills,
        focusAreas: t.focusAreas,
        isRiskHigh: t.isRiskHigh,
        dependsOn: t.dependsOn,
      })),
    })),
    dispatched,
    heldForApproval,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      epic:      { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      executor:  { type: 'string' },
    },
    strict: false,
  });

  const epicId = parseInt(values.epic ?? '', 10);
  if (!values.epic || isNaN(epicId) || epicId <= 0) {
    console.error('Usage: node dispatcher.js --epic <epicId> [--dry-run] [--executor <name>]');
    process.exit(1);
  }

  const dryRun = values['dry-run'] ?? false;
  const executorOverride = values.executor;

  console.log(`[Dispatcher] Starting dispatch for Epic #${epicId}${dryRun ? ' (DRY-RUN)' : ''}...`);

  const manifest = await dispatch({ epicId, dryRun, executorOverride });

  const manifestDir = path.join(PROJECT_ROOT, 'temp');
  if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `dispatch-manifest-${epicId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\n[Dispatcher] ✅ Dispatch manifest written to: temp/dispatch-manifest-${epicId}.json`);
  console.log(`[Dispatcher] Progress: ${manifest.summary.doneTasks}/${manifest.summary.totalTasks} tasks done (${manifest.summary.progressPercent}%)`);
  console.log(`[Dispatcher] Dispatched: ${manifest.summary.dispatched}, Held: ${manifest.summary.heldForApproval}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => {
    console.error('[Dispatcher] Fatal error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
