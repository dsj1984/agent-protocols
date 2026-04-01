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

  // Validate bookend persona and rules
  for (const task of manifest.tasks) {
    if (task.isIntegration) {
      if (task.persona !== 'engineer') errors.push(`Task "${task.id}": isIntegration requires 'engineer' persona.`);
      if (!task.skills.includes('architecture/monorepo-path-strategist')) errors.push(`Task "${task.id}": isIntegration requires 'architecture/monorepo-path-strategist' skill.`);
      if (!task.skills.includes('devops/git-flow-specialist')) errors.push(`Task "${task.id}": isIntegration requires 'devops/git-flow-specialist' skill.`);
    }
    if (task.isQA) {
      if (task.persona !== 'qa-engineer') errors.push(`Task "${task.id}": isQA requires 'qa-engineer' persona.`);
    }
    if (task.isCodeReview) {
      if (task.persona !== 'architect') errors.push(`Task "${task.id}": isCodeReview requires 'architect' persona.`);
      if (!task.skills.includes('devops/git-flow-specialist')) errors.push(`Task "${task.id}": isCodeReview requires 'devops/git-flow-specialist' skill.`);
    }
    if (task.isRetro) {
      if (task.persona !== 'product') errors.push(`Task "${task.id}": isRetro requires 'product' persona.`);
      if (!task.skills.includes('architecture/markdown')) errors.push(`Task "${task.id}": isRetro requires 'architecture/markdown' skill.`);
    }
    if (task.isCloseSprint) {
      if (task.persona !== 'devops-engineer') errors.push(`Task "${task.id}": isCloseSprint requires 'devops-engineer' persona.`);
      if (!task.skills.includes('devops/git-flow-specialist')) errors.push(`Task "${task.id}": isCloseSprint requires 'devops/git-flow-specialist' skill.`);
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

/**
 * Performs transitive reduction on a DAG.
 * Removes edges (u, v) if there exists a path from u to v of length > 1.
 */
export function transitiveReduction(adjacency) {
  const reduced = new Map();
  const nodes = [...adjacency.keys()];
  
  // Initialize reduced graph with original edges
  for (const node of nodes) {
    reduced.set(node, new Set(adjacency.get(node) || []));
  }

  // Floyd-Warshall style transitive reduction
  for (const k of nodes) {
    for (const i of nodes) {
      if (reduced.get(i).has(k)) {
        for (const j of nodes) {
          if (reduced.get(k).has(j)) {
            // Path i -> k -> j exists, so direct edge i -> j is redundant
            reduced.get(i).delete(j);
          }
        }
      }
    }
  }

  // Convert back to Array format
  const result = new Map();
  for (const [node, deps] of reduced.entries()) {
    result.set(node, [...deps]);
  }
  return result;
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
    const scopeGroups = new Map();
    for (const task of tasksInLayer) {
      const scope = task.scope || '__unscoped__';
      if (!scopeGroups.has(scope)) scopeGroups.set(scope, []);
      scopeGroups.get(scope).push(task);
    }

    const scopeKeys = [...scopeGroups.keys()].sort();
    const isLayerConcurrent = scopeKeys.length > 1 || (tasksInLayer.length > 1 && !tasksInLayer[0].scope);

    if (scopeKeys.length === 1 && scopeKeys[0] === '__unscoped__' && tasksInLayer.length > 1) {
      for (const task of tasksInLayer) {
        chatSessions.push({
          chatNumber: chatNumber++,
          label: task.title,
          icon: selectIcon({ tasks: [task] }),
          mode: 'Concurrent',
          layer,
          tasks: [task],
        });
      }
    } else {
      for (const scope of scopeKeys) {
        const scopeTasks = scopeGroups.get(scope);
        const label = scope !== '__unscoped__'
          ? scopeTasks.length === 1 ? scopeTasks[0].title : `${scope} Tasks`
          : scopeTasks[0].title;

        chatSessions.push({
          chatNumber: chatNumber++,
          label,
          icon: selectIcon({ tasks: scopeTasks }),
          mode: isLayerConcurrent ? 'Concurrent' : 'Sequential',
          layer,
          tasks: scopeTasks,
        });
      }
    }
  }
  return chatSessions;
}

/**
 * Appends deterministic bookend sessions (Integration, QA, Review, Retro, Close).
 */
function appendBookendSessions(chatSessions, bookendTasks, regularTasks, chatNumberStart) {
  let chatNumber = chatNumberStart;
  const bookendStages = [
    { key: 'isIntegration', label: 'Sprint Integration & Sync', mode: 'SequentialBookend' },
    { key: 'isQA', label: 'QA & E2E Testing', mode: 'SequentialBookend' },
    { key: 'isCodeReview', label: 'Code Review', mode: 'PMBookend' },
    { key: 'isRetro', label: 'Sprint Retrospective', mode: 'PMBookend' },
    { key: 'isCloseSprint', label: 'Sprint Close Out', mode: 'PMBookend' },
  ];

  const hasOutgoing = new Set();
  for (const task of regularTasks) {
    for (const dep of task.dependsOn) hasOutgoing.add(dep);
  }
  let currentDeps = regularTasks.filter((t) => !hasOutgoing.has(t.id)).map((t) => t.id);

  for (const stage of bookendStages) {
    const stageTasks = bookendTasks.filter((t) => t[stage.key]);
    if (stageTasks.length > 0) {
      stageTasks[0].dependsOn = currentDeps;
      for (let i = 1; i < stageTasks.length; i++) {
        stageTasks[i].dependsOn = [stageTasks[i - 1].id];
      }

      chatSessions.push({
        chatNumber: chatNumber++,
        label: stage.label,
        icon: selectIcon({ tasks: stageTasks }),
        mode: stage.mode,
        layer: Infinity,
        tasks: stageTasks,
      });
      currentDeps = [stageTasks[stageTasks.length - 1].id];
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

  // Apply transitive reduction to chat-level dependencies
  return transitiveReduction(chatDeps);
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

  // Define Legend (Compact single node with line breaks)
  const statusLegend = '⬜ Not Started  <br />🟨 Executing  <br />🟦 Committed  <br />🟩 Complete';
  const iconLegend = '🗄️ DB | 🌐 Web | 📱 Mobile | 🧪 Test <br />📝 Docs | 🛡️ Ops | ⚙️ Gen';
  lines.push(`    Legend["${statusLegend} <br />---<br /> ${iconLegend}"]:::LegendNode`);

  // Define styles
  lines.push('    %% Style Definitions %%');
  lines.push('    classDef not_started fill:#d1d5db,stroke:#9ca3af,color:#1f2937');
  lines.push('    classDef executing fill:#f59e0b,stroke:#d97706,color:#1f2937');
  lines.push('    classDef committed fill:#3b82f6,stroke:#2563eb,color:#ffffff');
  lines.push('    classDef complete fill:#16a34a,stroke:#059669,color:#ffffff');
  lines.push('    classDef LegendNode fill:transparent,stroke:transparent,font-size:12px');
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
  if (task.isCloseSprint) {
    return `Execute the \`sprint-close-out\` workflow for \`${sprintNumber}\`.`;
  }
  return task.instructions;
}

function renderTask(task, sprintNumber, chatNumber, stepNumber, taskIdToNumber) {
  const paddedSn = String(sprintNumber).padStart(3, '0');
  const taskNumber = `${paddedSn}.${chatNumber}.${stepNumber}`;
  const skills = task.skills.length > 0 ? task.skills.join(', ') : 'N/A';
  const instructions = renderTaskInstructions(task, sprintNumber);

  let protocol = `**AGENT EXECUTION PROTOCOL (STRICT ADHERENCE REQUIRED):**\n`;
  protocol += `1. **Environment Reset**: Ensure you are on the sprint base branch: \`git checkout sprint-${paddedSn} ; git pull\`. Verify with \`git branch --show-current\`. If the result is \`main\` or \`master\`, **STOP** and alert the user.\n`;
  if (task.dependsOn && task.dependsOn.length > 0) {
    // Sort dependencies numerically for readability
    const depsList = task.dependsOn
      .map(id => taskIdToNumber.get(id))
      .filter(Boolean) // Safety check for reduced tasks
      .sort()
      .map(num => `\`${num}\``)
      .join(', ');
    protocol += `2. **Mark Executing**: Update the playbook — change your task checkbox to \`- [~]\` and set the Mermaid class for node \`C${chatNumber}\` to \`executing\` (if not already). Commit and push the state change.\n`;
    protocol += `3. **Prerequisite Check**: Execute the \`sprint-verify-task-prerequisites\` workflow for sprint step \`${taskNumber}\`.\n`;
    protocol += `   - **Dependencies**: ${depsList}\n`;
    protocol += `4. **Execution**: Perform the task instructions below.\n`;
    protocol += `5. **Finalization**: Execute the \`sprint-finalize-task\` workflow explicitly for sprint step \`${taskNumber}\`.`;
  } else {
    protocol += `2. **Mark Executing**: Update the playbook — change your task checkbox to \`- [~]\` and set the Mermaid class for node \`C${chatNumber}\` to \`executing\` (if not already). Commit and push the state change.\n`;
    protocol += `3. **Execution**: Perform the task instructions below.\n`;
    protocol += `4. **Finalization**: Execute the \`sprint-finalize-task\` workflow explicitly for sprint step \`${taskNumber}\`.`;
  }

  let secondChoice = task.secondaryModel || (task.mode === 'Planning' ? 'Gemini 3.1 Pro (High)' : 'Gemini 3 Flash');
  if (secondChoice === task.model) {
    // Enforce uniqueness if default falls back to the same as first choice
    secondChoice = task.model.includes('Claude') ? 'Gemini 3.1 Pro (High)' : 'Claude Sonnet 4.6 (Thinking)';
  }

  return `- [ ] **${taskNumber} ${task.title}**

**Mode:** ${task.mode} | **Model (First Choice):** ${task.model} | **Model (Second Choice):** ${secondChoice}

\`\`\`text
Sprint ${taskNumber}: Adopt the \`${task.persona}\` persona from \`.agents/personas/\`.

${protocol}

**Active Skills:** \`${skills}\`

${instructions}
\`\`\``;
}

function renderChatSession(session, sprintNumber, taskIdToNumber) {
  const lines = [];
  const paddedSn = String(sprintNumber).padStart(3, '0');

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
      `_Execution Rule: Continue sequentially in the current chat window once all PRs are merged._`,
    );
  } else if (session.mode === 'SequentialBookend') {
    lines.push(
      `_Execution Rule: Continue sequentially in the current chat window after code complete._`,
    );
  } else {
    lines.push(
      `_Execution Rule: Continue sequentially in the current chat window.${scopeNote}_`,
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
  const paddedSprint = String(sn).padStart(3, '0');

  // Title
  lines.push(`# Sprint ${paddedSprint} Playbook: ${manifest.sprintName}`);
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
      taskIdToNumber.set(task.id, `${paddedSprint}.${session.chatNumber}.${i + 1}`);
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

  // 6. Apply transitive reduction to individual tasks before rendering instructions
  const reducedAdjacency = transitiveReduction(adjacency);
  for (const task of manifest.tasks) {
    task.dependsOn = reducedAdjacency.get(task.id) || [];
  }

  // 7. Compute cross-chat dependencies
  const chatDeps = computeChatDependencies(chatSessions, adjacency);

  // 7. Render
  const { markdown } = { markdown: renderPlaybook(manifest, chatSessions, chatDeps) }; // Simplified internal return for consistency with structure below

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

  // Normalize to 3 digits for robust directory resolution
  const paddedSprint = String(sprintNumber).padStart(3, '0');
  
  // Try finding it with 3 digits first (new standard)
  let sprintDir = path.join(PROJECT_ROOT, 'docs', 'sprints', `sprint-${paddedSprint}`);
  
  // Robustness: Fallback to the original unpadded arg if it exists and the padded one doesn't
  if (!fs.existsSync(sprintDir)) {
    const unpaddedDir = path.join(PROJECT_ROOT, 'docs', 'sprints', `sprint-${sprintArg}`);
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
