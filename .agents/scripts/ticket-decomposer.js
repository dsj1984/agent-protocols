#!/usr/bin/env node
/**
 * ticket-decomposer.js
 *
 * Sprint 2B Work Breakdown Decomposition Script
 * Reads the PRD and Tech Spec of an Epic, decomposes them into a 3-level hierarchy
 * (Feature, Story, Task), and populates them into GitHub with proper linking.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createProvider } from './lib/provider-factory.js';
import { LLMClient } from './lib/llm-client.js';
import { resolveConfig } from './lib/config-resolver.js';

const DECOMPOSER_SYSTEM_PROMPT = `You are an expert Senior Project Manager and Orchestrator.
Your job is to take a Product Requirements Document (PRD) and a Technical Specification and decompose them into a highly-granular 3-level ticket hierarchy for an AI Agent to execute.

### HIERARCHY RULES:
1. **Features**: Large functional milestones (e.g., "Authentication Provider Integration").
2. **Stories**: Specific user-facing or architectural user stories (e.g., "Implement JWT Token Exchange"). 
   - MUST be nested under a Feature.
3. **Tasks**: Atomic, verifiable technical steps (e.g., "Add 'vendor_id' to users schema").
   - MUST be nested under a Story.

### LABEL CONVENTIONS:
- Every ticket must have a \`type::[feature|story|task]\` label.
- Every ticket must have a \`persona::[engineer|architect|qa-engineer|engineer-web|etc]\` label indicating WHO should execute it.

### OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON array of objects. No prose, no markdown blocks.

### JSON SCHEMA:
[
  {
    "slug": "unique_string_id",
    "type": "feature" | "story" | "task",
    "title": "Short descriptive title",
    "body": "Detailed description using standard markdown (ACs, steps, etc.)",
    "labels": ["type::...", "persona::..."],
    "depends_on": "slug_of_parent_or_dependency" (optional)
  }
]

CRITICAL: Dependencies should follow the hierarchy (Story depends on Feature, Task depends on Story). You can also add horizontal dependencies (Task B depends on Task A) if technically required.`;

export async function decomposeEpic(epicId, provider, llm, config = {}) {
  console.log(`[Decomposer] Fetching Epic #${epicId} and its planning artifacts...`);
  const epic = await provider.getEpic(epicId);

  if (!epic || !epic.linkedIssues || !epic.linkedIssues.prd || !epic.linkedIssues.techSpec) {
    throw new Error(`[Decomposer] Epic #${epicId} is missing linked PRD or Tech Spec. Run the Epic Planner first.`);
  }

  // Fetch PRD and Tech Spec bodies
  console.log(`[Decomposer] Fetching PRD #${epic.linkedIssues.prd} and Tech Spec #${epic.linkedIssues.techSpec}...`);
  const prd = await provider.getTicket(epic.linkedIssues.prd);
  const techSpec = await provider.getTicket(epic.linkedIssues.techSpec);

  // Extract heuristics for the prompt
  const heuristics = config.agentSettings?.riskGates?.heuristics || [];
  const heuristicsStr = heuristics.length > 0 
    ? `### RISK HEURISTICS (Flag as risk::high if any apply):\n- ${heuristics.join('\n- ')}`
    : '';

  const systemPrompt = `${DECOMPOSER_SYSTEM_PROMPT}\n\n${heuristicsStr}`;

  const userPrompt = `
Epic: ${epic.title}
PRD Content:
${prd.body}

Technical Specification Content:
${techSpec.body}

Please decompose the above into a complete ticket backlog. Respond with the JSON array only.`;

  console.log(`[Decomposer] Calling LLM for decomposition (this may take a minute)...`);
  const response = await llm.generateText(systemPrompt, userPrompt);
  
  let tickets;
  try {
    // LLM sometimes wraps in markdown code blocks even if told not to
    const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
    tickets = JSON.parse(cleanJson);
  } catch (err) {
    console.error('[Decomposer] Failed to parse LLM response as JSON. Raw response:\n', response);
    throw new Error('LLM output was not valid JSON.');
  }

  console.log(`[Decomposer] Identified ${tickets.length} tickets. Starting creation...`);

  // Map of slug -> created ID for dependency resolution
  const slugMap = new Map();

  // Sort tickets by type to ensure parents are created first (Feature -> Story -> Task)
  const typeOrder = { feature: 0, story: 1, task: 2 };
  tickets.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  for (const t of tickets) {
    console.log(`[Decomposer] [${t.type.toUpperCase()}] Creating "${t.title}"...`);
    
    // Resolve dependency ID
    const dependsOnId = t.depends_on ? slugMap.get(t.depends_on) : null;
    const dependencies = dependsOnId ? [dependsOnId] : [];

    const created = await provider.createTicket(epicId, {
      title: t.title,
      body: t.body,
      labels: t.labels || [],
      dependencies: dependencies,
    });

    console.log(`[Decomposer] -> Created Issue #${created.id}`);
    slugMap.set(t.slug, created.id);
  }

  console.log(`[Decomposer] Backlog for Epic #${epicId} populated successfully!`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
    },
  });

  if (!values.epic) {
    console.error('Usage: node ticket-decomposer.js --epic <EpicId>');
    process.exit(1);
  }

  const epicId = parseInt(values.epic, 10);
  const config = resolveConfig();
  const provider = createProvider(config.orchestration);
  const llm = new LLMClient({ orchestration: config.orchestration });

  await decomposeEpic(epicId, provider, llm, config);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Decomposer] Fatal error:\n', err);
    process.exit(1);
  });
}
