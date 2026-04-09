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
import { validateAndNormalizeTickets } from './lib/orchestration/ticket-validator.js';
import { DECOMPOSER_SYSTEM_PROMPT } from './lib/templates/decomposer-prompts.js';
import { Logger } from './lib/Logger.js';
import { resolveConfig } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';
import { LLMClient } from './lib/llm-client.js';

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
  tickets = validateAndNormalizeTickets(tickets);

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
    Logger.fatal('Usage: node ticket-decomposer.js --epic <EpicId> [--force]');
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
    Logger.fatal(`[Decomposer] Fatal error:\n${err.stack || err.message}`);
  });
}
