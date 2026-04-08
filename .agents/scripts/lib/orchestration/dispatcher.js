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
import { hydrateContext } from './context-hydrator.js';
import { createAdapter } from '../adapter-factory.js';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';
import {
  isSafeBranchComponent,
  parseBlockedBy,
  parseTaskMetadata,
} from '../dependency-parser.js';
import {
  autoSerializeOverlaps,
  buildGraph,
  computeStoryWaves,
  computeWaves,
  detectCycle,
} from '../Graph.js';
import {
  getEpicBranch,
  getStoryBranch,
  getTaskBranch,
  gitSync,
} from '../git-utils.js';
import { createProvider } from '../provider-factory.js';
import { notify } from '../../notify.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENT_DONE_LABEL = 'agent::done';
export const AGENT_EXECUTING_LABEL = 'agent::executing';
export const AGENT_READY_LABEL = 'agent::ready';
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
function git(args) {
  return gitSync(PROJECT_ROOT, ...args);
}

/**
 * Ensure a branch exists locally. Creates it from baseBranch if not found.
 *
 * @param {string} branchName
 * @param {string} baseBranch
 */
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
    console.log(`[Dispatcher] Branch already exists: ${branchName}`);
  } catch {
    git(['checkout', '-b', branchName, baseBranch]);
    git(['checkout', baseBranch]);
    console.log(
      `[Dispatcher] Created branch: ${branchName} from ${baseBranch}`,
    );
  }
}

/**
 * Capture the lint baseline on the Epic branch.
 *
 * @param {string} epicBranch
 * @param {object} settings
 */
export function captureLintBaseline(epicBranch, settings) {
  const lintBaselinePath =
    settings.lintBaselinePath ?? 'temp/lint-baseline.json';
  const absPath = path.resolve(PROJECT_ROOT, lintBaselinePath);

  if (fs.existsSync(absPath)) {
    console.log(`[Dispatcher] Lint baseline already exists, skipping capture.`);
    return;
  }

  console.log(`[Dispatcher] Capturing lint baseline on ${epicBranch}...`);
  try {
    execFileSync(
      'node',
      [path.join(PROJECT_ROOT, '.agents/scripts/lint-baseline.js'), 'capture'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: 'inherit',
        shell: false,
      },
    );
  } catch (err) {
    console.warn(
      `[Dispatcher] Lint baseline capture failed (non-fatal): ${err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Model resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the model for a task.
 *
 * @param {string} ticketModel
 * @param {object} settings
 * @returns {string}
 */
export function resolveModel(ticketModel, settings) {
  if (ticketModel) return ticketModel;
  return settings.defaultModels?.fastFallback || 'Gemini 3 Flash';
}

/**
 * Determine model tier from story complexity labels.
 *
 * @param {string[]} storyLabels
 * @returns {'high' | 'fast'}
 */
export function resolveModelTier(storyLabels) {
  if ((storyLabels ?? []).includes('complexity::high')) return 'high';
  return 'fast';
}

/**
 * Map a model tier to a concrete model name from agentSettings.
 *
 * @param {'high' | 'fast'} tier
 * @param {object} settings
 * @returns {string}
 */
export function resolveRecommendedModel(tier, settings) {
  const models = settings.defaultModels ?? {};
  const raw =
    tier === 'high'
      ? models.planningFallback || 'Gemini 3.1 Pro (High)'
      : models.fastFallback || 'Gemini 3 Flash';
  return raw.split(' OR ')[0].trim();
}

// ---------------------------------------------------------------------------
// Story grouping
// ---------------------------------------------------------------------------

/**
 * Parse the direct parent ID from a ticket body.
 *
 * @param {string} body
 * @returns {number|null}
 */
export function parseParentId(body) {
  const match = (body ?? '').match(/^parent:\s*#(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Group tasks by their parent Story.
 *
 * @param {object[]} tasks
 * @param {object[]} allTickets
 * @param {number}   _epicId
 * @returns {Map}
 */
export function groupTasksByStory(tasks, allTickets, _epicId) {
  const ticketById = new Map(allTickets.map((t) => [t.id, t]));
  const groups = new Map();

  for (const task of tasks) {
    const parentId = parseParentId(task.body);
    const parentTicket = parentId != null ? ticketById.get(parentId) : null;
    const isStory =
      parentTicket && (parentTicket.labels ?? []).includes('type::story');
    const key = isStory ? parentId : '__ungrouped__';

    if (!groups.has(key)) {
      groups.set(key, {
        storyId: key,
        storyTitle: isStory ? parentTicket.title : '(Ungrouped Tasks)',
        storyLabels: isStory ? (parentTicket.labels ?? []) : [],
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Branch resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the branch name for a task, preferring its parent Story branch.
 *
 * @param {object} task
 * @param {Map<number, object>} allTicketsById
 * @param {number} epicId
 * @returns {string}
 */
export function getResolvedBranch(task, allTicketsById, epicId) {
  const parentMatch = task.body?.match(/parent:\s*#(\d+)/i);
  if (parentMatch) {
    const parentId = parseInt(parentMatch[1], 10);
    const parentTicket = allTicketsById.get(parentId);
    if (parentTicket && (parentTicket.labels ?? []).includes('type::story')) {
      return getStoryBranch(epicId, parentTicket.title);
    }
  }
  return getTaskBranch(epicId, task.id);
}

// ---------------------------------------------------------------------------
// Task fetching
// ---------------------------------------------------------------------------

/**
 * Fetch all Task-level tickets under an Epic, normalised for the dispatcher.
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @returns {Promise<object[]>}
 */
export async function fetchTasks(provider, epicId) {
  const tickets = await provider.getTickets(epicId, { label: TYPE_TASK_LABEL });

  return tickets.map((t) => {
    const metadata = parseTaskMetadata(t.body ?? '');
    const blockedBy = parseBlockedBy(t.body ?? '');
    const labels = t.labels ?? [];

    const status =
      t.state === 'closed'
        ? AGENT_DONE_LABEL
        : (labels.find((l) => l.startsWith('agent::')) ?? 'agent::ready');

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

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile closed GitHub issues that still have stale agent:: labels.
 *
 * @param {object[]} tasks
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {boolean} dryRun
 */
export async function reconcileClosedTasks(tasks, provider, dryRun) {
  const ALL_AGENT_STATES = [
    'agent::ready',
    'agent::executing',
    'agent::review',
    'agent::done',
  ];

  for (const task of tasks) {
    if (task.status !== AGENT_DONE_LABEL) continue;
    if (task.labels.includes(AGENT_DONE_LABEL)) continue;

    console.log(
      `[Dispatcher] Reconciling closed issue #${task.id} "${task.title}" → agent::done`,
    );

    if (dryRun) {
      console.log(
        `[Dispatcher] [DRY-RUN] Would sync labels and close issue #${task.id}`,
      );
      continue;
    }

    try {
      await provider.updateTicket(task.id, {
        labels: {
          add: [AGENT_DONE_LABEL],
          remove: ALL_AGENT_STATES.filter((s) => s !== AGENT_DONE_LABEL),
        },
        state: 'closed',
        state_reason: 'completed',
      });
      console.log(`[Dispatcher] ✅ Synced #${task.id} to agent::done`);
    } catch (err) {
      console.warn(
        `[Dispatcher] Failed to reconcile #${task.id}: ${err.message}`,
      );
    }
  }
}

/**
 * Reconcile the full ticket hierarchy bottom-up (Tasks → Stories → Features → Epic).
 *
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @param {object} epic
 * @param {object[]} tasks
 * @param {boolean} dryRun
 */
export async function reconcileHierarchy(
  provider,
  epicId,
  epic,
  tasks,
  dryRun,
) {
  const allTickets = await provider.getTickets(epicId);
  const ticketMap = new Map(allTickets.map((t) => [t.id, t]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const childrenOf = new Map();
  for (const ticket of allTickets) {
    const parentId = parseParentId(ticket.body);
    if (parentId != null) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(ticket.id);
    }
  }

  function isDone(ticketId) {
    if (taskById.has(ticketId)) {
      return taskById.get(ticketId).status === AGENT_DONE_LABEL;
    }
    const t = ticketMap.get(ticketId);
    if (!t) return false;
    return t.state === 'closed' || (t.labels ?? []).includes(AGENT_DONE_LABEL);
  }

  async function maybeClose(id, typeName) {
    const ticket = ticketMap.get(id);
    if (!ticket || ticket.state === 'closed') return;
    const children = childrenOf.get(id) ?? [];
    if (children.length === 0) return;
    if (!children.every((cid) => isDone(cid))) return;

    console.log(
      `[Dispatcher] All children of ${typeName} #${id} "${ticket.title}" are done. Closing...`,
    );

    if (dryRun) {
      console.log(
        `[Dispatcher] [DRY-RUN] Would close ${typeName} #${id} and set agent::done.`,
      );
      ticket.state = 'closed';
      return;
    }

    try {
      await provider.updateTicket(id, {
        labels: {
          add: [AGENT_DONE_LABEL],
          remove: ['agent::ready', 'agent::executing', 'agent::review'],
        },
        state: 'closed',
        state_reason: 'completed',
      });
      ticket.state = 'closed';
      console.log(
        `[Dispatcher] ✅ ${typeName} #${id} closed and marked agent::done.`,
      );
    } catch (err) {
      console.warn(
        `[Dispatcher] Failed to close ${typeName} #${id}: ${err.message}`,
      );
    }
  }

  const storyIds = allTickets
    .filter((t) => (t.labels ?? []).includes('type::story'))
    .map((t) => t.id);
  const featureIds = allTickets
    .filter((t) => (t.labels ?? []).includes('type::feature'))
    .map((t) => t.id);

  for (const id of storyIds) await maybeClose(id, 'Story');
  for (const id of featureIds) await maybeClose(id, 'Feature');

  const epicChildren = childrenOf.get(epicId) ?? [];
  if (epicChildren.length > 0 && epicChildren.every((cid) => isDone(cid))) {
    if (
      epic.state !== 'closed' ||
      !(epic.labels ?? []).includes(AGENT_DONE_LABEL)
    ) {
      console.log(
        `[Dispatcher] All children of Epic #${epicId} are done. Closing Epic...`,
      );

      if (dryRun) {
        console.log(
          `[Dispatcher] [DRY-RUN] Would close Epic #${epicId} and set agent::done.`,
        );
        return;
      }

      try {
        await provider.updateTicket(epicId, {
          labels: {
            add: [AGENT_DONE_LABEL],
            remove: ['agent::ready', 'agent::executing', 'agent::review'],
          },
          state: 'closed',
          state_reason: 'completed',
        });
        console.log(
          `[Dispatcher] ✅ Epic #${epicId} closed and marked agent::done.`,
        );
      } catch (err) {
        console.warn(
          `[Dispatcher] Failed to close Epic #${epicId}: ${err.message}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Manifest builders
// ---------------------------------------------------------------------------

/**
 * Build the story-centric manifest array.
 *
 * @param {object[]} tasks
 * @param {object[]} allTickets
 * @param {number}   epicId
 * @param {object}   settings
 * @returns {object[]}
 */
export function buildStoryManifest(tasks, allTickets, epicId, settings) {
  const groups = groupTasksByStory(tasks, allTickets, epicId);

  // Parse explicit story-to-story dependencies from `blocked by` on story
  // ticket bodies. This captures dependencies declared at the story level
  // (e.g., Story #130 body contains `blocked by #129`) which the task-level
  // cross-story analysis would miss.
  const ticketById = new Map(allTickets.map((t) => [t.id, t]));
  const explicitStoryDeps = new Map();
  for (const [storyId, _group] of groups.entries()) {
    if (storyId === '__ungrouped__') continue;
    const storyTicket = ticketById.get(storyId);
    if (!storyTicket) continue;
    const blockers = parseBlockedBy(storyTicket.body ?? '');
    if (blockers.length > 0) {
      // Only include blockers that are actually other stories in this Epic
      const validBlockers = blockers.filter(
        (id) => id !== storyId && groups.has(id),
      );
      if (validBlockers.length > 0) {
        explicitStoryDeps.set(storyId, validBlockers);
      }
    }
  }

  const storyWaves = computeStoryWaves(groups, explicitStoryDeps);

  return [...groups.values()].map((group) => {
    const modelTier = resolveModelTier(group.storyLabels);
    const recommendedModel = resolveRecommendedModel(modelTier, settings);
    const earliestWave = storyWaves.get(group.storyId) ?? -1;

    const slug =
      group.storyId === '__ungrouped__'
        ? 'ungrouped'
        : group.storyTitle
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

    const branchName =
      group.storyId === '__ungrouped__'
        ? getTaskBranch(epicId, 'ungrouped')
        : getStoryBranch(epicId, group.storyTitle);

    return {
      storyId: group.storyId,
      storySlug: slug,
      branchName,
      model_tier: modelTier,
      recommendedModel,
      earliestWave,
      tasks: group.tasks.map((t) => ({
        taskId: t.id,
        taskSlug: t.title
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, ''),
        parentSlug: slug,
        dependencies: t.dependsOn ?? [],
      })),
    };
  });
}

/**
 * Build the full Dispatch Manifest object.
 *
 * @param {object} params
 * @returns {object}
 */
export function buildManifest({
  epicId,
  epic,
  tasks,
  allTickets,
  waves,
  dispatched,
  heldForApproval,
  dryRun,
  adapter,
  settings,
}) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === AGENT_DONE_LABEL).length;
  const progress =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const allTicketsById = new Map((allTickets ?? []).map((t) => [t.id, t]));

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
      tasks: wave.map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        branch: getResolvedBranch(t, allTicketsById ?? new Map(), epicId),
        persona: t.persona,
        model: t.model,
        mode: t.mode,
        skills: t.skills,
        focusAreas: t.focusAreas,
        isRiskHigh: t.isRiskHigh,
        dependsOn: t.dependsOn,
      })),
    })),
    storyManifest: buildStoryManifest(
      tasks,
      allTickets ?? [],
      epicId,
      settings,
    ),
    dispatched,
    heldForApproval,
  };
}

// ---------------------------------------------------------------------------
// Epic completion detection
// ---------------------------------------------------------------------------

/**
 * Detect Epic completion and fire the bookend lifecycle.
 *
 * @param {object} params
 */
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

  console.log(
    `[Dispatcher] 🎉 All Tasks under Epic #${epicId} are agent::done. Starting Bookend Lifecycle.`,
  );

  if (dryRun) {
    console.log(
      '[Dispatcher] [DRY-RUN] Would post epic-complete comment and fire webhook.',
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
    console.log(
      `[Dispatcher] Posted epic-complete summary comment on Epic #${epicId}.`,
    );
  } catch (err) {
    console.warn(
      `[Dispatcher] Failed to post epic-complete comment: ${err.message}`,
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
      console.warn(
        `[Dispatcher] Webhook notification failed (non-fatal): ${err.message}`,
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

  // ── Step 1: Fetch Epic and all Tasks ────────────────────────────────────
  console.log(`\n[Dispatcher] Fetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  console.log(`[Dispatcher] Fetching Tasks under Epic #${epicId}...`);
  const tasks = await fetchTasks(provider, epicId);
  console.log(`[Dispatcher] Found ${tasks.length} task(s).`);

  // ── Step 1b: Reconcile stale labels on merged tasks ──────────────────────
  await reconcileClosedTasks(tasks, provider, dryRun);

  // ── Step 1c: Propagate completion up the full hierarchy ──────────────────
  await reconcileHierarchy(provider, epicId, epic, tasks, dryRun);

  if (tasks.length === 0) {
    console.log('[Dispatcher] No tasks found. Nothing to dispatch.');
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
    console.log(
      '[Dispatcher] Focus-area conflicts detected; serialized overlapping tasks.',
    );
  }

  // ── Step 4: Compute execution waves ─────────────────────────────────────
  const allWaves = computeWaves(finalAdjacency, taskMap);
  console.log(`[Dispatcher] Computed ${allWaves.length} execution wave(s).`);

  // ── Step 5: Epic branch creation (skip in dry-run) ─────────────────────────
  if (!dryRun) {
    console.log(`[Dispatcher] Ensuring Epic base branch: ${epicBranch}`);
    ensureBranch(epicBranch, baseBranch);
    captureLintBaseline(epicBranch, settings);
  } else {
    console.log('[Dispatcher] Dry-run mode: skipping branch creation.');
  }

  // ── Step 6: Determine next wave to dispatch ──────────────────────────────
  const dispatched = [];
  const heldForApproval = [];

  const allTickets = await provider.getTickets(epicId);
  const allTicketsById = new Map(allTickets.map((t) => [t.id, t]));

  for (const wave of allWaves) {
    const eligible = wave.filter(
      (t) =>
        t.status !== AGENT_DONE_LABEL && t.status !== AGENT_EXECUTING_LABEL,
    );

    if (eligible.length === 0) {
      console.log('[Dispatcher] Wave fully complete, moving to next...');
      continue;
    }

    const waveDepsComplete = eligible.every((task) =>
      task.dependsOn.every((depId) => {
        const dep = taskMap.get(depId);
        return dep?.status === AGENT_DONE_LABEL;
      }),
    );

    if (!waveDepsComplete) {
      console.log('[Dispatcher] Wave dependencies not yet complete. Halting.');
      break;
    }

    for (const task of eligible) {
      const taskBranch = getResolvedBranch(task, allTicketsById, epicId);
      const resolvedModel = resolveModel(task.model, settings);

      if (task.isRiskHigh) {
        console.log(
          `[Dispatcher] ⚠️  Task #${task.id} flagged risk::high — held for approval.`,
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
        console.log(
          `[Dispatcher] [DRY-RUN] Would dispatch Task #${task.id}: ${task.title}`,
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
        console.log(
          `[Dispatcher] ✅ Dispatched Task #${task.id} — dispatchId: ${result.dispatchId}`,
        );
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
    allTickets,
    waves: allWaves,
    dispatched,
    heldForApproval,
    dryRun,
    adapter,
    settings,
  });

  // ── Step 8: Epic completion detection ────────────────────────────────────
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
