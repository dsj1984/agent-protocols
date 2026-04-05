#!/usr/bin/env node

/**
 * generate-playbook.js
 *
 * Reads a sprint task-manifest.json, computes an optimal execution graph
 * (sequential vs. concurrent Chat Sessions), and renders a deterministic
 * playbook.md with perfect numbering, Mermaid diagrams, and the verbatim
 * Agent Execution Protocol.
 *
 * Usage:
 *   node scripts/generate-playbook.js <sprint-number>
 *   npm run playbook:generate -- <sprint-number>
 *
 * Input:  docs/sprints/sprint-<N>/task-manifest.json
 * Output: docs/sprints/sprint-<N>/playbook.md
 *
 * Zero external dependencies — uses only node:fs, node:path, node:process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Library imports for decoupled logic
import { PlaybookOrchestrator } from './lib/PlaybookOrchestrator.js';
import { resolveConfig, PROJECT_ROOT } from './lib/config-resolver.js';
import { isBookendTask } from './lib/task-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load settings via unified configuration resolver
const { settings: agentConfig } = resolveConfig();

const bookendRequirements = agentConfig.bookendRequirements ?? {};
const defaultModels = agentConfig.defaultModels ?? {
  planningFallback: 'Claude Sonnet 4.6 (Think) OR Gemini 3.1 Pro (High)',
  fastFallback: 'Gemini 3 Flash'
};
const sprintDocsRoot = agentConfig.sprintDocsRoot ?? 'docs/sprints';
const sprintNumberPadding = agentConfig.sprintNumberPadding ?? 3;
const goldenExamplesRoot = agentConfig.goldenExamplesRoot ?? 'temp/golden-examples';
const taskStateRoot = agentConfig.taskStateRoot ?? 'temp/task-state';
const maxGoldenExampleLines = agentConfig.maxGoldenExampleLines ?? 200;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_ICONS = {
  database: '🗄️',
  web: '🌐',
  mobile: '📱',
  testing: '🧪',
  documentation: '📝',
  security: '🛡️',
  default: '⚙️'
};

// Pre-compiled regex patterns for icon selection (avoid recompilation per call)
const ICON_PATTERNS = [
  { pattern: /\b(infra|security|ops|config|workflow|auth|git|flow)\b/, icon: CHAT_ICONS.security },
  { pattern: /\b(db|sql|database|schema|turso|drizzle|sqlite)\b/, icon: CHAT_ICONS.database },
  { pattern: /\b(test|vitest|playwright|qa|e2e)\b/, icon: CHAT_ICONS.testing },
  { pattern: /\b(mobile|native|ios|android)\b/, icon: CHAT_ICONS.mobile },
  { pattern: /\b(web|frontend|astro|react|html|css)\b/, icon: CHAT_ICONS.web },
  { pattern: /\b(doc|markdown|roadmap)\b/, icon: CHAT_ICONS.documentation },
];

function selectIcon(session) {
  const tasks = session.tasks;
  const isQA = tasks.some(t => t.isQA);
  const isRetro = tasks.some(t => t.isRetro);
  const isIntegration = tasks.some(t => t.isIntegration);
  const isCodeReview = tasks.some(t => t.isCodeReview);
  const isCloseSprint = tasks.some(t => t.isCloseSprint);

  if (isQA) return CHAT_ICONS.testing;
  if (isRetro) return CHAT_ICONS.documentation;
  if (isIntegration || isCodeReview || isCloseSprint) return CHAT_ICONS.security;

  const allText = tasks.map(t => (t.title + ' ' + (t.scope || '') + ' ' + (t.instructions || '')).toLowerCase()).join(' ');

  for (const { pattern, icon } of ICON_PATTERNS) {
    if (pattern.test(allText)) return icon;
  }

  return CHAT_ICONS.default;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates the manifest against the schema rules. Returns an array of error
 * strings (empty if valid).
 */
export function validateManifest(manifest) {
  const errors = [];

  if (typeof manifest.sprintNumber !== 'number' || manifest.sprintNumber < 1) {
    errors.push('sprintNumber must be a positive integer.');
  }
  if (typeof manifest.sprintName !== 'string' || manifest.sprintName.length === 0) {
    errors.push('sprintName must be a non-empty string.');
  }
  if (typeof manifest.summary !== 'string' || manifest.summary.length === 0) {
    errors.push('summary must be a non-empty string.');
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    errors.push('tasks must be a non-empty array.');
    return errors; // Can't validate further
  }

  const ids = new Set();
  for (const task of manifest.tasks) {
    if (!task.id || typeof task.id !== 'string') {
      errors.push('Every task must have a non-empty string id.');
      continue;
    }
    if (ids.has(task.id)) {
      errors.push(`Duplicate task id: "${task.id}".`);
    }
    ids.add(task.id);

    if (!task.title) errors.push(`Task "${task.id}": missing title.`);
    if (!Array.isArray(task.dependsOn)) errors.push(`Task "${task.id}": dependsOn must be an array.`);
    if (!task.persona) errors.push(`Task "${task.id}": missing persona.`);
    if (!Array.isArray(task.skills)) errors.push(`Task "${task.id}": skills must be an array.`);
    if (!task.model) errors.push(`Task "${task.id}": missing model.`);
    if (!['Planning', 'Fast', 'SpeculativeCache'].includes(task.mode)) errors.push(`Task "${task.id}": mode must be "Planning", "Fast", or "SpeculativeCache".`);
    if (typeof task.instructions !== 'string' && !task.isIntegration && !task.isQA && !task.isCodeReview && !task.isRetro && !task.isCloseSprint && task.mode !== 'SpeculativeCache') {
      errors.push(`Task "${task.id}": instructions must be a string.`);
    }
  }

  // Validate dependsOn references
  for (const task of manifest.tasks) {
    if (!Array.isArray(task.dependsOn)) continue;
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        errors.push(`Task "${task.id}" depends on unknown task "${dep}".`);
      }
    }
  }

  // Validate bookend persona and rules dynamically from config
  for (const task of manifest.tasks) {
    for (const [key, req] of Object.entries(bookendRequirements)) {
      if (task[key]) {
        if (task.persona !== req.persona) errors.push(`Task "${task.id}": ${key} requires '${req.persona}' persona.`);
        for (const skill of req.skills) {
          if (!task.skills.includes(skill)) errors.push(`Task "${task.id}": ${key} requires '${skill}' skill.`);
        }
      }
    }
  }

  return errors;
}

/**
 * Extracts all valid model name strings from the models registry in config.
 * Returns a Set of model names for O(1) lookup during validation.
 * Uses the already-resolved agentConfig to avoid redundant file I/O.
 */
export function loadValidModelNames() {
  try {
    // Use the cached resolveConfig() result — the 'raw' field contains the full
    // parsed .agentrc.json, including the top-level models registry. This
    // eliminates the second disk read that the previous implementation performed.
    const { raw } = resolveConfig();
    if (!raw) return null;
    const categories = raw?.models?.categories;
    if (!Array.isArray(categories)) return null;

    const names = new Set();
    for (const cat of categories) {
      if (!Array.isArray(cat.models)) continue;
      for (const m of cat.models) {
        if (m.name) names.add(m.name);
      }
    }
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

/**
 * Validates that task model strings match entries in models.json/agentrc.json.
 * Returns an array of warning strings (non-fatal).
 */
export function validateModelNames(manifest) {
  const warnings = [];
  const validModels = loadValidModelNames();
  if (!validModels) return warnings; // No registry available — skip

  for (const task of manifest.tasks) {
    if (task.model && !validModels.has(task.model)) {
      // Check if it's a compound "X OR Y" string (from fallback defaults)
      const candidates = task.model.split(/\s+OR\s+/).map(m => m.trim());
      const allValid = candidates.every(c => validModels.has(c));
      if (!allValid) {
        warnings.push(`Task "${task.id}": model "${task.model}" not found in models registry. Valid: [${[...validModels].join(', ')}]`);
      }
    }
    if (task.secondaryModel && !validModels.has(task.secondaryModel)) {
      const candidates = task.secondaryModel.split(/\s+OR\s+/).map(m => m.trim());
      const allValid = candidates.every(c => validModels.has(c));
      if (!allValid) {
        warnings.push(`Task "${task.id}": secondaryModel "${task.secondaryModel}" not found in models registry. Valid: [${[...validModels].join(', ')}]`);
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Manifest Enrichment
// ---------------------------------------------------------------------------

import { instance as CacheManager } from './lib/CacheManager.js';
import { Logger } from './lib/Logger.js';

/**
 * Automatically injects required personas and skills for bookend tasks
 * to reduce boilerplate and prevent validation errors.
 */
export function enrichManifest(manifest) {
  if (!Array.isArray(manifest.tasks)) return;

  for (const task of manifest.tasks) {
    if (!Array.isArray(task.skills)) task.skills = [];

    for (const [key, req] of Object.entries(bookendRequirements)) {
      if (task[key]) {
        if (!task.persona) task.persona = req.persona;
        // Elevate primary model for analysis-heavy bookend tasks
        if (req.model) task.model = req.model;
        for (const skill of req.skills) {
          if (!task.skills.includes(skill)) task.skills.push(skill);
        }
      }
    }

    // Intelligent Model Fallbacks
    if (!task.secondaryModel) {
      const fallback = task.mode === 'Planning' ? defaultModels.planningFallback : defaultModels.fastFallback;
      task.secondaryModel = fallback;
    }

    // Ensure exactly 2 models from different families.
    // The fallback may be a compound "X OR Y" string — split and pick the best alternative.
    if (task.secondaryModel && task.model) {
      const primaryFamily = task.model.split(/\s/)[0]; // e.g. "Claude", "Gemini"
      const candidates = task.secondaryModel.split(/\s+OR\s+/).map(m => m.trim()).filter(Boolean);

      if (candidates.length > 1) {
        // Pick the candidate from a different family than the primary
        const crossFamily = candidates.find(c => !c.startsWith(primaryFamily));
        task.secondaryModel = crossFamily || candidates[candidates.length - 1];
      }

      // Final dedup: if secondary still matches primary exactly, cross-assign from the other tier
      if (task.secondaryModel === task.model) {
        task.secondaryModel = task.model === defaultModels.fastFallback
          ? (defaultModels.planningFallback.split(/\s+OR\s+/)[0] || defaultModels.planningFallback)
          : defaultModels.fastFallback;
      }

      // If secondary is a substring of primary (same family, different suffix), pick from other tier
      if (task.model.includes(task.secondaryModel) || task.secondaryModel.includes(task.model)) {
        const altFallback = task.mode === 'Planning' ? defaultModels.fastFallback : defaultModels.planningFallback;
        const altCandidates = altFallback.split(/\s+OR\s+/).map(m => m.trim());
        const altCross = altCandidates.find(c => !c.startsWith(primaryFamily));
        task.secondaryModel = altCross || altCandidates[0];
      }
    }

    // Strip HITL from non-bookend development tasks — human reviews at integration
    if (!isBookendTask(task) && task.requires_approval) {
      delete task.requires_approval;
    }

    // Auto-expand scope if instructions reference multiple workspaces
    if (task.scope && task.scope !== 'root' && typeof task.instructions === 'string') {
      const instructionText = task.instructions.toLowerCase();
      const crossPackageIndicators = ['monorepo', 'across the', 'platform-wide', 'all packages'];
      const packageMentions = ['expo', 'mobile', 'native', 'api', 'web', 'astro', 'shared', 'e2e', 'playwright', 'test'];
      const mentionedPackages = packageMentions.filter(p => instructionText.includes(p));
      const hasCrossPackageLanguage = crossPackageIndicators.some(ind => instructionText.includes(ind));

      if (mentionedPackages.length >= 2 || hasCrossPackageLanguage) {
        task.scope = 'root';
      }
    }

    // APC Speculative Execution Hook
    if (!isBookendTask(task) && task.instructions && CacheManager().config.enableSpeculativeExecution) {
      if (CacheManager().hasMatch(task.instructions, task.focusAreas, task.scope)) {
        task.mode = 'SpeculativeCache';
        task.description = `[APC] Hydrated via Semantic Cache Memory`;
        console.log(`[APC] Marking task ${task.id} as SpeculativeCache.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Persona & Skill Validation (Warnings)
// ---------------------------------------------------------------------------

export function validateAssets(manifest, agentsDir) {
  const warnings = [];

  for (const task of manifest.tasks) {
    const personaPath = path.join(agentsDir, 'personas', `${task.persona}.md`);
    if (!fs.existsSync(personaPath)) {
      warnings.push(`Task "${task.id}": persona file not found: ${personaPath}`);
    }

    for (const skill of task.skills) {
      const skillPath = path.join(agentsDir, 'skills', skill, 'SKILL.md');
      if (!fs.existsSync(skillPath)) {
        warnings.push(`Task "${task.id}": skill not found: ${skillPath}`);
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Chat Session Grouping
// ---------------------------------------------------------------------------

/**
 * Separates bookend tasks from regular development tasks.
 */
function segregateTasks(tasks) {
  const bookendTasks = [];
  const regularTasks = [];
  for (const task of tasks) {
    if (isBookendTask(task)) {
      bookendTasks.push(task);
    } else {
      regularTasks.push(task);
    }
  }
  return { bookendTasks, regularTasks };
}

/**
 * Groups regular tasks by layer and scope into Chat Sessions.
 */
function groupRegularTasks(regularTasks, layers, chatNumberStart) {
  const chatSessions = [];
  let chatNumber = chatNumberStart;

  const layerGroups = new Map();
  for (const task of regularTasks) {
    const layer = layers.get(task.id);
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer).push(task);
  }

  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  for (const layer of sortedLayers) {
    const tasksInLayer = layerGroups.get(layer);
    const isLayerConcurrent = tasksInLayer.length > 1;

    for (const task of tasksInLayer) {
      chatSessions.push({
        chatNumber: chatNumber++,
        label: task.title,
        icon: selectIcon({ tasks: [task] }),
        mode: isLayerConcurrent ? 'Concurrent' : 'Sequential',
        layer,
        tasks: [task],
      });
    }
  }
  return chatSessions;
}

/**
 * Appends deterministic bookend sessions (Integration, QA, Review, Retro, Close).
 */
function appendBookendSessions(chatSessions, bookendTasks, regularTasks, chatNumberStart) {
  let chatNumber = chatNumberStart;
  
  const bookendGroups = [
    {
      label: 'Merge & Verify',
      mode: 'SequentialBookend',
      keys: ['isIntegration', 'isCodeReview', 'isQA']
    },
    {
      label: 'Sprint Administration',
      mode: 'PMBookend',
      keys: ['isRetro', 'isCloseSprint']
    }
  ];

  const hasOutgoing = new Set();
  for (const task of regularTasks) {
    for (const dep of task.dependsOn) hasOutgoing.add(dep);
  }
  let currentDeps = regularTasks.filter((t) => !hasOutgoing.has(t.id)).map((t) => t.id);

  for (const group of bookendGroups) {
    const groupTasks = [];
    
    // Collect tasks in the exact strict order defined by keys
    for (const key of group.keys) {
      groupTasks.push(...bookendTasks.filter((t) => t[key]));
    }

    if (groupTasks.length > 0) {
      groupTasks[0].dependsOn = currentDeps;
      for (let i = 1; i < groupTasks.length; i++) {
        groupTasks[i].dependsOn = [groupTasks[i - 1].id];
      }

      chatSessions.push({
        chatNumber: chatNumber++,
        label: group.label,
        icon: selectIcon({ tasks: groupTasks }),
        mode: group.mode,
        layer: Infinity,
        tasks: groupTasks,
      });
      currentDeps = [groupTasks[groupTasks.length - 1].id];
    }
  }
}

/**
 * Groups tasks into Chat Sessions based on layer and scope.
 */
export function groupIntoChatSessions(tasks, layers, adjacency) {
  const { bookendTasks, regularTasks } = segregateTasks(tasks);
  const chatSessions = groupRegularTasks(regularTasks, layers, 1);

  // Eliminate redundant prerequisites for tasks inside the same sequential session
  for (const session of chatSessions) {
    if ((session.mode === 'Sequential' || session.mode === 'SequentialBookend' || session.mode === 'PMBookend') && session.tasks.length > 1) {
      for (let i = 1; i < session.tasks.length; i++) {
        const currentTask = session.tasks[i];
        const prevTask = session.tasks[i - 1];
        if (!currentTask.dependsOn) currentTask.dependsOn = [];
        if (!currentTask.dependsOn.includes(prevTask.id)) {
          currentTask.dependsOn.push(prevTask.id);
        }
      }
    }
  }

  appendBookendSessions(chatSessions, bookendTasks, regularTasks, chatSessions.length + 1);
  return chatSessions;
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Runs all playbook-generation phases for an already-parsed manifest object.
 * Delegates entirely to PlaybookOrchestrator.run() — this function is retained
 * as a stable public API for tests and external callers.
 *
 * @param {object} manifest - Parsed sprint manifest.
 * @param {object} [options] - Optional rendering options (paths, padding, etc.).
 * @returns {{ markdown: string, chatSessions: Array, chatDeps: Map }}
 */
export function generateFromManifest(manifest, options = {}) {
  const opts = {
    sprintDocsRoot,
    sprintNumberPadding,
    goldenExamplesRoot,
    taskStateRoot,
    maxGoldenExampleLines,
    ...options,
  };
  return buildOrchestrator(opts).run(manifest);
}

function buildOrchestrator(options = {}) {
  return new PlaybookOrchestrator({
    validateManifest,
    enrichManifest,
    validateAssets,
    groupIntoChatSessions,
    options,
  });
}

function main() {
  const sprintArg = process.argv[2];

  if (!sprintArg) {
    Logger.fatal('Usage: node scripts/generate-playbook.js <sprint-number>');
  }

  const sprintNumber = parseInt(sprintArg, 10);
  if (isNaN(sprintNumber) || sprintNumber < 1) {
    Logger.fatal(`Invalid sprint number: "${sprintArg}". Must be a positive integer.`);
  }

  // Normalize for robust directory resolution
  const paddedSprint = String(sprintNumber).padStart(sprintNumberPadding, '0');
  let sprintDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${paddedSprint}`);

  // Robustness: Fallback to the original unpadded arg if it exists and the padded one doesn't
  if (!fs.existsSync(sprintDir)) {
    const unpaddedDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${sprintArg}`);
    if (fs.existsSync(unpaddedDir)) sprintDir = unpaddedDir;
  }

  const AGENTS_DIR = path.join(__dirname, '..');
  const manifestPath = path.join(sprintDir, 'task-manifest.json');
  const outputPath = path.join(sprintDir, 'playbook.md');

  const orchestrator = buildOrchestrator({
    agentsDir: AGENTS_DIR,
    sprintDocsRoot,
    sprintNumberPadding,
    goldenExamplesRoot,
    taskStateRoot,
    maxGoldenExampleLines,
  });

  orchestrator.runFromFile(manifestPath, outputPath);
}

// Run main only when executed directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
