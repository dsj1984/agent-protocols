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
import { buildGraph, detectCycle, assignLayers, transitiveReduction, computeChatDependencies, computeReachability } from './lib/Graph.js';
import { renderPlaybook } from './lib/Renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Load Config
const configPath = path.join(AGENTS_DIR, 'config', 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('Failed to parse config.json:', e);
  process.exit(1);
}
const bookendRequirements = config?.properties?.bookendRequirements?.default || {};
const defaultModels = config?.properties?.defaultModels?.default || {
  planningFallback: 'Gemini 3.1 Pro (Low)',
  fastFallback: 'Gemini 3 Flash'
};
const sprintDocsRoot = config?.properties?.sprintDocsRoot?.default || 'docs/sprints';
const sprintNumberPadding = config?.properties?.sprintNumberPadding?.default || 3;
const goldenExamplesRoot = config?.properties?.goldenExamplesRoot?.default || 'temp/golden-examples';

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

  // Prioritize Ops/Security/Infra to avoid monorepo "Web" mention false-positives
  if (allText.match(/\b(infra|security|ops|config|workflow|auth|git|flow)\b/)) return CHAT_ICONS.security;
  if (allText.match(/\b(db|sql|database|schema|turso|drizzle|sqlite)\b/)) return CHAT_ICONS.database;
  if (allText.match(/\b(test|vitest|playwright|qa|e2e)\b/)) return CHAT_ICONS.testing;
  if (allText.match(/\b(mobile|native|ios|android)\b/)) return CHAT_ICONS.mobile; // Mobile prioritized over web if both mentioned
  if (allText.match(/\b(web|frontend|astro|react|html|css)\b/)) return CHAT_ICONS.web;
  if (allText.match(/\b(doc|markdown|roadmap)\b/)) return CHAT_ICONS.documentation;

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
    if (!['Planning', 'Fast'].includes(task.mode)) errors.push(`Task "${task.id}": mode must be "Planning" or "Fast".`);
    if (typeof task.instructions !== 'string' && !task.isIntegration && !task.isQA && !task.isCodeReview && !task.isRetro && !task.isCloseSprint) {
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

// ---------------------------------------------------------------------------
// Manifest Enrichment
// ---------------------------------------------------------------------------

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
      task.secondaryModel = task.mode === 'Planning' ? defaultModels.planningFallback : defaultModels.fastFallback;
    }
    
    // Prevent duplicate model fallbacks
    if (task.secondaryModel === task.model) {
      task.secondaryModel = task.model === defaultModels.planningFallback ? defaultModels.fastFallback : defaultModels.planningFallback;
    }

    // Auto-expand scope if instructions reference multiple workspaces
    if (task.scope && task.scope !== 'root' && typeof task.instructions === 'string') {
      const instructionText = task.instructions.toLowerCase();
      const crossPackageIndicators = ['monorepo', 'across the', 'platform-wide', 'all packages'];
      const packageMentions = ['expo', 'mobile', 'native', 'api', 'web', 'astro', 'shared'];
      const mentionedPackages = packageMentions.filter(p => instructionText.includes(p));
      const hasCrossPackageLanguage = crossPackageIndicators.some(ind => instructionText.includes(ind));

      if (mentionedPackages.length >= 2 || hasCrossPackageLanguage) {
        task.scope = 'root';
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
    if (task.isIntegration || task.isQA || task.isCodeReview || task.isRetro || task.isCloseSprint) {
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

export function generateFromManifest(manifest, options = {}) {
  const { agentsDir } = options;
  
  // Inject configuration defaults if not provided in options
  if (!options.sprintDocsRoot) options.sprintDocsRoot = sprintDocsRoot;
  if (!options.sprintNumberPadding) options.sprintNumberPadding = sprintNumberPadding;
  if (!options.goldenExamplesRoot) options.goldenExamplesRoot = goldenExamplesRoot;
  if (!options.protocolVersion) {
    const versionPath = path.join(__dirname, '..', 'VERSION');
    try {
      options.protocolVersion = fs.readFileSync(versionPath, 'utf8').trim();
    } catch (e) {
      options.protocolVersion = 'Unknown';
    }
  }

  // 0. Auto-enrich manifest with boilerplate required fields
  enrichManifest(manifest);

  // 1. Validate
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    const msg = `Task manifest validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
    throw new Error(msg);
  }

  // 2. Asset warnings
  if (agentsDir) {
    const warnings = validateAssets(manifest, agentsDir);
    for (const w of warnings) {
      console.warn(`⚠️  ${w}`);
    }
  }

  // 3. Build graph & check for cycles
  const { adjacency, taskMap } = buildGraph(manifest.tasks);
  const cycle = detectCycle(adjacency);
  if (cycle) {
    throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`);
  }

  // 3.5 Auto-Serialize Concurrent Overlaps and Global Sweeps
  let reachable = computeReachability(adjacency);
  let graphMutated = false;
  
  for (let i = 0; i < manifest.tasks.length; i++) {
    for (let j = i + 1; j < manifest.tasks.length; j++) {
      const taskA = manifest.tasks[i];
      const taskB = manifest.tasks[j];
      
      const areasA = Array.isArray(taskA.focusAreas) ? taskA.focusAreas : [];
      const areasB = Array.isArray(taskB.focusAreas) ? taskB.focusAreas : [];
      
      const isGlobalA = taskA.scope === 'root' || areasA.includes('*');
      const isGlobalB = taskB.scope === 'root' || areasB.includes('*');
      
      const overlap = areasA.find(a => areasB.includes(a));
      
      if (overlap || isGlobalA || isGlobalB) {
         const aReachesB = reachable.get(taskA.id)?.has(taskB.id);
         const bReachesA = reachable.get(taskB.id)?.has(taskA.id);
         
         if (!aReachesB && !bReachesA) {
            // Auto-serialize parallel tasks
            if (!taskB.dependsOn) taskB.dependsOn = [];
            taskB.dependsOn.push(taskA.id);
            graphMutated = true;
            
            // Recompute incrementally
            const tempGraph = buildGraph(manifest.tasks);
            reachable = computeReachability(tempGraph.adjacency);
         }
      }
    }
  }

  let finalAdjacency = adjacency;
  if (graphMutated) {
    const updatedGraph = buildGraph(manifest.tasks);
    finalAdjacency = updatedGraph.adjacency;
    const cycle2 = detectCycle(finalAdjacency);
    if (cycle2) {
      throw new Error(`Dependency cycle detected after auto-serialization: ${cycle2.join(' → ')}`);
    }
  }

  // 4. Assign layers
  const layers = assignLayers(finalAdjacency);

  // 5. Group into Chat Sessions (which internally overrides happens-before relations for bookends)
  const chatSessions = groupIntoChatSessions(manifest.tasks, layers, finalAdjacency);

  // 6. Re-build graph to capture mutated relations from grouping before reduction
  const { adjacency: groupedAdjacency } = buildGraph(manifest.tasks);

  // 7. Apply transitive reduction to individual tasks before rendering instructions
  const reducedAdjacency = transitiveReduction(groupedAdjacency);
  for (const task of manifest.tasks) {
    task.dependsOn = reducedAdjacency.get(task.id) || [];
  }

  // 8. Compute cross-chat dependencies
  const chatDeps = computeChatDependencies(chatSessions, groupedAdjacency);

  // 8. Render
  const markdown = renderPlaybook(manifest, chatSessions, chatDeps, options);

  return { markdown, chatSessions, chatDeps };
}

function main() {
  const sprintArg = process.argv[2];

  if (!sprintArg) {
    console.error('Usage: node scripts/generate-playbook.js <sprint-number>');
    process.exit(1);
  }

  const sprintNumber = parseInt(sprintArg, 10);
  if (isNaN(sprintNumber) || sprintNumber < 1) {
    console.error(`Invalid sprint number: "${sprintArg}". Must be a positive integer.`);
    process.exit(1);
  }

  // Normalize for robust directory resolution
  const paddedSprint = String(sprintNumber).padStart(sprintNumberPadding, '0');
  
  // Try finding it with padded digits first (new standard)
  let sprintDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${paddedSprint}`);
  
  // Robustness: Fallback to the original unpadded arg if it exists and the padded one doesn't
  if (!fs.existsSync(sprintDir)) {
    const unpaddedDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${sprintArg}`);
    if (fs.existsSync(unpaddedDir)) {
      sprintDir = unpaddedDir;
    }
  }

  const manifestPath = path.join(sprintDir, 'task-manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    console.error(`Create the task-manifest.json first, then run this script.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${manifestPath}: ${e.message}`);
    process.exit(1);
  }

  const { markdown } = generateFromManifest(manifest, { agentsDir: AGENTS_DIR });

  const outputPath = path.join(sprintDir, 'playbook.md');
  fs.mkdirSync(sprintDir, { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf8');

  console.log(`✅ Playbook generated: ${outputPath}`);
}

// Run main only when executed directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
