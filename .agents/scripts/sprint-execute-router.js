#!/usr/bin/env node

/**
 * sprint-execute-router.js — Ticket-type routing decision for `/sprint-execute`.
 *
 * `/sprint-execute <id>` dispatches Epic Mode or Story Mode based on the
 * ticket's `type::` label. Previously the .md skill told the LLM to run
 * `gh issue view --json labels` and branch by label. That approach rots when
 * the type taxonomy shifts (e.g., accepting `type::feature` via a wrapper) —
 * the .md's hardcoded if/else drifts from the authoritative label enum.
 *
 * This script owns the decision: fetch the ticket once, inspect its labels,
 * return `{ mode, reason }` JSON. The skill then routes on `mode` alone and
 * never rebuilds the label map.
 *
 * Usage:
 *   node .agents/scripts/sprint-execute-router.js --ticket <id>
 *
 * Output (stdout, always JSON):
 *   { "mode": "epic"|"story"|"reject", "ticketId": N, "title": "...", "reason": "..." }
 *
 * Exit codes:
 *   0 — routed (mode is `epic` or `story`).
 *   1 — reject (Feature/Task container, missing ticket, missing type::).
 *   2 — usage / config error.
 */

import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

const TYPE_TO_MODE = Object.freeze({
  'type::epic': 'epic',
  'type::story': 'story',
});

const REJECT_TYPES = Object.freeze({
  'type::feature':
    'Features are containers — run /sprint-execute against child Stories or the parent Epic.',
  'type::task':
    'Tasks execute as children of Stories — run /sprint-execute against the Story, not the Task.',
});

/**
 * Decide the routing verdict for a ticket's label set. Pure — tests pass in
 * labels directly.
 *
 * @param {{ id: number|string, title?: string, labels: string[] }} ticket
 * @returns {{ mode: 'epic'|'story'|'reject', ticketId: number|string, title: string, reason: string }}
 */
export function routeByLabels(ticket) {
  const { id, title = '', labels = [] } = ticket;
  for (const [typeLabel, mode] of Object.entries(TYPE_TO_MODE)) {
    if (labels.includes(typeLabel)) {
      return {
        mode,
        ticketId: id,
        title,
        reason: `Ticket carries ${typeLabel}.`,
      };
    }
  }
  for (const [typeLabel, reason] of Object.entries(REJECT_TYPES)) {
    if (labels.includes(typeLabel)) {
      return { mode: 'reject', ticketId: id, title, reason };
    }
  }
  return {
    mode: 'reject',
    ticketId: id,
    title,
    reason:
      'Ticket carries no recognized `type::` label (expected `type::epic` or `type::story`).',
  };
}

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      ticket: { type: 'string' },
    },
    strict: false,
  });
  const ticketId = Number.parseInt(values.ticket ?? '', 10);
  if (Number.isNaN(ticketId) || ticketId <= 0) {
    Logger.fatal('Usage: node sprint-execute-router.js --ticket <id>');
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  let ticket;
  try {
    ticket = await provider.getTicket(ticketId);
  } catch (err) {
    const payload = {
      mode: 'reject',
      ticketId,
      title: '',
      reason: `Failed to fetch ticket #${ticketId}: ${err.message}`,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exit(1);
  }
  if (!ticket) {
    const payload = {
      mode: 'reject',
      ticketId,
      title: '',
      reason: `Ticket #${ticketId} not found.`,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exit(1);
  }

  const verdict = routeByLabels({
    id: ticket.id ?? ticketId,
    title: ticket.title ?? '',
    labels: ticket.labels ?? [],
  });
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  if (verdict.mode === 'reject') process.exit(1);
}

runAsCli(import.meta.url, main, { source: 'sprint-execute-router' });
