#!/usr/bin/env node

/**
 * ticket-decomposer.js
 *
 * Sprint 2B Work Breakdown Decomposition Script
 * Reads the PRD and Tech Spec of an Epic, decomposes them into a 3-level hierarchy
 * (Feature, Story, Task), and populates them into GitHub with proper linking.
 *
 * Execution model: Stories are the primary execution unit. Each Story is executed
 * on a single branch (`story/epic-<epicId>/<slug>`) with all child Tasks
 * implemented sequentially. The dispatcher groups tasks by Story and assigns a
 * model_tier (high|fast) based on the Story's complexity:: label.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { detectCycle } from './lib/Graph.js';
import { LLMClient } from './lib/llm-client.js';
import { createProvider } from './lib/provider-factory.js';

const DECOMPOSER_SYSTEM_PROMPT = `You are an expert Senior Project Manager and Orchestrator.
Your job is to take a Product Requirements Document (PRD) and a Technical Specification and decompose them into a highly-granular 3-level ticket hierarchy for an AI Agent to execute.

### HIERARCHY RULES:
1. **Features**: Large functional milestones (e.g., "Authentication Provider Integration").
2. **Stories**: Specific user-facing or architectural user stories (e.g., "Implement JWT Token Exchange"). 
   - MUST be nested under a Feature.
   - **Story-Level Execution**: Each Story will be executed on a single branch. Group tasks that share a logical context or implementation boundary into the same Story.
   - **Complexity Assessment**: Every Story MUST be assessed for complexity. Use \`complexity::high\` for logic-heavy, architectural, or risky changes requiring high-tier reasoning models. Use \`complexity::fast\` for simple CRUD, documentation, or straightforward procedural work.
3. **Tasks**: Atomic, verifiable technical steps (e.g., "Add 'vendor_id' to users schema").
   - MUST be nested under a Story.

### LABEL CONVENTIONS:
- Every ticket must have a \`type::[feature|story|task]\` label.
- Every ticket must have a \`persona::[engineer|architect|qa-engineer|engineer-web|etc]\` label indicating WHO should execute it.
- Every **Story** MUST have a \`complexity::[high|fast]\` label.

### OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON array of objects. No prose, no markdown blocks.

### JSON SCHEMA:
[
  {
    "slug": "unique_string_id",
    "type": "feature" | "story" | "task",
    "title": "Short descriptive title",
    "body": "Brief, concise description. Keep it under 2 sentences to save output tokens.",
    "labels": ["type::...", "persona::...", "complexity::..."],
    "parent_slug": "slug_of_parent_ticket" (leave empty for features to nest under epic),
    "depends_on": ["slug_of_blocking_dependency"] (optional array of slugs that block execution)
  }
]

CRITICAL: Dependencies should follow execution blockers. For hierarchical grouping, strongly strictly use 'parent_slug' (Story parent MUST be a Feature, Task parent MUST be a Story). Features should have no 'parent_slug' (they attach to Epic).
WARNING: You MUST conserve your output limit. Do NOT generate more than 25 tickets in total. Combine atomic tasks into larger, cohesive tasks. Do NOT cut off the JSON array prematurely!`;

export async function decomposeEpic(
  epicId,
  provider,
  llm,
  config = {},
  { force = false } = {},
) {
  console.log(
    `[Decomposer] Fetching Epic #${epicId} and its planning artifacts...`,
  );
  const epic = await provider.getEpic(epicId);

  if (!epic?.linkedIssues?.prd || !epic.linkedIssues.techSpec) {
    throw new Error(
      `[Decomposer] Epic #${epicId} is missing linked PRD or Tech Spec. Run the Epic Planner first.`,
    );
  }

  // ── Force re-decompose: close existing child tickets ──────────────────
  if (force) {
    console.log('[Decomposer] --force: Closing existing child tickets...');
    const existing = await provider.getTickets(epicId);
    const childTypes = ['type::feature', 'type::story', 'type::task'];
    const children = existing.filter((t) =>
      t.labels.some((l) => childTypes.includes(l)),
    );
    for (const child of children) {
      if (child.state !== 'closed') {
        await provider.updateTicket(child.id, {
          state: 'closed',
          state_reason: 'not_planned',
        });
        console.log(`[Decomposer]   Closed #${child.id}: ${child.title}`);
      }
    }
    console.log(`[Decomposer]   Closed ${children.length} old ticket(s).`);
  }

  // Fetch PRD and Tech Spec bodies
  console.log(
    `[Decomposer] Fetching PRD #${epic.linkedIssues.prd} and Tech Spec #${epic.linkedIssues.techSpec}...`,
  );
  const prd = await provider.getTicket(epic.linkedIssues.prd);
  const techSpec = await provider.getTicket(epic.linkedIssues.techSpec);

  // Extract heuristics for the prompt
  const heuristics = config.agentSettings?.riskGates?.heuristics || [];
  const heuristicsStr =
    heuristics.length > 0
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

  console.log(
    `[Decomposer] Calling LLM for decomposition (this may take a minute)...`,
  );
  let response;
  try {
    response = await llm.generateText(systemPrompt, userPrompt);
  } catch (err) {
    if (err.message.includes('maxInputTokens')) {
      throw new Error(
        `[Decomposer] Input too large for LLM context window. ` +
          `Consider splitting the Epic into smaller features or reducing PRD/Tech Spec detail. ` +
          `Original error: ${err.message}`,
      );
    }
    throw err;
  }

  let tickets;
  try {
    // LLM sometimes wraps in markdown code blocks even if told not to
    const cleanJson = response
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    tickets = JSON.parse(cleanJson);
  } catch (_err) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('temp/llm-output.txt', response, 'utf8');
    console.error(
      '[Decomposer] Failed to parse LLM response as JSON. Raw response dumped to temp/llm-output.txt',
    );
    throw new Error('LLM output was not valid JSON.');
  }

  console.log(
    `[Decomposer] Running cross-validation on ${tickets.length} decomposed tickets...`,
  );
  const ticketBySlug = new Map(tickets.map((t) => [t.slug, t]));
  const features = tickets.filter((t) => t.type === 'feature');
  const stories = tickets.filter((t) => t.type === 'story');
  const tasks = tickets.filter((t) => t.type === 'task');

  if (features.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Feature.',
    );
  if (stories.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Story.',
    );
  if (tasks.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Task.',
    );

  // Validate hierarchy
  for (const story of stories) {
    if (!story.parent_slug)
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" must have a parent_slug.`,
      );
    const parent = ticketBySlug.get(story.parent_slug);
    if (!parent || parent.type !== 'feature')
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" parent must be a Feature.`,
      );

    // Complexity validation (New in Story-Level Branching)
    const hasComplexity = (story.labels || []).some((l) =>
      l.startsWith('complexity::'),
    );
    if (!hasComplexity) {
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" is missing a complexity label (complexity::high|fast).`,
      );
    }
  }

  for (const task of tasks) {
    if (!task.parent_slug)
      throw new Error(
        `Cross-Validation Failed: Task "${task.title}" must have a parent_slug.`,
      );
    const parent = ticketBySlug.get(task.parent_slug);
    if (!parent || parent.type !== 'story') {
      throw new Error(
        `Cross-Validation Failed: Task "${task.title}" parent must be a Story.`,
      );
    }
  }

  // Acyclic dependency check — delegate to the shared Graph.js implementation
  // rather than re-implementing DFS from scratch.
  const slugAdjacency = new Map(
    tickets.map((t) => [t.slug, t.depends_on ?? []]),
  );
  const cycle = detectCycle(slugAdjacency);
  if (cycle) {
    throw new Error(
      `Cross-Validation Failed: Circular dependency detected: ${cycle.join(' → ')}.`,
    );
  }

  console.log(
    `[Decomposer] Identified ${tickets.length} tickets. Starting creation...`,
  );

  // Map of slug -> created ID for dependency resolution
  const slugMap = new Map();

  // Sort tickets by type to ensure parents are created first (Feature -> Story -> Task)
  const typeOrder = { feature: 0, story: 1, task: 2 };
  tickets.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  for (const t of tickets) {
    console.log(
      `[Decomposer] [${t.type.toUpperCase()}] Creating "${t.title}"...`,
    );

    // Resolve dependency ID
    const parentId =
      t.parent_slug && slugMap.has(t.parent_slug)
        ? slugMap.get(t.parent_slug)
        : epicId;
    const dependencies = (t.depends_on || [])
      .map((dep) => slugMap.get(dep))
      .filter(Boolean);

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

  console.log(
    `[Decomposer] Backlog for Epic #${epicId} populated successfully!`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });

  if (!values.epic) {
    console.error('Usage: node ticket-decomposer.js --epic <EpicId> [--force]');
    process.exit(1);
  }

  const epicId = parseInt(values.epic, 10);
  const config = resolveConfig();
  const provider = createProvider(config.orchestration);
  const llm = new LLMClient({ orchestration: config.orchestration });

  await decomposeEpic(epicId, provider, llm, config, {
    force: values.force,
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Decomposer] Fatal error:\n', err);
    process.exit(1);
  });
}
