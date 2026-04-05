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
import { fileURLToPath } from 'node:url';
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
    "parent_slug": "slug_of_parent_ticket" (leave empty for features to nest under epic),
    "depends_on": ["slug_of_blocking_dependency"] (optional array of slugs that block execution)
  }
]

CRITICAL: Dependencies should follow execution blockers. For hierarchical grouping, strongly strictly use 'parent_slug' (Story parent MUST be a Feature, Task parent MUST be a Story). Features should have no 'parent_slug' (they attach to Epic).`;

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

  console.log(`[Decomposer] Running cross-validation on ${tickets.length} decomposed tickets...`);
  const ticketBySlug = new Map(tickets.map(t => [t.slug, t]));
  const features = tickets.filter(t => t.type === 'feature');
  const stories = tickets.filter(t => t.type === 'story');
  const tasks = tickets.filter(t => t.type === 'task');

  if (features.length === 0) throw new Error('Cross-Validation Failed: Backlog must contain at least one Feature.');
  if (stories.length === 0) throw new Error('Cross-Validation Failed: Backlog must contain at least one Story.');
  if (tasks.length === 0) throw new Error('Cross-Validation Failed: Backlog must contain at least one Task.');

  // Validate hierarchy
  for (const story of stories) {
    if (!story.parent_slug) throw new Error(`Cross-Validation Failed: Story "${story.title}" must have a parent_slug.`);
    const parent = ticketBySlug.get(story.parent_slug);
    if (!parent || parent.type !== 'feature') throw new Error(`Cross-Validation Failed: Story "${story.title}" parent must be a Feature.`);
  }

  for (const task of tasks) {
    if (!task.parent_slug) throw new Error(`Cross-Validation Failed: Task "${task.title}" must have a parent_slug.`);
    const parent = ticketBySlug.get(task.parent_slug);
    if (!parent || parent.type !== 'story') {
       throw new Error(`Cross-Validation Failed: Task "${task.title}" parent must be a Story.`);
    }
  }

  // Acyclic check for dependencies
  for (const ticket of tickets) {
    const visited = new Set();
    const dfs = (currentSlug) => {
       if (visited.has(currentSlug)) throw new Error(`Cross-Validation Failed: Circular dependency detected involving "${currentSlug}".`);
       visited.add(currentSlug);
       const current = ticketBySlug.get(currentSlug);
       if (current && current.depends_on) {
          for (const dep of current.depends_on) {
             dfs(dep);
          }
       }
       visited.delete(currentSlug);
    };
    dfs(ticket.slug);
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
    const parentId = t.parent_slug && slugMap.has(t.parent_slug) ? slugMap.get(t.parent_slug) : epicId;
    const dependencies = (t.depends_on || []).map(dep => slugMap.get(dep)).filter(Boolean);

    const created = await provider.createTicket(parentId, {
      epicId: epicId,
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

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Decomposer] Fatal error:\n', err);
    process.exit(1);
  });
}
