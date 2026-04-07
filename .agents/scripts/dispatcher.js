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

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hydrateContext } from './context-hydrator.js';
import { createAdapter } from './lib/adapter-factory.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import {
  isSafeBranchComponent,
  parseBlockedBy,
  parseTaskMetadata,
} from './lib/dependency-parser.js';
import {
  autoSerializeOverlaps,
  buildGraph,
  computeWaves,
  detectCycle,
} from './lib/Graph.js';
import {
  getEpicBranch,
  getStoryBranch,
  getTaskBranch,
  gitSync,
} from './lib/git-utils.js';
import { createProvider } from './lib/provider-factory.js';
import { notify } from './notify.js';

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
 * Uses the `lintBaselineCommand` from config, writing to `lintBaselinePath`.
 *
 * @param {string} epicBranch
 * @param {object} settings
 */
function captureLintBaseline(epicBranch, settings) {
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
  return settings.defaultModels?.fastFallback || 'Gemini 3 Flash';
}

// ---------------------------------------------------------------------------
// Story-level grouping helpers
// ---------------------------------------------------------------------------

/**
 * Determine model tier for a story based on its complexity:: label.
 * Falls back to 'fast' if no complexity label is present.
 *
 * @param {string[]} storyLabels - Labels from the story ticket.
 * @returns {'high' | 'fast'}
 */
function resolveModelTier(storyLabels) {
  if ((storyLabels ?? []).includes('complexity::high')) return 'high';
  return 'fast';
}

/**
 * Map a model_tier string to a concrete model name from agentSettings.
 * Uses the first entry if the config value contains " OR ".
 *
 * @param {'high' | 'fast'} tier
 * @param {object} settings - agentSettings from config.
 * @returns {string}
 */
function resolveRecommendedModel(tier, settings) {
  const models = settings.defaultModels ?? {};
  const raw =
    tier === 'high'
      ? models.planningFallback || 'Gemini 3.1 Pro (High)'
      : models.fastFallback || 'Gemini 3 Flash';
  // Pick the first option if config contains " OR "
  return raw.split(' OR ')[0].trim();
}

/**
 * Print a human-readable Story Dispatch Table to stdout.
 * Shows story ID, title, model tier, recommended model, and branch.
 *
 * @param {object[]} storyManifest - Array of StoryDispatch objects.
 */
function printStoryDispatchTable(storyManifest) {
  if (!storyManifest || storyManifest.length === 0) return;

  console.log(
    '\n┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐',
  );
  console.log(
    '│                                            📋 STORY DISPATCH TABLE                                                   │',
  );
  console.log(
    '├─────────┬──────────────────────────────────────┬──────┬────────────┬──────────────────────────────┬──────────────┤',
  );
  console.log(
    '│ Story   │ Title                                │ Wave │ Model Tier │ Recommended Model            │ Tasks        │',
  );
  console.log(
    '├─────────┼──────────────────────────────────────┼──────┼────────────┼──────────────────────────────┼──────────────┤',
  );

  for (const story of storyManifest) {
    const id =
      story.storyId === '__ungrouped__' ? '(none)' : `#${story.storyId}`;
    const title = (story.storySlug ?? '').substring(0, 36).padEnd(36);
    const wave = (
      story.earliestWave === -1 ? '-' : String(story.earliestWave)
    ).padEnd(4);
    const tier = (story.model_tier ?? '').padEnd(10);
    const model = (story.recommendedModel ?? '').substring(0, 28).padEnd(28);
    const taskCount = `${story.tasks.length} task(s)`.padEnd(12);
    console.log(
      `│ ${id.padEnd(7)} │ ${title} │ ${wave} │ ${tier} │ ${model} │ ${taskCount} │`,
    );
  }

  console.log(
    '└─────────┴──────────────────────────────────────┴──────┴────────────┴──────────────────────────────┴──────────────┘',
  );
  console.log('');
  console.log('  💡 Stories in the same [Wave] can be executed in parallel.');
  console.log(
    '  💡 Use /sprint-execute #[Story ID] to execute a Story. Select the model shown above.',
  );
  console.log('');
}

/**
 * Group a flat task list by their parent Story.
 *
 * Reads the `parent: #N` body convention written by createTicket.
 * Tasks whose parent cannot be resolved (no body match, or parent is not
 * a Story) are grouped under a synthetic '__ungrouped__' story.
 *
 * @param {object[]} tasks          - Normalised tasks from fetchTasks.
 * @param {object[]} allTickets     - All raw tickets under the epic (inc. stories).
 * @param {number}   epicId
 * @returns {Map<number|'__ungrouped__', {
 *   storyId: number|'__ungrouped__',
 *   storyTitle: string,
 *   storyLabels: string[],
 *   tasks: object[],
 * }>}
 */
function groupTasksByStory(tasks, allTickets, _epicId) {
  // Build a lookup of raw tickets by ID
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

  return tickets.map((t) => {
    const metadata = parseTaskMetadata(t.body ?? '');
    const blockedBy = parseBlockedBy(t.body ?? '');
    const labels = t.labels ?? [];

    // A closed GitHub issue means the PR was merged — treat as agent::done
    // regardless of label state. The reconcileClosedTasks step (called right
    // after this) will sync the labels and state on GitHub to match.
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

/**
 * Reconcile any closed GitHub issues that still carry stale agent:: labels.
 *
 * When an operator manually merges a PR, GitHub closes the referenced issue
 * but does NOT update the agent:: label. This function detects that mismatch
 * and syncs GitHub to the correct state:
 *   - Removes all other agent:: labels
 *   - Adds agent::done
 *   - Marks the issue state as closed / completed (idempotent)
 *
 * Safe to call in dry-run mode — skips writes when dryRun=true.
 *
 * @param {object[]} tasks - Normalised task list from fetchTasks.
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 * @param {boolean} dryRun
 */
async function reconcileClosedTasks(tasks, provider, dryRun) {
  const ALL_AGENT_STATES = [
    'agent::ready',
    'agent::executing',
    'agent::review',
    'agent::done',
  ];

  for (const task of tasks) {
    // Only act on tasks that the closed-issue heuristic marked as done
    // but whose labels haven't been updated yet.
    if (task.status !== AGENT_DONE_LABEL) continue;
    if (task.labels.includes(AGENT_DONE_LABEL)) continue; // already in sync

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
 * Parse the direct parent ID from a ticket body.
 * Looks for the convention written by createTicket: "parent: #N"
 *
 * @param {string} body
 * @returns {number|null}
 */
function parseParentId(body) {
  const match = (body ?? '').match(/^parent:\s*#(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Reconcile the full ticket hierarchy bottom-up.
 *
 * GitHub native sub-issues track Epic→Feature→Story→Task. After tasks are
 * merged and reconciled to agent::done, this function propagates completion
 * upward:
 *   - Story  closes when ALL its Tasks  are closed/agent::done
 *   - Feature closes when ALL its Stories are closed/agent::done
 *   - Epic   closes when ALL its Features are closed/agent::done
 *
 * Uses the `parent: #N` body convention (written by createTicket) to map
 * children to parents. Falls back to the Epic itself for any ticket whose
 * parent cannot be resolved.
 *
 * Safe to call in dry-run mode — logs intended actions without writing.
 *
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 * @param {number} epicId
 * @param {object} epic  - Epic ticket (from getEpic)
 * @param {object[]} tasks - Normalised task objects (from fetchTasks)
 * @param {boolean} dryRun
 */
async function reconcileHierarchy(provider, epicId, epic, tasks, dryRun) {
  // Fetch every non-task ticket under the epic (features + stories)
  // getTickets returns ALL tickets referencing the epic in their body.
  const allTickets = await provider.getTickets(epicId);

  // Build a lookup: ticketId → raw ticket
  const ticketMap = new Map(allTickets.map((t) => [t.id, t]));

  // Add the normalised task objects (already fetched) so we have the full set.
  // Tasks carry status resolved from closed-state heuristic; use that.
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Build parent → [childIds] map from body references.
  const childrenOf = new Map();
  for (const ticket of allTickets) {
    const parentId = parseParentId(ticket.body);
    if (parentId != null) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(ticket.id);
    }
  }

  /**
   * Returns true if a ticket is considered fully done:
   * - Its GitHub state is 'closed', OR
   * - It carries the agent::done label.
   */
  function isDone(ticketId) {
    // Tasks: use the reconciled status from fetchTasks
    if (taskById.has(ticketId)) {
      return taskById.get(ticketId).status === AGENT_DONE_LABEL;
    }
    // Features / Stories: use raw GitHub state + label
    const t = ticketMap.get(ticketId);
    if (!t) return false;
    return t.state === 'closed' || (t.labels ?? []).includes(AGENT_DONE_LABEL);
  }

  /**
   * Close a non-task parent ticket if all its children are done.
   * Does nothing if the ticket is already closed.
   *
   * @param {number} id  - Issue number of the parent to evaluate
   * @param {string} typeName - Human label for log messages (e.g. 'Story')
   */
  async function maybeClose(id, typeName) {
    const ticket = ticketMap.get(id);
    // Skip if already closed
    if (!ticket || ticket.state === 'closed') return;

    const children = childrenOf.get(id) ?? [];
    if (children.length === 0) return; // no children tracked — skip

    const allDone = children.every((cid) => isDone(cid));
    if (!allDone) return;

    console.log(
      `[Dispatcher] All children of ${typeName} #${id} "${ticket.title}" are done. Closing...`,
    );

    if (dryRun) {
      console.log(
        `[Dispatcher] [DRY-RUN] Would close ${typeName} #${id} and set agent::done.`,
      );
      // Mark as done in our local map so parent-level checks work in dry-run
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
      ticket.state = 'closed'; // update local cache so parent checks see it
      console.log(
        `[Dispatcher] ✅ ${typeName} #${id} closed and marked agent::done.`,
      );
    } catch (err) {
      console.warn(
        `[Dispatcher] Failed to close ${typeName} #${id}: ${err.message}`,
      );
    }
  }

  // ── Process bottom-up: Stories → Features → Epic ──────────────────────────

  // Collect IDs by type
  const storyIds = allTickets
    .filter((t) => (t.labels ?? []).includes('type::story'))
    .map((t) => t.id);
  const featureIds = allTickets
    .filter((t) => (t.labels ?? []).includes('type::feature'))
    .map((t) => t.id);

  // 1. Close completed Stories
  for (const id of storyIds) {
    await maybeClose(id, 'Story');
  }

  // 2. Close completed Features
  for (const id of featureIds) {
    await maybeClose(id, 'Feature');
  }

  // 3. Close Epic if all Features (or top-level children) are done
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
  const adapter =
    options.adapter ??
    createAdapter(orchestration, {
      executor: executorOverride,
    });

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

  // ── Step 1c: Propagate completion up the full hierarchy (Story→Feature→Epic) ─
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
  // Task branches are created just-in-time during dispatch (Step 6), so that
  // only branches for tasks that are actually dispatched in this run exist locally.
  if (!dryRun) {
    console.log(`[Dispatcher] Ensuring Epic base branch: ${epicBranch}`);
    ensureBranch(epicBranch, baseBranch);

    captureLintBaseline(epicBranch, settings);
  } else {
    console.log('[Dispatcher] Dry-run mode: skipping branch creation.');
  }

  // ── Step 6: Determine next wave to dispatch ──────────────────────────────
  // Skip tasks already done or executing. Find the first wave with work to do.
  const dispatched = [];
  const heldForApproval = [];

  // Fetch all tickets once so story labels are available in the wave loop
  // without issuing a separate HTTP request per dispatched task.
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

    // Check that all dependencies of this wave are done
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

    // Dispatch this wave
    for (const task of eligible) {
      const taskBranch = getResolvedBranch(task, allTicketsById, epicId);
      const resolvedModel = resolveModel(task.model, settings);

      // Hold risk::high tasks for HITL approval
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
        // Create the task branch just-in-time, immediately before dispatch.
        ensureBranch(taskBranch, epicBranch);

        // Transition ticket to agent::executing
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

/**
 * Detect whether all Tasks in the Epic have reached agent::done.
 * If so, post a summary comment on the Epic issue and fire the
 * epic-complete webhook via notify.js (INFO level — no operator action required).
 *
 * @param {object} params
 */
async function detectEpicCompletion({
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

  // Build a summary of completed tasks
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

  // Fire the epic-complete webhook (INFO — no action required)
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

/**
 * Build the story-centric manifest array that conforms to dispatch-manifest.schema.json.
 *
 * @param {object[]} tasks      - Normalised task list.
 * @param {object[]} allTickets - All raw tickets under the epic.
 * @param {number}   epicId
 * @param {object}   settings   - Agent configuration.
 * @param {Map<number, number>} taskToWave - Map of task ID to wave index.
 * @returns {object[]} Array of StoryDispatch objects.
 */
function buildStoryManifest(tasks, allTickets, epicId, settings, taskToWave) {
  const groups = groupTasksByStory(tasks, allTickets, epicId);

  return [...groups.values()].map((group) => {
    const modelTier = resolveModelTier(group.storyLabels);
    const recommendedModel = resolveRecommendedModel(modelTier, settings);

    // Earliest wave any task in this story belongs to.
    const storyWaves = group.tasks
      .map((t) => taskToWave.get(t.id))
      .filter((w) => w !== undefined);
    const earliestWave = storyWaves.length > 0 ? Math.min(...storyWaves) : -1;
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
        ? getTaskBranch(epicId, 'ungrouped') // fallback
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
 * Resolves the branch name for a task, checking if it belongs to a parent story.
 *
 * @param {object} task
 * @param {Map<number, object>} allTicketsById
 * @param {number} epicId
 * @returns {string}
 */
function getResolvedBranch(task, allTicketsById, epicId) {
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

/**
 * Build a Dispatch Manifest object conforming to dispatch-manifest.json schema.
 *
 * @param {object} params
 * @returns {object}
 */
function buildManifest({
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

    // Story-centric manifest conforming to dispatch-manifest.schema.json
    // Groups tasks under their parent story with story branch, model_tier,
    // and recommendedModel resolved from agentSettings.defaultModels.
    storyManifest: (() => {
      const taskToWave = new Map();
      for (const [i, wave] of waves.entries()) {
        for (const t of wave) {
          taskToWave.set(t.id, i);
        }
      }
      return buildStoryManifest(
        tasks,
        allTickets ?? [],
        epicId,
        settings,
        taskToWave,
      );
    })(),
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
      epic: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      executor: { type: 'string' },
    },
    strict: false,
  });

  const epicId = parseInt(values.epic ?? '', 10);
  if (!values.epic || Number.isNaN(epicId) || epicId <= 0) {
    console.error(
      'Usage: node dispatcher.js --epic <epicId> [--dry-run] [--executor <name>]',
    );
    process.exit(1);
  }

  const dryRun = values['dry-run'] ?? false;
  const executorOverride = values.executor;

  console.log(
    `[Dispatcher] Starting dispatch for Epic #${epicId}${dryRun ? ' (DRY-RUN)' : ''}...`,
  );

  const manifest = await dispatch({ epicId, dryRun, executorOverride });

  const manifestDir = path.join(PROJECT_ROOT, 'temp');
  if (!fs.existsSync(manifestDir))
    fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(
    manifestDir,
    `dispatch-manifest-${epicId}.json`,
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(
    `\n[Dispatcher] ✅ Dispatch manifest written to: temp/dispatch-manifest-${epicId}.json`,
  );
  console.log(
    `[Dispatcher] Progress: ${manifest.summary.doneTasks}/${manifest.summary.totalTasks} tasks done (${manifest.summary.progressPercent}%)`,
  );
  console.log(
    `[Dispatcher] Dispatched: ${manifest.summary.dispatched}, Held: ${manifest.summary.heldForApproval}`,
  );

  // Print story-centric dispatch table for operator guidance
  printStoryDispatchTable(manifest.storyManifest);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Dispatcher] Fatal error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
