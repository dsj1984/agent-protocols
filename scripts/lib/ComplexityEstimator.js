/**
 * ComplexityEstimator.js
 *
 * Scores task complexity and optionally decomposes high-complexity tasks
 * into sequentially-chained sub-tasks. This is a planning-time optimization
 * that keeps each agent prompt small enough to execute reliably.
 *
 * Scoring heuristics (each contributes 0-3 points):
 *   - instructions length       → 0-3
 *   - estimatedFiles count      → 0-3
 *   - scope === 'root'          → +2
 *   - focusAreas count          → 0-2
 *   - cross-package indicators  → +1
 *   - bullet-point count        → 0-1
 *
 * When a task exceeds the threshold:
 *   - If explicit `substeps` array is provided → auto-split into sub-tasks
 *   - Otherwise → inject a complexity warning into the task
 *
 * Sub-tasks share the parent task's branch and use the natural
 * sprint.chat.step numbering (e.g. 045.1.1, 045.1.2, 045.1.3).
 */

import { resolveConfig } from './config-resolver.js';

// ---------------------------------------------------------------------------
// Default configuration (overridden by agentrc.json)
// ---------------------------------------------------------------------------

const DEFAULT_COMPLEXITY_CONFIG = {
  maxComplexityScore: 8,
  instructionLengthBreakpoints: [800, 1600, 2400],
  estimatedFilesBreakpoints: [5, 10, 20],
  focusAreasBreakpoints: [3, 6],
  enableAutoSplit: true,
  enableComplexityWarnings: true,
  maxSubstepsPerTask: 5,
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Computes a breakpoint-based score. Returns how many breakpoints the value
 * exceeds (0, 1, 2, or 3 depending on breakpoints length).
 */
function breakpointScore(value, breakpoints) {
  let score = 0;
  for (const bp of breakpoints) {
    if (value > bp) score++;
  }
  return score;
}

/**
 * Counts the number of markdown bullet points in a string.
 * Matches lines starting with "- ", "* ", or "N. " (numbered lists).
 */
function countBullets(text) {
  if (!text) return 0;
  const matches = text.match(/(?:^|\n)\s*(?:[-*]|\d+\.)\s+/g);
  return matches ? matches.length : 0;
}

/**
 * Checks if instruction text contains cross-package indicators.
 */
function hasCrossPackageLanguage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const indicators = [
    'monorepo',
    'across all',
    'across the',
    'platform-wide',
    'all packages',
    'every package',
    'global sweep',
    'codebase-wide',
    'cross-package',
    'all workspaces',
  ];
  return indicators.some((ind) => lower.includes(ind));
}

/**
 * Scores a single task's complexity. Returns an object with the total score
 * and a breakdown of each contributing signal.
 *
 * @param {object} task - A task object from the manifest.
 * @param {object} config - Complexity configuration (breakpoints, etc.).
 * @returns {{ total: number, breakdown: object }}
 */
export function scoreTask(task, config = DEFAULT_COMPLEXITY_CONFIG) {
  const breakdown = {};
  let total = 0;

  // Skip bookend tasks — they delegate to workflows and don't need splitting
  const isBookend =
    task.isIntegration ||
    task.isQA ||
    task.isCodeReview ||
    task.isRetro ||
    task.isCloseSprint;
  if (isBookend) {
    return { total: 0, breakdown: { bookend: 'skipped' } };
  }

  // 1. Instruction length
  const instrLen = typeof task.instructions === 'string' ? task.instructions.length : 0;
  const instrScore = breakpointScore(instrLen, config.instructionLengthBreakpoints);
  if (instrScore > 0) breakdown.instructionLength = { value: instrLen, score: instrScore };
  total += instrScore;

  // 2. Estimated files
  const estFiles = typeof task.estimatedFiles === 'number' ? task.estimatedFiles : 0;
  const filesScore = breakpointScore(estFiles, config.estimatedFilesBreakpoints);
  if (filesScore > 0) breakdown.estimatedFiles = { value: estFiles, score: filesScore };
  total += filesScore;

  // 3. Root scope
  if (task.scope === 'root') {
    breakdown.rootScope = { score: 2 };
    total += 2;
  }

  // 4. Focus areas count
  const focusCount = Array.isArray(task.focusAreas) ? task.focusAreas.length : 0;
  const focusScore = breakpointScore(focusCount, config.focusAreasBreakpoints);
  if (focusScore > 0) breakdown.focusAreas = { value: focusCount, score: focusScore };
  total += focusScore;

  // 5. Cross-package language
  if (hasCrossPackageLanguage(task.instructions)) {
    breakdown.crossPackage = { score: 1 };
    total += 1;
  }

  // 6. Bullet count
  const bullets = countBullets(task.instructions);
  if (bullets > 5) {
    breakdown.bulletCount = { value: bullets, score: 1 };
    total += 1;
  }

  return { total, breakdown };
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * Attempts to split a task's instructions into logical groups based on
 * markdown bullet points. Returns an array of { title, instructions } objects,
 * or null if the instructions cannot be cleanly split.
 *
 * @param {object} task
 * @param {number} maxSubsteps
 * @returns {Array|null}
 */
export function heuristicSplit(task, maxSubsteps = 5) {
  if (!task.instructions || typeof task.instructions !== 'string') return null;

  // Split on bullet points (lines starting with "- " or "* ")
  const lines = task.instructions.split('\n');
  const bulletGroups = [];
  let currentGroup = [];
  let headerLines = [];

  for (const line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
    if (isBullet) {
      currentGroup.push(line);
    } else if (currentGroup.length > 0) {
      // Non-bullet after bullets — continuation text, add to current group
      currentGroup.push(line);
    } else {
      // Preamble text before any bullets
      headerLines.push(line);
    }
  }
  if (currentGroup.length > 0) bulletGroups.push(currentGroup);

  // Need at least 3 bullets to justify splitting, and the split needs to
  // produce multiple groups
  if (bulletGroups.length === 0) return null;

  // Re-split: create groups of bullets, roughly evenly distributed
  const allBullets = [];
  for (const line of lines) {
    const isBullet = /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
    if (isBullet) {
      allBullets.push(line.trim());
    }
  }

  if (allBullets.length < 3) return null;

  // Split bullets into roughly equal groups, respecting maxSubsteps
  const groupCount = Math.min(Math.ceil(allBullets.length / 3), maxSubsteps);
  if (groupCount <= 1) return null;

  const groupSize = Math.ceil(allBullets.length / groupCount);
  const substeps = [];
  const header = headerLines.filter((l) => l.trim()).join('\n');

  for (let i = 0; i < allBullets.length; i += groupSize) {
    const chunk = allBullets.slice(i, i + groupSize);
    const partNum = substeps.length + 1;
    substeps.push({
      title: `Part ${partNum}`,
      instructions: (header ? header + '\n' : '') + chunk.join('\n'),
    });
  }

  return substeps.length > 1 ? substeps : null;
}

/**
 * Splits a single task into sequentially-chained sub-tasks.
 *
 * @param {object} task - The original task to split.
 * @param {Array} substeps - Array of { title, instructions, scope? }.
 * @returns {Array} Array of new sub-task objects.
 */
export function splitTask(task, substeps) {
  const subTasks = [];

  for (let i = 0; i < substeps.length; i++) {
    const step = substeps[i];
    const partId = `${task.id}-part-${i + 1}`;

    subTasks.push({
      id: partId,
      title: `${task.title} — ${step.title}`,
      dependsOn: i === 0 ? [...(task.dependsOn || [])] : [`${task.id}-part-${i}`],
      persona: task.persona,
      skills: [...(task.skills || [])],
      model: task.model,
      secondaryModel: task.secondaryModel,
      mode: task.mode,
      scope: step.scope || task.scope,
      focusAreas: task.focusAreas ? [...task.focusAreas] : undefined,
      instructions: step.instructions,
      // Metadata for rendering — sub-tasks share the parent's branch
      _splitFrom: task.id,
      _splitIndex: i + 1,
      _splitTotal: substeps.length,
      _parentBranchId: task.id,
    });
  }

  return subTasks;
}

/**
 * Rewires dependency edges in the manifest after a task has been split.
 * Any task that previously depended on `originalId` now depends on the
 * last sub-task's ID.
 *
 * @param {Array} tasks - The full tasks array (already mutated with sub-tasks).
 * @param {string} originalId - The original task ID that was split.
 * @param {string} lastSubTaskId - The ID of the last sub-task.
 */
function rewireDependencies(tasks, originalId, lastSubTaskId) {
  for (const task of tasks) {
    if (!Array.isArray(task.dependsOn)) continue;
    const idx = task.dependsOn.indexOf(originalId);
    if (idx !== -1) {
      task.dependsOn[idx] = lastSubTaskId;
    }
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Analyzes all tasks in a manifest for complexity, and optionally splits
 * high-complexity tasks into sub-tasks. Mutates `manifest.tasks` in-place.
 *
 * @param {object} manifest - The sprint manifest (must contain `tasks` array).
 * @param {object} [userConfig] - Optional complexity config override.
 * @returns {{ scores: Map, splits: string[], warnings: string[] }}
 */
export function analyzeAndSplit(manifest, userConfig = {}) {
  const config = { ...DEFAULT_COMPLEXITY_CONFIG, ...userConfig };
  const scores = new Map();
  const splits = [];
  const warnings = [];

  if (!Array.isArray(manifest.tasks)) {
    return { scores, splits, warnings };
  }

  // Phase 1: Score all tasks
  for (const task of manifest.tasks) {
    const result = scoreTask(task, config);
    scores.set(task.id, result);
  }

  // Phase 2: Identify tasks to split
  if (!config.enableAutoSplit) {
    // Build a fast id→task index so warning injection is O(1) per entry.
    const taskById = new Map(manifest.tasks.map((t) => [t.id, t]));
    for (const [id, { total }] of scores) {
      if (total >= config.maxComplexityScore) {
        const task = taskById.get(id);
        if (task && config.enableComplexityWarnings) {
          task._complexityWarning = true;
          task._complexityScore = total;
          warnings.push(`[COMPLEXITY] Task "${id}" scored ${total}/${config.maxComplexityScore} — warning injected.`);
        }
      }
    }
    return { scores, splits, warnings };
  }

  // Phase 2b: Split tasks that exceed threshold
  // Process in reverse order so splice indices remain valid
  const tasksToProcess = [...manifest.tasks.entries()]
    .filter(([, task]) => {
      const score = scores.get(task.id);
      return score && score.total >= config.maxComplexityScore;
    })
    .reverse();

  for (const [index, task] of tasksToProcess) {
    // Only split when explicit substeps are provided by the planner.
    // No heuristic bullet-point splitting — too fragile for production use.
    if (Array.isArray(task.substeps) && task.substeps.length > 1) {
      const substeps = task.substeps.slice(0, config.maxSubstepsPerTask);

      // Perform the split
      const subTasks = splitTask(task, substeps);
      const lastSubTaskId = subTasks[subTasks.length - 1].id;

      // Replace original task with sub-tasks
      manifest.tasks.splice(index, 1, ...subTasks);

      // Rewire dependencies
      rewireDependencies(manifest.tasks, task.id, lastSubTaskId);

      splits.push(`[SPLIT] Task "${task.id}" → ${subTasks.length} sub-tasks (score: ${scores.get(task.id).total})`);
    } else {
      // No explicit substeps — inject warning instead of splitting
      if (config.enableComplexityWarnings) {
        task._complexityWarning = true;
        task._complexityScore = scores.get(task.id).total;
        warnings.push(`[COMPLEXITY] Task "${task.id}" scored ${scores.get(task.id).total}/${config.maxComplexityScore} — warning injected (provide substeps in manifest for auto-split).`);
      }
    }
  }

  return { scores, splits, warnings };
}

// ---------------------------------------------------------------------------
// Config Loader (convenience)
// ---------------------------------------------------------------------------

/**
 * Loads complexity config from the project's .agentrc.json, falling back
 * to defaults.
 * @returns {object} The merged complexity configuration.
 */
export function loadComplexityConfig() {
  try {
    const { settings } = resolveConfig();
    return { ...DEFAULT_COMPLEXITY_CONFIG, ...(settings.complexity || {}) };
  } catch {
    return { ...DEFAULT_COMPLEXITY_CONFIG };
  }
}
