#!/usr/bin/env node
/* node:coverage ignore file */

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

import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { LLMClient } from './lib/llm-client.js';
import { validateAndNormalizeTickets } from './lib/orchestration/ticket-validator.js';
import { createProvider } from './lib/provider-factory.js';
import { DECOMPOSER_SYSTEM_PROMPT } from './lib/templates/decomposer-prompts.js';

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
    const closePromises = [];
    for (const child of children) {
      if (child.state !== 'closed') {
        const p = provider
          .updateTicket(child.id, {
            state: 'closed',
            state_reason: 'not_planned',
          })
          .then(() => {
            console.log(`[Decomposer]   Closed #${child.id}: ${child.title}`);
          });
        closePromises.push(p);
      }
    }
    await Promise.all(closePromises);
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

  if (!Array.isArray(tickets)) {
    throw new Error(
      `[Decomposer] LLM response parsed but is not an array (got ${typeof tickets}). The decomposer prompt requires a top-level JSON array.`,
    );
  }

  // Truncation heuristic: the system prompt caps generation at 25 tickets.
  // If the LLM emits exactly that (or more), it is likely bumping against the
  // cap and may have silently omitted child tickets. Surface a warning so
  // partial backlogs do not slip through unnoticed.
  if (tickets.length >= 25) {
    console.warn(
      `[Decomposer] ⚠️  LLM emitted ${tickets.length} tickets (at or above the 25-ticket cap). Output may be truncated; verify every Story still has child Tasks or split the Epic into smaller scopes.`,
    );
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

    // Resolve parent — only Features attach directly to the Epic. Stories and
    // Tasks MUST have a parent that was already created earlier in the sorted
    // loop; if their parent_slug is missing from slugMap, silently falling
    // back to epicId would orphan the ticket under the Epic, so fail loudly.
    let parentId;
    if (t.type === 'feature') {
      parentId = epicId;
    } else if (!t.parent_slug) {
      throw new Error(
        `[Decomposer] ${t.type.toUpperCase()} "${t.title}" (${t.slug}) has no parent_slug. Stories must attach to a Feature and Tasks must attach to a Story.`,
      );
    } else if (!slugMap.has(t.parent_slug)) {
      throw new Error(
        `[Decomposer] ${t.type.toUpperCase()} "${t.title}" (${t.slug}) references parent_slug "${t.parent_slug}" which was not created. This usually means the parent ticket is missing from the LLM output or the slug is misspelled.`,
      );
    } else {
      parentId = slugMap.get(t.parent_slug);
    }

    // Resolve dependencies — slugs that fail to resolve are dropped silently
    // by the provider, which quietly breaks the DAG. Warn per unresolved slug
    // so operators see the drift instead of discovering it mid-sprint.
    const dependencies = [];
    for (const dep of t.depends_on || []) {
      const depId = slugMap.get(dep);
      if (depId) {
        dependencies.push(depId);
      } else {
        console.warn(
          `[Decomposer] ⚠️  ${t.type.toUpperCase()} "${t.title}" (${t.slug}) depends on unresolved slug "${dep}" — dependency dropped.`,
        );
      }
    }

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

runAsCli(import.meta.url, main, { source: 'Decomposer' });
