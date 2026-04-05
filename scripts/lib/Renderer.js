/**
 * Renderer.js
 * Extracted rendering logic for Mermaid diagrams and Playbook Markdown format.
 *
 * renderPlaybook() is decomposed into focused sub-functions that are each
 * independently testable:
 *   - renderHeader(manifest, options)           — title block + summary
 *   - generateMermaid(chatSessions, chatDeps)   — topology diagram (existing)
 *   - renderTaskBlock(task, session, ...)       — full per-task block
 *   - renderPlaybook(...)                       — thin composition layer
 */
import fs from 'node:fs';
import path from 'node:path';
import { isBookendTask } from './task-utils.js';

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
    lines.push(`    class ${nodeId} pending`);
  }

  // Define edges
  const edgesEmitted = new Set();
  for (const session of chatSessions) {
    const deps = chatDeps.get(session.chatNumber) || [];
    for (const depChat of deps) {
      const edgeKey = `C${depChat}->C${session.chatNumber}`;
      if (!edgesEmitted.has(edgeKey)) {
        lines.push(`    C${depChat} --> C${session.chatNumber}`);
        edgesEmitted.add(edgeKey);
      }
    }
  }

  // Define Legend (Compact single node with line breaks)
  const statusLegend = '⬜ Pending Integration  <br />🟩 Integrated (Merged)';
  const iconLegend = '🗄️ DB | 🌐 Web | 📱 Mobile | 🧪 Test <br />📝 Docs | 🛡️ Ops | ⚙️ Gen';
  lines.push(`    Legend["${statusLegend} <br />---<br /> ${iconLegend}"]:::LegendNode`);

  // Define styles
  lines.push('    %% Style Definitions %%');
  lines.push('    classDef pending fill:#d1d5db,stroke:#9ca3af,color:#1f2937');
  lines.push('    classDef integrated fill:#16a34a,stroke:#059669,color:#ffffff');
  lines.push('    classDef LegendNode fill:transparent,stroke:transparent,font-size:12px');
  lines.push('```');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown Rendering — Sub-functions
// ---------------------------------------------------------------------------

export function renderTaskInstructions(task, sprintNumber) {
  if (task.isIntegration) {
    return `Execute the \`sprint-integration\` workflow for \`${sprintNumber}\`.`;
  }
  if (task.isQA) {
    return `Execute the \`sprint-testing\` workflow for \`${sprintNumber}\`.`;
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

/**
 * Renders the playbook header block: title, metadata blockquote, and sprint
 * summary section.
 *
 * @param {object} manifest
 * @param {object} options
 * @returns {string}
 */
export function renderHeader(manifest, options = {}) {
  const padding = options.sprintNumberPadding || 3;
  const docsRoot = options.sprintDocsRoot || 'docs/sprints';
  const sprintNum = String(manifest.sprintNumber).padStart(padding, '0');

  let md = `# Sprint ${sprintNum} Playbook: ${manifest.sprintName}\n\n`;
  md += `> **Playbook Path:** ${docsRoot}/sprint-${sprintNum}/playbook.md\n>\n`;
  if (options.protocolVersion) {
    md += `> **Protocol Version:** v${options.protocolVersion}\n>\n`;
  }
  md += `> **Objective:** ${manifest.summary}\n>\n`;
  if (manifest.mode) {
    md += `> **Mode:** ${manifest.mode} (LLM Strategy)\n\n`;
  }

  md += `## Sprint Summary\n\n`;
  md += `${manifest.summary}\n\n`;

  return md;
}

/**
 * Renders the full block for a single task: metadata, agent prompt with
 * pre-flight, branching, instructions, close-out, and optional manual-fix
 * block for code-review tasks.
 *
 * @param {object} task
 * @param {object} session             — the parent chat session
 * @param {Map}    taskIdToNumber      — task.id → "NNN.C.S" string
 * @param {Array}  chatDepsForSession  — chat-level dep numbers for this session
 * @param {number} taskIndex           — 0-based index within the session
 * @param {object} options             — rendering options (paths, padding, etc.)
 * @returns {string}
 */
export function renderTaskBlock(task, session, taskIdToNumber, chatDepsForSession, taskIndex, options = {}) {
  const padding = options.sprintNumberPadding || 3;
  const docsRoot = options.sprintDocsRoot || 'docs/sprints';
  const scriptsRoot = options.scriptsRoot || '.agents/scripts';
  const workflowsRoot = options.workflowsRoot || '.agents/workflows';
  const schemasRoot = options.schemasRoot || '.agents/schemas';
  const sprintNum = String(session.tasks[0]?.id ? '' : '').padStart(0) || String(options._sprintNum || '').padStart(padding, '0');

  // Derive sprint number from the taskIdToNumber map (e.g. "099.1.1" → "099")
  const fullTaskId = taskIdToNumber.get(task.id);
  const derivedSprintNum = fullTaskId ? fullTaskId.split('.')[0] : sprintNum;

  const requiresApproval = task.requires_approval || Boolean(task.isIntegration || task.isCloseSprint);
  const depList = task.dependsOn && task.dependsOn.length > 0
    ? task.dependsOn.map((id) => `\`${taskIdToNumber.get(id)}\``).join(', ')
    : 'None';

  let md = '';

  // Task Header & Checklist
  md += `[ ] **${fullTaskId}** ${task.title}\n`;

  // Auto-split indicator
  if (task._splitFrom) {
    md += `  - **🔀 Auto-split**: Part ${task._splitIndex}/${task._splitTotal} from \`${task._splitFrom}\`\n`;
  }

  // Task Metadata
  md += `  - **Mode**: ${task.mode}\n`;
  md += `  - **Model**: ${task.model}${task.secondaryModel ? ` || ${task.secondaryModel}` : ''}\n`;

  if (task.scope) {
    md += `  - **Scope**: \`${task.scope}\`\n`;
  }

  if (requiresApproval) {
    md += `  - **HITL Check**: ⚠️ Requires explicit user approval before execution.\n`;
  }

  md += `  - **Dependencies**: ${depList}\n\n`;

  // Agent Prompt (fenced block)
  md += `\`\`\`\`markdown\n`;
  md += `=== SYSTEM PROTOCOL & CAPABILITIES ===\n\n`;
  md += `**AGENT EXECUTION PROTOCOL:**\n`;
  md += `Before beginning work, you MUST run the pre-flight verification script to ensure all dependencies are committed.\n`;
  md += `Read and strictly follow the steps defined in \`${workflowsRoot}/sprint-verify-task-prerequisites.md\` or run the manual verification script for your specific task.\n`;
  md += `If the script fails, STOP immediately and ask the user to complete the blocking tasks.\n\n`;

  md += `**Branching:**\n`;
  md += `All task work MUST occur on the branch specified in your instructions.\n`;
  md += `If this task depends on previous tasks, ensure you have fetched the latest remote state (\`git fetch origin\`) and merged or checked out their respective feature branches before beginning work.\n`;

  // Render explicit git merge commands for non-bookend dependent tasks
  if (task.dependsOn && task.dependsOn.length > 0 && !isBookendTask(task)) {
    md += `**Required Merges (run after checkout):**\n`;
    for (const depId of task.dependsOn) {
      const depBranch = `task/sprint-${derivedSprintNum}/${depId}`;
      md += `- \`git merge origin/${depBranch}\`\n`;
    }
  }
  md += `\n`;

  md += `**Close-out:**\n`;
  md += `1. **Complete & Finalize**: All code must be committed and pushed via the standard workflow. Read and strictly follow the steps defined in \`${workflowsRoot}/sprint-finalize-task.md\` to track state and notify the team.\n`;
  md += `2. **Error Recovery**: If you encounter an unresolvable error, execute: \`node ${scriptsRoot}/update-task-state.js ${fullTaskId} blocked\` and alert the user immediately.\n\n`;

  md += `=== VOLATILE TASK CONTEXT ===\n\n`;
  md += `**Persona**: ${task.persona}\n`;

  const skillList = task.skills || [];
  if (skillList.length > 0) {
    md += `**Loaded Skills**: ${skillList.map((s) => `\`${s}\``).join(', ')}\n`;
  }
  md += `**Sprint / Session**: Sprint ${derivedSprintNum} | Chat Session ${session.chatNumber}\n\n`;

  if (requiresApproval) {
    md += `> **🚨 HITL REQUIRED:** STOP and explicitly ask the user for approval via chat before proceeding with execution or commits.\n\n`;
  }

  md += `**Pre-flight Task Validation (Run this first):**\n`;
  md += `\`node ${scriptsRoot}/verify-prereqs.js ${docsRoot}/sprint-${derivedSprintNum}/playbook.md ${fullTaskId} ${options.taskStateRoot || 'temp/task-state'}\`\n\n`;

  const branchTaskId = task._parentBranchId || task.id;
  const targetBranch = isBookendTask(task)
    ? `sprint-${derivedSprintNum}`
    : `task/sprint-${derivedSprintNum}/${branchTaskId}`;
  const taskPattern = task.pattern || 'default';

  md += `\n`;
  md += `**Perception-Action Event Stream Protocol:**\n`;
  md += `All environmental interactions MUST be streamed. Start the loop via:\n`;
  md += `\`node ${scriptsRoot}/run-agent-loop.js ${fullTaskId} --branch ${targetBranch} --pattern ${taskPattern}\`\n`;
  md += `Feed Atomic Action JSON payloads into its stdin. Reference \`${schemasRoot}/atomic-action-schema.json\` for the format. Do not use random bash execution.\n\n`;

  md += `**Instructions:**\n`;
  md += `1. **Task ${task.id}:**\n`;
  md += `   - **Mark Executing**: \`node ${scriptsRoot}/update-task-state.js ${fullTaskId} executing\`\n`;

  // Inject explicit file-reading instruction for non-bookend tasks
  if (!isBookendTask(task)) {
    md += `   - **Read Context**: Before implementing, fetch and ingest \`${docsRoot}/sprint-${derivedSprintNum}/prd.md\`, \`${docsRoot}/sprint-${derivedSprintNum}/tech-spec.md\`, the \`techStack\` section of \`.agentrc.json\`, and all Project Reference Documents listed in your global protocol (\`instructions.md\`). Do not hallucinate values.\n`;
  }

  const instLines = renderTaskInstructions(task, derivedSprintNum).split('\n');

  // Complexity warning for tasks that scored high but could not be auto-split
  if (task._complexityWarning) {
    md += `\n> **⚠️ COMPLEXITY WARNING (Score: ${task._complexityScore})**\n`;
    md += `> This task has been flagged as high-complexity. You MUST self-decompose\n`;
    md += `> into atomic sub-steps before writing any code. Each sub-step should\n`;
    md += `> modify no more than 5 files. Commit and push after each logical sub-step,\n`;
    md += `> not at the end. If you find yourself editing more than 5 files without\n`;
    md += `> committing, STOP and break the work into a smaller unit.\n\n`;
  }

  for (const line of instLines) {
    if (!line.trim()) continue;
    md += line.trim().startsWith('-') ? `   ${line.trim()}\n` : `   - ${line.trim()}\n`;
  }

  // Manual fix block for code-review tasks (FOR HUMAN OPERATOR)
  if (task.isCodeReview) {
    md += `\n**Manual Fix Finalization (FOR HUMAN OPERATOR — run in a separate terminal):**\n`;
    md += `If manual fixes were implemented during this review, the human operator MUST run the following commands in a separate terminal to synchronize before proceeding to QA:\n`;
    md += `\`\`\`bash\n`;
    md += `# 1. Stage and commit review fixes\n`;
    md += `git add .\n`;
    md += `node ${scriptsRoot}/git-commit-if-changed.js "fix(review): implement architectural code review feedback"\n`;
    md += `# 2. Push to integration branch\n`;
    md += `git push origin HEAD\n`;
    md += `# 3. Mark code review as passed\n`;
    md += `node ${scriptsRoot}/update-task-state.js ${fullTaskId} passed\n`;
    md += `\`\`\`\n`;
  }

  md += `\`\`\`\`\n\n`;
  return md;
}

// ---------------------------------------------------------------------------
// Playbook Top-level Renderer (thin composition layer)
// ---------------------------------------------------------------------------

export function renderPlaybook(manifest, chatSessions, chatDeps, options = {}) {
  const padding = options.sprintNumberPadding || 3;
  const sprintNum = String(manifest.sprintNumber).padStart(padding, '0');

  // Pass the derived sprint number through options so renderTaskBlock can use it
  const renderOptions = { ...options, _sprintNum: sprintNum };

  // Pre-compute reverse mapping: task.id → "NNN.C.S" string
  const taskIdToNumber = new Map();
  for (const session of chatSessions) {
    for (let i = 0; i < session.tasks.length; i++) {
      const task = session.tasks[i];
      taskIdToNumber.set(task.id, `${sprintNum}.${session.chatNumber}.${i + 1}`);
    }
  }

  let md = renderHeader(manifest, options);

  md += `## Fan-Out Execution Flow\n\n`;
  md += generateMermaid(chatSessions, chatDeps);
  md += `\n\n`;

  md += `## 📋 Execution Plan\n\n`;

  for (const session of chatSessions) {
    md += `### ${session.icon} Chat Session ${session.chatNumber}: ${session.label}\n\n`;

    // Chat-level dependency warning
    const deps = chatDeps.get(session.chatNumber) || [];
    if (deps.length > 0) {
      md += `> **⚠️ PREREQUISITE:** Do not start this session until the tasks in **Chat(s) ${deps.join(', ')}** are finished (this is verified automatically by your pre-flight script).\n\n`;
    }

    // Render each task block
    for (let taskIndex = 0; taskIndex < session.tasks.length; taskIndex++) {
      const task = session.tasks[taskIndex];
      md += renderTaskBlock(task, session, taskIdToNumber, deps, taskIndex, renderOptions);
    }
  }

  return md;
}
