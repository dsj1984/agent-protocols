/**
 * Renderer.js
 * Extracted rendering logic for Mermaid diagrams and Playbook Markdown format.
 */

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
  const statusLegend = '⬜ Not Started  <br />🟩 Complete';
  const iconLegend = '🗄️ DB | 🌐 Web | 📱 Mobile | 🧪 Test <br />📝 Docs | 🛡️ Ops | ⚙️ Gen';
  lines.push(`    Legend["${statusLegend} <br />---<br /> ${iconLegend}"]:::LegendNode`);

  // Define styles
  lines.push('    %% Style Definitions %%');
  lines.push('    classDef not_started fill:#d1d5db,stroke:#9ca3af,color:#1f2937');
  lines.push('    classDef complete fill:#16a34a,stroke:#059669,color:#ffffff');
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

export function renderPlaybook(manifest, chatSessions, chatDeps) {
  const sprintNum = String(manifest.sprintNumber).padStart(3, '0');
  
  let md = `# Sprint ${sprintNum} Playbook: ${manifest.sprintName}\n\n`;
  md += `> **Playbook Path:** docs/sprints/sprint-${sprintNum}/playbook.md\n>\n`;
  md += `> **Objective:** ${manifest.summary}\n>\n`;
  md += `> **Mode:** ${manifest.mode} (LLM Strategy)\n\n`;

  // Summary
  md += `## Sprint Summary\n\n`;
  md += `${manifest.summary}\n\n`;

  // Pipeline Topology section
  md += `## Fan-Out Execution Flow\n\n`;
  md += generateMermaid(chatSessions, chatDeps);
  md += `\n\n`;

  // Pre-compute reverse mapping for explicit dependency injection
  const paddedSprint = String(manifest.sprintNumber).padStart(3, '0');
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
    const sessionLabel = `${session.chatNumber}`; // simplifying
    
    // Playbook header needs Playbook Path to be perfectly backward compatible
    md += `### ${session.icon} Chat Session ${session.chatNumber}: ${session.label}\n\n`;

    // Emit chat-level dependencies
    const deps = chatDeps.get(session.chatNumber) || [];
    if (deps.length > 0) {
      md += `> **⚠️ PREREQUISITE:** Do not start this session until **Chat(s) ${deps.join(', ')}** are fully marked as Complete.\n\n`;
    }

    // Emit tasks
    md += `#### Tasks\n\n`;
    for (const task of session.tasks) {
      md += `- [ ] **${taskIdToNumber.get(task.id)}** ${task.title}\n`;
      if (task.scope) {
        md += `  - **Scope**: \`${task.scope}\`\n`;
      }
      
      const requiresApproval = task.requires_approval || Boolean(task.isIntegration || task.isCloseSprint);
      if (requiresApproval) {
        md += `  - **HITL Check**: ⚠️ Requires explicit user approval before execution.\n`;
      }

      if (task.dependsOn && task.dependsOn.length > 0) {
        md += `  - **Dependencies**: ${task.dependsOn.map(id => `\`${taskIdToNumber.get(id)}\``).join(', ')}\n`;
      }
    }
    md += `\n`;

    // Code Block for the Agent
    md += `#### Agent Prompt\n\n`;
    md += `\`\`\`markdown\n`;
    md += `You are an agent acting as the **${session.tasks[0].persona}** persona.\n`;
    
    // Aggregate distinct skills
    const allSkills = new Set();
    session.tasks.forEach(t => t.skills.forEach(s => allSkills.add(s)));
    if (allSkills.size > 0) {
      md += `You have the following skills loaded: ${[...allSkills].map(s => `\`${s}\``).join(', ')}.\n`;
    }
    md += `\n`;

    if (deps.length > 0 || session.tasks.some(t => t.dependsOn && t.dependsOn.length > 0)) {
       md += `**AGENT EXECUTION PROTOCOL:**\n`;
       md += `Before beginning work, you MUST run the pre-flight verification script to ensure all dependencies are committed.\n`;
       md += `Execute \`/[.agents/workflows/sprint-verify-task-prerequisites.md]\` or optionally run:\n`;
       md += `\`node .agents/scripts/verify-prereqs.js docs/sprints/sprint-${sprintNum}/playbook.md ${sprintNum}.${session.chatNumber}.${session.tasks[0].id}\`\n`;
       md += `If the script fails, STOP immediately and ask the user to complete the blocking tasks.\n\n`;
    }

    md += `**Instructions:**\n`;
    for (const task of session.tasks) {
      md += `1. **Task ${task.id}:** ${renderTaskInstructions(task, sprintNum)}\n`;
      md += `   - **Mark Executing**: Update the playbook task to \`[/]\`\n`;
    }
    
    md += `\n**Close-out:**\n`;
    md += `Once all instructions above are fully verified and committed, run the finalization workflow to track state:\n`;
    md += `\`/[.agents/workflows/sprint-finalize-task.md]\`\n`;
    
    md += `\`\`\`\n\n`;
  }

  return md;
}
