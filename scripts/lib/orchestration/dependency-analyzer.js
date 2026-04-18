import {
  assignLayers,
  buildGraph,
  computeReachability,
  detectCycle,
} from '../Graph.js';
import { isBookendTask } from '../task-utils.js';

/**
 * Auto-serializes concurrent tasks whose focusAreas overlap (or whose scope is
 * 'root' / includes '*'), preventing file-level conflicts at runtime.
 *
 * This is the canonical, optimised implementation (bulk-accumulate pattern):
 *   Phase A — O(N²) scan; collects all new edges without rebuilding the graph.
 *   Phase B — applies all edges in one pass, rebuilds once, re-checks for cycles.
 *
 * Both generate-playbook.js (generateFromManifest) and PlaybookOrchestrator
 * delegate here so the algorithm is defined exactly once.
 *
 * Bookend tasks are excluded: they do not perform file edits and serialising
 * them would produce incorrect dependency orderings.
 *
 * @param {object} manifest   — The sprint manifest (tasks array is mutated in place).
 * @param {Map}    adjacency  — The initial adjacency list (from buildGraph).
 * @returns {{ finalAdjacency: Map, graphMutated: boolean }}
 */
export function autoSerializeOverlaps(manifest, adjacency) {
  // Pre-compute focus-area Sets for O(1) intersection checks
  const focusSets = new Map(
    manifest.tasks.map((t) => [
      t.id,
      new Set(Array.isArray(t.focusAreas) ? t.focusAreas : []),
    ]),
  );

  const reachable = computeReachability(adjacency);
  const pendingEdges = _collectPendingEdges(
    manifest.tasks,
    focusSets,
    reachable,
  );

  // Phase B: apply all collected edges in a single pass & rebuild once
  const graphMutated = pendingEdges.length > 0;
  if (graphMutated) {
    applyNewDependencies(manifest.tasks, pendingEdges);

    const updatedGraph = buildGraph(manifest.tasks);
    const finalAdjacency = updatedGraph.adjacency;
    const cycle = detectCycle(finalAdjacency);

    if (cycle) {
      throw new Error(
        `Dependency cycle detected after auto-serialization: ${cycle.join(' → ')}`,
      );
    }
    return { finalAdjacency, graphMutated };
  }

  return { finalAdjacency: adjacency, graphMutated: false };
}

/**
 * Internal helper to apply new edges to the task manifest efficiently.
 * Uses a Set-based lookup to ensure O(1) duplicate checks during the merge.
 *
 * @param {object[]} tasks  — Array of tasks to update.
 * @param {Array[]}  edges  — List of [fromId, toId] pairs.
 */
function applyNewDependencies(tasks, edges) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const depSets = new Map();

  for (const [fromId, toId] of edges) {
    const task = taskMap.get(toId);
    if (!task) continue;

    task.dependsOn ??= [];

    if (!depSets.has(toId)) {
      depSets.set(toId, new Set(task.dependsOn));
    }

    const set = depSets.get(toId);
    if (!set.has(fromId)) {
      set.add(fromId);
      task.dependsOn.push(fromId);
    }
  }
}

/**
 * Roll focus-area sets up from tasks to stories. Returns a map of
 * storyId → { areas: Set<string>, global: boolean }. A story is "global"
 * if any of its tasks declares `scope === 'root'` or a `*` focus area —
 * meaning it is treated as overlapping every other story.
 *
 * Stories with no task-level focusAreas declared produce an empty set and
 * are excluded from overlap serialization (no false positives).
 *
 * @param {Map<number|string, {tasks: object[]}>} storyGroups
 * @returns {Map<number|string, {areas: Set<string>, global: boolean}>}
 */
function rollUpStoryFocus(storyGroups) {
  const storyFocus = new Map();
  for (const [storyId, group] of storyGroups.entries()) {
    const areas = new Set();
    let global = false;
    for (const task of group.tasks ?? []) {
      if (task.scope === 'root') global = true;
      if (Array.isArray(task.focusAreas)) {
        for (const area of task.focusAreas) {
          if (area === '*') global = true;
          else areas.add(area);
        }
      }
    }
    storyFocus.set(storyId, { areas, global });
  }
  return storyFocus;
}

/**
 * Add focus-area overlap edges to a story-level adjacency map.
 *
 * Two stories overlap when any task in story A and any task in story B share
 * a `focusAreas` entry (or either story is "global" via scope::root / `*`).
 * For overlapping pairs that are not already ordered by an existing edge,
 * we insert an edge from the lower storyId to the higher storyId — this is
 * deterministic and avoids cycles with existing edges because we only add
 * when *neither* direction is reachable.
 *
 * Stories with no declared focus areas are skipped to prevent over-
 * serialization when planning data is incomplete.
 *
 * Mutates `adjacency` in place. Returns the count of edges added.
 *
 * @param {Map<number|string, number[]>} adjacency
 * @param {Map<number|string, {tasks: object[]}>} storyGroups
 * @returns {number}
 */
function addFocusOverlapEdges(adjacency, storyGroups) {
  const storyFocus = rollUpStoryFocus(storyGroups);
  const reachable = computeReachability(adjacency);
  const storyIds = [...storyGroups.keys()].filter(
    (id) => id !== '__ungrouped__',
  );
  let added = 0;

  for (let i = 0; i < storyIds.length; i++) {
    for (let j = i + 1; j < storyIds.length; j++) {
      const a = storyIds[i];
      const b = storyIds[j];
      const fa = storyFocus.get(a);
      const fb = storyFocus.get(b);
      if (!fa || !fb) continue;
      if (fa.areas.size === 0 && !fa.global) continue;
      if (fb.areas.size === 0 && !fb.global) continue;

      const overlap =
        fa.global || fb.global || [...fa.areas].some((x) => fb.areas.has(x));
      if (!overlap) continue;

      const aReachesB = reachable.get(a)?.has(b);
      const bReachesA = reachable.get(b)?.has(a);
      if (aReachesB || bReachesA) continue;

      // Deterministic direction: lower id runs first. Numeric ids sort
      // numerically; string ids (rare — only `__ungrouped__`, already
      // filtered) would fall through to lexicographic, which is fine.
      const [from, to] =
        typeof a === 'number' && typeof b === 'number'
          ? a < b
            ? [a, b]
            : [b, a]
          : String(a) < String(b)
            ? [a, b]
            : [b, a];

      const deps = adjacency.get(to) ?? [];
      if (!deps.includes(from)) {
        deps.push(from);
        adjacency.set(to, deps);
        added++;
      }
    }
  }

  return added;
}

/**
 * Compute story-level execution waves from cross-story task dependencies,
 * explicit story-to-story `blocked by` declarations, AND focus-area overlap
 * between stories within the same Epic.
 *
 * Sources of story dependencies:
 *   1. **Implicit (cross-story tasks)**: Task T in Story A depends on Task T'
 *      in Story B → Story A depends on Story B.
 *   2. **Explicit (story body)**: Story A body contains `blocked by #B` →
 *      Story A depends on Story B.
 *   3. **Focus overlap (file contention)**: Stories A and B share any
 *      `focusAreas` entry (rolled up from child tasks), or one is globally
 *      scoped. The lower storyId is placed ahead of the higher to serialize
 *      the pair — this prevents the "five parallel stories all writing to
 *      the same directory" contention that cannot be solved at runtime when
 *      agents share a working tree. Stories with no declared focus areas
 *      are left alone to avoid over-serialization.
 *
 * After merging all three sources, runs `assignLayers` to produce wave
 * indices.
 *
 * @param {Map<number, {storyId: number|string, tasks: object[]}>} storyGroups
 *   Map of storyId → { storyId, tasks: [{ id, dependsOn, focusAreas?, scope? }] }
 * @param {Map<number|string, number[]>} [explicitDeps]
 *   Optional map of storyId → [blockerStoryId, ...] parsed from story ticket
 *   `blocked by` references. Only includes references to *other stories within
 *   the same Epic*.
 * @returns {Map<number|string, number>} Map of storyId → wave index.
 */
export function computeStoryWaves(storyGroups, explicitDeps) {
  // Build a reverse lookup: taskId → storyId
  const taskToStory = new Map();
  for (const [storyId, group] of storyGroups.entries()) {
    for (const task of group.tasks) {
      taskToStory.set(task.id, storyId);
    }
  }

  // Build story-level adjacency: storyA depends on storyB if any task in
  // storyA has a dependency on a task in storyB.
  const storyAdjacency = new Map();
  for (const storyId of storyGroups.keys()) {
    storyAdjacency.set(storyId, []);
  }

  for (const [storyId, group] of storyGroups.entries()) {
    const depStories = new Set();
    for (const task of group.tasks) {
      for (const depId of task.dependsOn ?? []) {
        const depStory = taskToStory.get(depId);
        if (depStory !== undefined && depStory !== storyId) {
          depStories.add(depStory);
        }
      }
    }

    // Merge explicit story-to-story dependencies (from `blocked by` on the
    // story ticket body itself).
    if (explicitDeps) {
      const explicit = explicitDeps.get(storyId) ?? [];
      for (const depStoryId of explicit) {
        if (depStoryId !== storyId && storyGroups.has(depStoryId)) {
          depStories.add(depStoryId);
        }
      }
    }

    storyAdjacency.set(storyId, [...depStories]);
  }

  // Detect cycles in the dependency-derived graph BEFORE adding focus-overlap
  // edges. Pre-existing cycles are a planning error; overlap edges are only
  // added when neither direction is already reachable so they cannot
  // introduce a new cycle.
  const cycle = detectCycle(storyAdjacency);
  if (cycle) {
    throw new Error(
      `[Graph] Story-level dependency cycle detected: ${cycle.join(' → ')}. ` +
        'This usually means cross-story task dependencies form a circular chain.',
    );
  }

  addFocusOverlapEdges(storyAdjacency, storyGroups);

  // Assign layers (waves) to stories
  return assignLayers(storyAdjacency);
}

// Exported for targeted unit testing; not part of the stable module API.
export const __test = { rollUpStoryFocus, addFocusOverlapEdges };

/**
 * Internal helper to find all pairs of tasks that overlap but don't yet have
 * a dependency ordering between them.
 *
 * @param {object[]} tasks     — The array of tasks to check.
 * @param {Map}      focusSets — Map of taskId to Set of focus areas.
 * @param {Map}      reachable — Reachability matrix to check existing paths.
 * @returns {Array[]}            List of [fromId, toId] pairs.
 */
function _collectPendingEdges(tasks, focusSets, reachable) {
  const pendingEdges = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const taskA = tasks[i];
      const taskB = tasks[j];
      if (isBookendTask(taskA) || isBookendTask(taskB)) continue;

      const setA = focusSets.get(taskA.id);
      const setB = focusSets.get(taskB.id);
      if (setA.size === 0 && setB.size === 0) continue;

      const isGlobalA = taskA.scope === 'root' || setA.has('*');
      const isGlobalB = taskB.scope === 'root' || setB.has('*');
      const overlap =
        isGlobalA || isGlobalB || [...setA].some((a) => setB.has(a));

      if (overlap) {
        const aReachesB = reachable.get(taskA.id)?.has(taskB.id);
        const bReachesA = reachable.get(taskB.id)?.has(taskA.id);
        if (!aReachesB && !bReachesA) pendingEdges.push([taskA.id, taskB.id]);
      }
    }
  }
  return pendingEdges;
}
