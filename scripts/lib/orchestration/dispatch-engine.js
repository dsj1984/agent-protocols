/**
 * lib/orchestration/dispatch-engine.js — Core Dispatch Engine (SDK coordinator)
 *
 * Thin facade composing:
 *   - `wave-dispatcher.js`          — wave iteration + per-task dispatch
 *   - `health-check-service.js`     — Sprint Health issue ensure
 *   - `epic-lifecycle-detector.js`  — epic-completion + bookend fire
 *   - `dispatch-pipeline.js`        — internal resolve/fetch/reconcile/graph/scaffold/GC helpers
 *
 * Consumers (dispatcher.js, mcp-orchestration.js, tests) import the same
 * public symbols from this path as before — the split is an internal code
 * re-organisation only.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import { ensureLocalBranch } from '../git-branch-lifecycle.js';
import { TYPE_LABELS } from '../label-constants.js';
import { createProvider } from '../provider-factory.js';
import { vlog } from './dispatch-logger.js';
import {
  buildDispatchGraph,
  ensureEpicScaffolding,
  fetchEpicContext,
  reconcileEpicState,
  resolveDispatchContext,
  runWorktreeGc,
} from './dispatch-pipeline.js';
import { detectEpicCompletion } from './epic-lifecycle-detector.js';
import { buildManifest } from './manifest-builder.js';
import { executeStory } from './story-executor.js';
import { fetchTelemetry } from './telemetry.js';
import { STATE_LABELS } from './ticketing.js';
import { collectOpenStoryIds, dispatchNextWave } from './wave-dispatcher.js';

export const AGENT_DONE_LABEL = STATE_LABELS.DONE;
export const AGENT_EXECUTING_LABEL = STATE_LABELS.EXECUTING;
export const AGENT_READY_LABEL = STATE_LABELS.READY;
export const TYPE_TASK_LABEL = TYPE_LABELS.TASK;
export { collectOpenStoryIds, detectEpicCompletion };

/* node:coverage ignore next */
export function ensureBranch(branchName, baseBranch) {
  ensureLocalBranch(branchName, baseBranch, PROJECT_ROOT, {
    log: (msg) => vlog.info('orchestration', msg),
  });
}

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

/**
 * Resolve a single ticket ID, detect its type, and delegate to the
 * appropriate execution pipeline. Single entry point shared by the CLI
 * wrapper and the MCP `dispatch_wave` tool.
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

/**
 * Main dispatcher. Orchestrates one dispatch cycle for an Epic.
 * Primary public export of the orchestration SDK.
 */
export async function dispatch(options) {
  const ctx = resolveDispatchContext(options, ensureBranch);
  const { epicId, dryRun, adapter, provider } = ctx;

  const fetched = await fetchEpicContext(ctx);
  await reconcileEpicState(ctx, fetched);

  if (fetched.tasks.length === 0) {
    vlog.info('orchestration', 'No tasks found. Nothing to dispatch.');
    return buildManifest({
      epicId,
      epic: fetched.epic,
      tasks: [],
      allTickets: [],
      waves: [],
      dispatched: [],
      heldForApproval: [],
      dryRun,
      adapter,
    });
  }

  const { allWaves, taskMap } = buildDispatchGraph(fetched.tasks);
  ensureEpicScaffolding(ctx, captureLintBaseline);
  await runWorktreeGc(ctx, fetched);

  const { dispatched, heldForApproval } = await dispatchNextWave(
    ctx,
    fetched,
    allWaves,
    taskMap,
  );

  const agentTelemetry = await fetchTelemetry(provider, fetched.tasks);
  const manifest = buildManifest({
    epicId,
    epic: fetched.epic,
    tasks: fetched.tasks,
    allTickets: fetched.allTickets,
    waves: allWaves,
    dispatched,
    heldForApproval,
    dryRun,
    adapter,
    agentTelemetry,
  });

  await detectEpicCompletion({
    epicId,
    epic: fetched.epic,
    tasks: fetched.tasks,
    manifest,
    provider,
    dryRun,
  });

  return manifest;
}
