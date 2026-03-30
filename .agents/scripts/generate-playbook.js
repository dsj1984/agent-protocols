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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_ICONS = ['⚙️', '⚡', '📱', '🔧', '🗄️', '🌐', '📦', '🔌', '🛡️', '🎨'];

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
    if (typeof task.instructions !== 'string' && !task.isQA && !task.isCodeReview && !task.isRetro) {
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

  return errors;
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
// DAG: Cycle Detection & Topological Sort
// ---------------------------------------------------------------------------

/**
 * Builds an adjacency list from the manifest tasks.
 * Returns { adjacency: Map<id, id[]>, taskMap: Map<id, task> }
 */
export function buildGraph(tasks) {
  const adjacency = new Map();
  const taskMap = new Map();

  for (const task of tasks) {
    adjacency.set(task.id, [...task.dependsOn]);
    taskMap.set(task.id, task);
  }

  return { adjacency, taskMap };
}

/**
 * Detects cycles using DFS. Returns the first cycle found as an array of ids,
 * or null if the graph is acyclic.
 */
export function detectCycle(adjacency) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();

  for (const id of adjacency.keys()) {
    color.set(id, WHITE);
  }

  for (const id of adjacency.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfsVisit(id, adjacency, color, parent);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfsVisit(u, adjacency, color, parent) {
  color.set(u, 1); // GRAY

  for (const v of adjacency.get(u) || []) {
    if (color.get(v) === 1) {
      // Back edge → cycle. Reconstruct.
      const cycle = [v, u];
      let cur = u;
      while (parent.has(cur) && parent.get(cur) !== v) {
        cur = parent.get(cur);
        cycle.push(cur);
      }
      return cycle.reverse();
    }
    if (color.get(v) === 0) {
      parent.set(v, u);
      const cycle = dfsVisit(v, adjacency, color, parent);
      if (cycle) return cycle;
    }
  }

  color.set(u, 2); // BLACK
  return null;
}

/**
 * Assigns each task a layer (depth from root). Root tasks (no dependencies)
 * are layer 0. Returns Map<id, layer>.
 */
export function assignLayers(adjacency) {
  const layers = new Map();
  const memo = new Map();

  function getLayer(id) {
    if (memo.has(id)) return memo.get(id);

    const deps = adjacency.get(id) || [];
    if (deps.length === 0) {
      memo.set(id, 0);
      return 0;
    }

    const maxDepLayer = Math.max(...deps.map(getLayer));
    const layer = maxDepLayer + 1;
    memo.set(id, layer);
    return layer;
  }

  for (const id of adjacency.keys()) {
    layers.set(id, getLayer(id));
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Chat Session Grouping
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ChatSession
 * @property {number} chatNumber  - 1-indexed chat session number
 * @property {string} label       - Human-readable label for the chat session
 * @property {string} icon        - Emoji icon
 * @property {string} mode        - 'Sequential' or 'Concurrent'
 * @property {number} layer       - The concurrency layer this session belongs to
 * @property {string[]} dependsOnChats - Chat session labels this depends on
 * @property {Object[]} tasks     - Ordered tasks within this session
 */

/**
 * Groups tasks into Chat Sessions based on layer and scope.
 *
 * Rules:
 *   1. Bookend tasks (isQA, isCodeReview, isRetro) are always placed in their
 *      own dedicated Chat Sessions at the end, in a deterministic order.
 *   2. Regular tasks at the same layer sharing a scope are grouped into one
 *      sequential Chat Session.
 *   3. Regular tasks at the same layer with different scopes become separate
 *      concurrent Chat Sessions.
 */
export function groupIntoChatSessions(tasks, layers, adjacency) {
  // Separate bookend tasks from regular tasks
  const bookendTasks = [];
  const regularTasks = [];

  for (const task of tasks) {
    if (task.isIntegration || task.isQA || task.isCodeReview || task.isRetro) {
      bookendTasks.push(task);
    } else {
      regularTasks.push(task);
    }
  }

  // Group regular tasks by layer, then by scope within each layer
  const layerGroups = new Map();
  for (const task of regularTasks) {
    const layer = layers.get(task.id);
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer).push(task);
  }

  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);
  const chatSessions = [];
  let chatNumber = 1;

  for (const layer of sortedLayers) {
    const tasksInLayer = layerGroups.get(layer);

    // Sub-group by scope
    const scopeGroups = new Map();
    for (const task of tasksInLayer) {
      const scope = task.scope || '__unscoped__';
      if (!scopeGroups.has(scope)) scopeGroups.set(scope, []);
      scopeGroups.get(scope).push(task);
    }

    const scopeKeys = [...scopeGroups.keys()].sort();
    const isLayerConcurrent = scopeKeys.length > 1 || (tasksInLayer.length > 1 && !tasksInLayer[0].scope);

    // For unscoped tasks at the same layer, each becomes its own chat session
    // IF there are multiple. If there's only one unscoped group, it's sequential.
    if (scopeKeys.length === 1 && scopeKeys[0] === '__unscoped__' && tasksInLayer.length > 1) {
      // Multiple unscoped tasks at same layer → each gets its own concurrent session
      for (const task of tasksInLayer) {
        const icon = CHAT_ICONS[(chatNumber - 1) % CHAT_ICONS.length];
        chatSessions.push({
          chatNumber: chatNumber++,
          label: task.title,
          icon,
          mode: 'Concurrent',
          layer,
          tasks: [task],
        });
      }
    } else {
      for (const scope of scopeKeys) {
        const scopeTasks = scopeGroups.get(scope);
        const label =
          scope !== '__unscoped__'
            ? scopeTasks.length === 1
              ? scopeTasks[0].title
              : `${scope} Tasks`
            : scopeTasks[0].title;

        const icon = CHAT_ICONS[(chatNumber - 1) % CHAT_ICONS.length];
        const mode = isLayerConcurrent ? 'Concurrent' : 'Sequential';

        chatSessions.push({
          chatNumber: chatNumber++,
          label,
          icon,
          mode,
          layer,
          tasks: scopeTasks,
        });
      }
    }
  }

  // Append Integration before QA
  const integrationTasks = bookendTasks.filter((t) => t.isIntegration);
  if (integrationTasks.length > 0) {
    chatSessions.push({
      chatNumber: chatNumber++,
      label: 'Sprint Integration & Sync',
      icon: '🔗',
      mode: 'SequentialBookend',
      layer: Infinity,
      tasks: integrationTasks,
    });
  }

  // Append QA
  const qaTasks = bookendTasks.filter((t) => t.isQA);
  if (qaTasks.length > 0) {
    chatSessions.push({
      chatNumber: chatNumber++,
      label: 'QA & E2E Testing',
      icon: '🧪',
      mode: 'SequentialBookend',
      layer: Infinity,
      tasks: qaTasks,
    });
  }

  // Append Code Review as its own session
  const reviewTasks = bookendTasks.filter((t) => t.isCodeReview);
  if (reviewTasks.length > 0) {
    chatSessions.push({
      chatNumber: chatNumber++,
      label: 'Code Review',
      icon: '🔍',
      mode: 'PMBookend',
      layer: Infinity,
      tasks: reviewTasks,
    });
  }

  // Append Retro as the absolute last session
  const retroTasks = bookendTasks.filter((t) => t.isRetro);
  if (retroTasks.length > 0) {
    chatSessions.push({
      chatNumber: chatNumber++,
      label: 'Sprint Retrospective',
      icon: '🔄',
      mode: 'PMBookend',
      layer: Infinity,
      tasks: retroTasks,
    });
  }

  return chatSessions;
}

// ---------------------------------------------------------------------------
// Chat Session Dependency Resolution
// ---------------------------------------------------------------------------

/**
 * Computes which Chat Sessions each Chat Session depends on.
 * Returns a Map<chatNumber, chatNumber[]>.
 */
export function computeChatDependencies(chatSessions, adjacency) {
  // Build a reverse lookup: taskId → chatNumber
  const taskToChat = new Map();
  for (const session of chatSessions) {
    for (const task of session.tasks) {
      taskToChat.set(task.id, session.chatNumber);
    }
  }

  const chatDeps = new Map();
  for (const session of chatSessions) {
    const deps = new Set();
    for (const task of session.tasks) {
      for (const depId of task.dependsOn) {
        const depChat = taskToChat.get(depId);
        if (depChat !== undefined && depChat !== session.chatNumber) {
          deps.add(depChat);
        }
      }
    }
    chatDeps.set(session.chatNumber, [...deps].sort((a, b) => a - b));
  }

  return chatDeps;
}

// ---------------------------------------------------------------------------
// Mermaid Diagram Generation
// ---------------------------------------------------------------------------

export function generateMermaid(chatSessions, chatDeps) {
  const lines = ['```mermaid', 'graph TD'];

  // Define nodes
  for (const session of chatSessions) {
    const nodeId = `C${session.chatNumber}`;
    const nodeLabel = `${session.icon} Chat Session ${session.chatNumber}: ${session.label}`;
    lines.push(`    ${nodeId}["${nodeLabel}"]`);
    lines.push(`    class ${nodeId} not_started`);
  }

  // Define edges
  const edgesEmitted = new Set();
  for (const session of chatSessions) {
    const deps = chatDeps.get(session.chatNumber) || [];
    if (deps.length === 0 && session.chatNumber !== 1) {
      // No explicit deps but not the root — check if any prior layer exists
      // This is handled organically by the deps resolution, so skip.
    }
    for (const depChat of deps) {
      const edgeKey = `C${depChat}->C${session.chatNumber}`;
      if (!edgesEmitted.has(edgeKey)) {
        lines.push(`    C${depChat} --> C${session.chatNumber}`);
        edgesEmitted.add(edgeKey);
      }
    }
  }

  // Define Legend (Compact single node)
  lines.push('    Legend["⬜ Not Started  🟦 In Progress  🟩 Complete"]:::LegendNode');

  // Define styles
  lines.push('    %% Style Definitions %%');
  lines.push('    classDef not_started fill:#d1d5db,stroke:#9ca3af,color:#1f2937');
  lines.push('    classDef in_progress fill:#3b82f6,stroke:#2563eb,color:#ffffff');
  lines.push('    classDef complete fill:#16a34a,stroke:#059669,color:#ffffff');
  lines.push('    classDef LegendNode fill:transparent,stroke:transparent,font-size:10px');
  lines.push('```');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown Rendering
// ---------------------------------------------------------------------------

function renderTaskInstructions(task, sprintNumber) {
  if (task.isIntegration) {
    return `Execute the \`sprint-integration\` workflow for \`${sprintNumber}\`.`;
  }
  if (task.isQA) {
    return `Execute the \`plan-qa-testing\` workflow for \`${sprintNumber}\`.`;
  }
  if (task.isCodeReview) {
    return `Execute the \`sprint-code-review\` workflow for \`${sprintNumber}\`.`;
  }
  if (task.isRetro) {
    return `Execute the \`sprint-retro\` workflow for \`${sprintNumber}\`.`;
  }
  return task.instructions;
}

function renderTask(task, sprintNumber, chatNumber, stepNumber, taskIdToNumber) {
  const taskNumber = `${sprintNumber}.${chatNumber}.${stepNumber}`;
  const skills = task.skills.length > 0 ? task.skills.join(', ') : 'N/A';
  const instructions = renderTaskInstructions(task, sprintNumber);

  let protocol = `**AGENT EXECUTION PROTOCOL (STRICT ADHERENCE REQUIRED):**\n`;
  if (task.dependsOn && task.dependsOn.length > 0) {
    // Sort dependencies numerically for readability
    const depsList = task.dependsOn
      .map(id => taskIdToNumber.get(id))
      .sort()
      .map(num => `\`${num}\``)
      .join(', ');
    protocol += `1. **Prerequisite Check**: Execute the \`verify-sprint-prerequisites\` workflow for sprint step \`${taskNumber}\`.\n`;
    protocol += `   - **Dependencies**: ${depsList}\n`;
    protocol += `2. **Execution**: Perform the task instructions below.\n`;
    protocol += `3. **Finalization**: Execute the \`finalize-sprint-task\` workflow explicitly for sprint step \`${taskNumber}\`.`;
  } else {
    protocol += `1. **Execution**: Perform the task instructions below.\n`;
    protocol += `2. **Finalization**: Execute the \`finalize-sprint-task\` workflow explicitly for sprint step \`${taskNumber}\`.`;
  }

  return `- [ ] **${taskNumber} ${task.title}**

**Mode:** ${task.mode} **Model:** ${task.model}

\`\`\`text
Sprint ${taskNumber}: Adopt the \`${task.persona}\` persona from \`.agents/personas/\`.

${protocol}

**Active Skills:** \`${skills}\`

${instructions}
\`\`\``;
}

function renderChatSession(session, sprintNumber, taskIdToNumber) {
  const lines = [];

  const modeDisplay = (session.mode === 'PMBookend' || session.mode === 'SequentialBookend') ? 'Sequential' : session.mode;
  lines.push(`### ${session.icon} Chat Session ${session.chatNumber}: ${session.label} (${modeDisplay})`);
  lines.push('');

  // Compute scope annotation for any session type
  const uniqueScopes = [...new Set(session.tasks.map((t) => t.scope).filter(Boolean))];
  const scopeNote = uniqueScopes.length === 1 ? ` This session operates exclusively within \`${uniqueScopes[0]}\`.` : '';

  if (session.mode === 'Concurrent') {
    lines.push(
      `_Execution Rule: Open a NEW chat window. This session runs concurrently with other sessions at the same level.${scopeNote}_`,
    );
  } else if (session.mode === 'PMBookend') {
    lines.push(
      `_Execution Rule: Run this in the primary PM planning chat once all PRs are merged._`,
    );
  } else if (session.mode === 'SequentialBookend') {
    lines.push(
      `_Execution Rule: Open a NEW chat window after code complete._`,
    );
  } else {
    lines.push(
      `_Execution Rule: These tasks must be run sequentially in a single chat window.${scopeNote}_`,
    );
  }
  lines.push('');

  for (let i = 0; i < session.tasks.length; i++) {
    const task = session.tasks[i];
    lines.push(renderTask(task, sprintNumber, session.chatNumber, i + 1, taskIdToNumber));
    lines.push('');
  }

  return lines.join('\n');
}

export function renderPlaybook(manifest, chatSessions, chatDeps) {
  const lines = [];
  const sn = manifest.sprintNumber;

  // Pad sprint number for directory path
  const paddedSprint = String(sn).padStart(3, '0');

  // Title
  lines.push(`# Sprint ${sn} Playbook: ${manifest.sprintName}`);
  lines.push('');
  lines.push(`> **Playbook Path**: \`docs/sprints/sprint-${paddedSprint}/playbook.md\``);
  lines.push('');

  // Summary
  lines.push('## Sprint Summary');
  lines.push('');
  lines.push(manifest.summary);
  lines.push('');

  // Execution Flow
  lines.push('## Fan-Out Execution Flow');
  lines.push('');
  lines.push(generateMermaid(chatSessions, chatDeps));
  lines.push('');

  // Pre-compute reverse mapping for explicit dependency injection
  const taskIdToNumber = new Map();
  for (const session of chatSessions) {
    for (let i = 0; i < session.tasks.length; i++) {
      const task = session.tasks[i];
      taskIdToNumber.set(task.id, `${sn}.${session.chatNumber}.${i + 1}`);
    }
  }

  // Chat Sessions
  for (const session of chatSessions) {
    lines.push(renderChatSession(session, sn, taskIdToNumber));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function generateFromManifest(manifest, options = {}) {
  const { agentsDir } = options;

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
  const { adjacency } = buildGraph(manifest.tasks);
  const cycle = detectCycle(adjacency);
  if (cycle) {
    throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`);
  }

  // 4. Assign layers
  const layers = assignLayers(adjacency);

  // 5. Group into Chat Sessions
  const chatSessions = groupIntoChatSessions(manifest.tasks, layers, adjacency);

  // 6. Compute cross-chat dependencies
  const chatDeps = computeChatDependencies(chatSessions, adjacency);

  // 7. Render
  const markdown = renderPlaybook(manifest, chatSessions, chatDeps);

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

  const sprintDir = path.join(PROJECT_ROOT, 'docs', 'sprints', `sprint-${sprintArg}`);
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
