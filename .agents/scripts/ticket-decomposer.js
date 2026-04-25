#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * ticket-decomposer.js
 *
 * Work Breakdown Decomposition Script (v5.6+)
 *
 * As of v5.6 the host LLM authors the ticket array directly — this script
 * no longer calls any external LLM API. It has two modes:
 *
 *   1. --emit-context  Prints a JSON envelope (PRD body, Tech Spec body,
 *                      system prompt, risk heuristics, JSON schema) to stdout.
 *                      The host LLM consumes this to author the ticket array.
 *
 *   2. (default)       Given an author-provided tickets JSON file, validates
 *                      and creates the Feature/Story/Task issues under the Epic.
 *
 * Execution model: Stories are the primary execution unit. Each Story is executed
 * on a single branch (`story/epic-<epicId>/<slug>`) with all child Tasks
 * implemented sequentially. The dispatcher groups tasks by Story and assigns a
 * model_tier (high|low) based on the Story's complexity::high label.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { getLimits, resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { TYPE_LABELS } from './lib/label-constants.js';
import { validateAndNormalizeTickets } from './lib/orchestration/ticket-validator.js';
import { createProvider } from './lib/provider-factory.js';
import { renderDecomposerSystemPrompt } from './lib/templates/decomposer-prompts.js';

function resolveParentId(ticket, slugMap, epicId) {
  if (ticket.type === 'feature') return epicId;
  if (!ticket.parent_slug) {
    throw new Error(
      `[Decomposer] ${ticket.type.toUpperCase()} "${ticket.title}" (${ticket.slug}) has no parent_slug.`,
    );
  }
  if (!slugMap.has(ticket.parent_slug)) {
    throw new Error(
      `[Decomposer] ${ticket.type.toUpperCase()} "${ticket.title}" (${ticket.slug}) references parent_slug "${ticket.parent_slug}" which was not created. The parent is missing from the ticket array or the slug is misspelled.`,
    );
  }
  return slugMap.get(ticket.parent_slug);
}

export function resolveDependencies(ticket, slugMap) {
  const resolved = [];
  for (const dep of ticket.depends_on || []) {
    const depId = slugMap.get(dep);
    if (depId === undefined) {
      // Unreachable through normal flow: validateAndNormalizeTickets
      // already rejects unknown slugs and the new topological sort
      // guarantees creation order. A throw here turns a future regression
      // (e.g. someone bypassing the validator) into a loud failure instead
      // of a silently-dropped DAG edge.
      throw new Error(
        `[Decomposer] ${ticket.type.toUpperCase()} "${ticket.title}" (${ticket.slug}) depends on unresolved slug "${dep}". This indicates a planner bug or out-of-order ticket creation.`,
      );
    }
    resolved.push(depId);
  }
  return resolved;
}

/**
 * Topologically sort tickets within each (parent_slug, type) group, then
 * concatenate groups in typeOrder so parents are always created before
 * children (Feature → Story → Task) and intra-group dep chains resolve
 * before their dependents are created.
 */
export function orderTicketsForCreation(validated) {
  const typeOrder = { feature: 0, story: 1, task: 2 };
  const groups = new Map();

  for (const t of validated) {
    const parentKey = t.parent_slug ?? '__epic__';
    const key = `${t.type}::${parentKey}`;
    if (!groups.has(key)) groups.set(key, { type: t.type, items: [] });
    groups.get(key).items.push(t);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => typeOrder[a.type] - typeOrder[b.type],
  );

  const result = [];
  for (const group of ordered) {
    for (const t of topoSortGroup(group.items)) {
      result.push(t);
    }
  }
  return result;
}

function topoSortGroup(group) {
  const slugToTicket = new Map(group.map((t) => [t.slug, t]));
  const visited = new Set();
  const sorted = [];

  function visit(t) {
    if (visited.has(t.slug)) return;
    visited.add(t.slug);
    for (const dep of t.depends_on ?? []) {
      const depTicket = slugToTicket.get(dep);
      if (depTicket) visit(depTicket);
    }
    sorted.push(t);
  }

  for (const t of group) visit(t);
  return sorted;
}

export function buildDecomposerSystemPrompt(
  heuristics = [],
  { maxTickets } = {},
) {
  const base = renderDecomposerSystemPrompt({ maxTickets });
  const heuristicsStr =
    heuristics.length > 0
      ? `### RISK HEURISTICS (Flag as risk::medium if any apply):\n- ${heuristics.join('\n- ')}`
      : '';
  return `${base}${heuristicsStr ? `\n\n${heuristicsStr}` : ''}`;
}

/**
 * Build the authoring context the host LLM needs to produce the ticket JSON.
 */
export async function buildDecompositionContext(epicId, provider, config = {}) {
  const epic = await provider.getEpic(epicId);
  if (!epic?.linkedIssues?.prd || !epic.linkedIssues.techSpec) {
    throw new Error(
      `[Decomposer] Epic #${epicId} is missing linked PRD or Tech Spec. Run the Epic Planner first.`,
    );
  }

  const [prd, techSpec] = await Promise.all([
    provider.getTicket(epic.linkedIssues.prd),
    provider.getTicket(epic.linkedIssues.techSpec),
  ]);

  const heuristics = config.agentSettings?.riskGates?.heuristics || [];
  const maxTickets = getLimits(config).maxTickets;
  const systemPrompt = buildDecomposerSystemPrompt(heuristics, { maxTickets });

  return {
    epic: { id: epic.id, title: epic.title },
    prd: { id: prd.id, body: prd.body },
    techSpec: { id: techSpec.id, body: techSpec.body },
    heuristics,
    systemPrompt,
    maxTickets,
  };
}

export async function decomposeEpic(
  epicId,
  provider,
  { tickets },
  _config = {},
  { force = false } = {},
) {
  if (!Array.isArray(tickets)) {
    throw new Error(
      `[Decomposer] tickets must be an array (got ${typeof tickets}).`,
    );
  }

  console.log(`[Decomposer] Fetching Epic #${epicId}...`);
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
    if (typeof provider.primeTicketCache === 'function') {
      provider.primeTicketCache(existing);
    }
    const childTypes = [
      TYPE_LABELS.FEATURE,
      TYPE_LABELS.STORY,
      TYPE_LABELS.TASK,
    ];
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

  const maxTickets = getLimits(_config).maxTickets;
  if (tickets.length >= maxTickets) {
    console.warn(
      `[Decomposer] ⚠️  Received ${tickets.length} tickets (at or above the ${maxTickets}-ticket cap). Verify every Story still has child Tasks or split the Epic into smaller scopes.`,
    );
  }

  console.log(
    `[Decomposer] Running cross-validation on ${tickets.length} tickets...`,
  );
  const validated = validateAndNormalizeTickets(tickets);

  console.log(
    `[Decomposer] Identified ${validated.length} tickets. Starting creation...`,
  );

  const slugMap = new Map();

  const ordered = orderTicketsForCreation(validated);

  for (const t of ordered) {
    console.log(
      `[Decomposer] [${t.type.toUpperCase()}] Creating "${t.title}"...`,
    );

    const parentId = resolveParentId(t, slugMap, epicId);
    const dependencies = resolveDependencies(t, slugMap);

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

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      force: { type: 'boolean', default: false },
      'emit-context': { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
      tickets: { type: 'string' },
    },
  });

  if (!values.epic) {
    Logger.fatal(
      'Usage: ticket-decomposer.js --epic <EpicId> (--emit-context [--pretty] | --tickets <file>) [--force]',
    );
  }

  const epicId = Number.parseInt(values.epic, 10);
  const config = resolveConfig();
  const provider = createProvider(config.orchestration);

  if (values['emit-context']) {
    const ctx = await buildDecompositionContext(epicId, provider, config);
    const json = values.pretty
      ? JSON.stringify(ctx, null, 2)
      : JSON.stringify(ctx);
    process.stdout.write(`${json}\n`);
    return;
  }

  if (!values.tickets) {
    Logger.fatal(
      'Missing --tickets <file>. (Use --emit-context first to gather authoring context.)',
    );
  }

  const raw = await readFile(values.tickets, 'utf8');
  let tickets;
  try {
    tickets = JSON.parse(raw);
  } catch (err) {
    Logger.fatal(
      `Failed to parse tickets file "${values.tickets}" as JSON: ${err.message}`,
    );
  }

  await decomposeEpic(epicId, provider, { tickets }, config, {
    force: values.force,
  });
}

runAsCli(import.meta.url, main, { source: 'Decomposer' });
