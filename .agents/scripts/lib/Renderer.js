/**
 * Renderer.js
 * Extracted rendering logic for Mermaid diagrams and Playbook Markdown format.
 */
import fs from 'node:fs';
import path from 'node:path';

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
// Markdown Rendering
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

function getGoldenExamples(options = {}) {
  const root = options.goldenExamplesRoot || 'temp/golden-examples';
  const goldenDir = path.join(process.cwd(), root);
  if (!fs.existsSync(goldenDir)) return "";
  
  try {
    const files = fs.readdirSync(goldenDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) return "";
    
    // Select last 2 for recent few-shot reinforcement
    const selection = files.slice(-2);
    let block = `\n=== GOLDEN EXAMPLES (FEW-SHOT) ===\n`;
    block += `Refer to these historical examples of zero-friction task completions to align your style and patterns with the project standards.\n\n`;
    
    for (const file of selection) {
      const content = fs.readFileSync(path.join(goldenDir, file), 'utf8');
      block += `---\n${content}\n`;
    }
    return block;
  } catch {
    return "";
  }
}

export function renderPlaybook(manifest, chatSessions, chatDeps, options = {}) {
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

  // Summary
  md += `## Sprint Summary\n\n`;
  md += `${manifest.summary}\n\n`;

  // Pipeline Topology section
  md += `## Fan-Out Execution Flow\n\n`;
  md += generateMermaid(chatSessions, chatDeps);
  md += `\n\n`;

  // Pre-compute reverse mapping for explicit dependency injection
  const paddedSprint = String(manifest.sprintNumber).padStart(padding, '0');
  const taskIdToNumber = new Map();
  for (const session of chatSessions) {
    for (let i = 0; i < session.tasks.length; i++) {
        const task = session.tasks[i];
        taskIdToNumber.set(task.id, `${paddedSprint}.${session.chatNumber}.${i + 1}`);
    }
  }

  // Grouped Chat Sessions
  md += `## 📋 Execution Plan\n\n`;

  for (const session of chatSessions) {
    // Playbook header needs Playbook Path to be perfectly backward compatible
    md += `### ${session.icon} Chat Session ${session.chatNumber}: ${session.label}\n\n`;

    // Emit chat-level dependencies
    const deps = chatDeps.get(session.chatNumber) || [];
    if (deps.length > 0) {
      md += `> **⚠️ PREREQUISITE:** Do not start this session until the tasks in **Chat(s) ${deps.join(', ')}** are finished (this is verified automatically by your pre-flight script).\n\n`;
    }

    // Emit unified task blocks
    let taskIndex = 0;
    for (const task of session.tasks) {
      const fullTaskId = taskIdToNumber.get(task.id);
      
      // Task Header & Checklist (No leading dash)
      md += `[ ] **${fullTaskId}** ${task.title}\n`;
      
      // Task Metadata
      md += `  - **Mode**: ${task.mode}\n`;
      md += `  - **Model**: ${task.model}${task.secondaryModel && !task.model.includes(task.secondaryModel) ? ` OR ${task.secondaryModel}` : ''}\n`;

      if (task.scope) {
        md += `  - **Scope**: \`${task.scope}\`\n`;
      }
      
      const requiresApproval = task.requires_approval || Boolean(task.isIntegration || task.isCloseSprint);
      if (requiresApproval) {
        md += `  - **HITL Check**: ⚠️ Requires explicit user approval before execution.\n`;
      }

      // Dependencies (Show "None" if empty)
      const depList = task.dependsOn && task.dependsOn.length > 0
        ? task.dependsOn.map(id => `\`${taskIdToNumber.get(id)}\``).join(', ')
        : 'None';
      md += `  - **Dependencies**: ${depList}\n\n`;

      // Agent Prompt
      md += `\`\`\`\`markdown\n`;
      md += `=== SYSTEM PROTOCOL & CAPABILITIES ===\n\n`;
      md += `**AGENT EXECUTION PROTOCOL:**\n`;
      
      const taskDeps = task.dependsOn && task.dependsOn.length > 0;
      const chatHasDeps = deps.length > 0;
      const hasImplicitDeps = taskIndex > 0;
      
      // Enforce universal pre-flight validation (v3.3.1)
      md += `Before beginning work, you MUST run the pre-flight verification script to ensure all dependencies are committed.\n`;
      md += `Read and strictly follow the steps defined in \`.agents/workflows/sprint-verify-task-prerequisites.md\` or run the manual verification script for your specific task.\n`;
      md += `If the script fails, STOP immediately and ask the user to complete the blocking tasks.\n\n`;

      md += `**Branching:**\n`;
      md += `All task work MUST occur on the branch specified in your instructions.\n`;
      md += `If this task depends on previous tasks, ensure you have fetched the latest remote state (\`git fetch origin\`) and merged or checked out their respective feature branches before beginning work.\n\n`;

      md += `**Close-out:**\n`;
      md += `1. **Complete & Finalize**: All code must be committed and pushed via the standard workflow. Read and strictly follow the steps defined in \`.agents/workflows/sprint-finalize-task.md\` to track state and notify the team.\n`;
      md += `2. **Error Recovery**: If you encounter an unresolvable error, execute: \`node .agents/scripts/update-task-state.js ${fullTaskId} blocked\` and alert the user immediately.\n\n`;

      md += `=== VOLATILE TASK CONTEXT ===\n\n`;
      md += `**Persona**: ${task.persona}\n`;

      const skillList = task.skills || [];
      if (skillList.length > 0) {
        md += `**Loaded Skills**: ${skillList.map((s) => `\`${s}\``).join(', ')}\n`;
      }
      md += `**Sprint / Session**: Sprint ${sprintNum} | Chat Session ${session.chatNumber}\n\n`;

      if (requiresApproval) {
        md += `> **🚨 HITL REQUIRED:** STOP and explicitly ask the user for approval via chat before proceeding with execution or commits.\n\n`;
      }

      // Enforce universal task-specific validation line
      md += `**Pre-flight Task Validation (Run this first):**\n`;
      md += `\`node .agents/scripts/verify-prereqs.js ${docsRoot}/sprint-${sprintNum}/playbook.md ${fullTaskId} ${options.taskStateRoot || 'temp/task-state'}\`\n\n`;

      const targetBranch = task.isIntegration || task.isQA || task.isCodeReview || task.isRetro || task.isCloseSprint ? `sprint-${sprintNum}` : `task/sprint-${sprintNum}/${task.id}`;
      const taskPattern = task.pattern || 'default';

      md += `**Perception-Action Event Stream Protocol:**\n`;
      md += `All environmental interactions MUST be streamed. Start the loop via:\n`;
      md += `\`node .agents/scripts/run-agent-loop.js ${fullTaskId} --branch ${targetBranch} --pattern ${taskPattern}\`\n`;
      md += `Feed Atomic Action JSON payloads into its stdin. Reference \`.agents/schemas/atomic-action-schema.json\` for the format. Do not use random bash execution.\n\n`;

      md += `**Instructions:**\n`;
      md += `1. **Task ${task.id}:**\n`;
      const instLines = renderTaskInstructions(task, sprintNum).split('\n');
      for (const line of instLines) {
        if (!line.trim()) continue;
        md += line.trim().startsWith('-') ? `   ${line.trim()}\n` : `   - ${line.trim()}\n`;
      }

      md += `   - **Mark Executing**: \`node .agents/scripts/update-task-state.js ${fullTaskId} executing\`\n`;

      if (task.isCodeReview) {
        md += `\n**Manual Fix Finalization (AGENT PROMPT):**\n`;
        md += `If manual fixes were implemented during this review, YOU MUST run this realignment prompt to synchronize them before proceeding to QA:\n`;
        md += `\`\`\`markdown\n`;
        md += `=== VOLATILE TASK CONTEXT ===\n\n`;
        md += `**Persona**: devops-engineer\n`;
        md += `**Loaded Skills**: \`devops/git-flow-specialist\`\n`;
        md += `\n=== INSTRUCTIONS ===\n\n`;
        md += `I have completed the manual implementation of architectural fixes from the Code Review. Please execute the final synchronization to align the repository:\n\n`;
        md += `1. **Commit Review Fixes**: Stage and commit any uncommitted architectural fixes: \`git add . && (git diff --staged --quiet || git commit -m "fix(review): implement architectural code review feedback")\`\n`;
        md += `2. **Push Default Base**: Push your fixes natively to the integration branch: \`git push origin HEAD\`\n`;
        md += `3. **Update State**: Mark the code review task as passed to generate the test receipt: \`node .agents/scripts/update-task-state.js ${fullTaskId} passed\`\n`;
        md += `\`\`\`\n`;
      }

      md += getGoldenExamples(options);

      md += `\`\`\`\`\n\n`;
      taskIndex++;
    }
  }

  return md;
}
