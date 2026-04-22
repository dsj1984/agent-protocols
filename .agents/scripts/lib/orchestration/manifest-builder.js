/**
 * lib/orchestration/manifest-builder.js — Manifest Building Logic
 */

import { parseBlockedBy } from '../dependency-parser.js';
import { getStoryBranch, getTaskBranch, slugify } from '../git-utils.js';
import { computeStoryWaves } from './dependency-analyzer.js';
import { resolveModelTier } from './model-resolver.js';
import { groupTasksByStory } from './story-grouper.js';
import { STATE_LABELS } from './ticketing.js';

const AGENT_DONE_LABEL = STATE_LABELS.DONE;

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
    const parentId = Number.parseInt(parentMatch[1], 10);
    const parentTicket = allTicketsById.get(parentId);
    if (parentTicket?.labels.includes('type::story')) {
      return getStoryBranch(epicId, parentId);
    }
  }
  return getTaskBranch(epicId, task.id);
}

/**
 * Build the story-centric manifest array.
 *
 * @param {object[]} tasks
 * @param {object[]} allTickets
 * @param {number}   epicId
 * @returns {object[]}
 */
function buildStoryManifest(tasks, allTickets, epicId) {
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
    const earliestWave = storyWaves.get(group.storyId) ?? -1;

    const slug =
      group.storyId === '__ungrouped__'
        ? 'ungrouped'
        : slugify(group.storyTitle);

    const branchName =
      group.storyId === '__ungrouped__'
        ? getTaskBranch(epicId, 'ungrouped')
        : getStoryBranch(epicId, group.storyId);

    return {
      storyId: group.storyId,
      storyTitle: group.storyTitle,
      storySlug: slug,
      type: group.type,
      branchName,
      model_tier: modelTier,
      earliestWave,
      tasks: group.tasks.map((t) => ({
        taskId: t.id,
        taskSlug: slugify(t.title),
        parentSlug: slug,
        status: t.status,
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
  agentTelemetry = null,
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
        mode: t.mode,
        skills: t.skills,
        focusAreas: t.focusAreas,
        dependsOn: t.dependsOn,
      })),
    })),
    storyManifest: buildStoryManifest(tasks, allTickets ?? [], epicId),
    dispatched,
    heldForApproval,
    agentTelemetry,
  };
}
