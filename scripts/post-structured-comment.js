#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * post-structured-comment.js — CLI wrapper for structured comment upsert.
 *
 * Post-retirement entry point for the former MCP tool
 * `mcp__agent-protocols__post_structured_comment`. Delegates to
 * `upsertStructuredComment` from `lib/orchestration/ticketing.js` and emits
 * the same `{ success, ticketId, type }` JSON envelope on stdout.
 *
 * Usage:
 *   node .agents/scripts/post-structured-comment.js \
 *     --ticket <id> --marker <type> --body-file <path> [--provider github]
 *
 * Exit codes:
 *   0 — upsert succeeded
 *   non-zero — validation or provider failure (error on stderr)
 */

import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import {
  assertValidStructuredCommentType,
  upsertStructuredComment,
} from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

const HELP = `Usage: node .agents/scripts/post-structured-comment.js \\
  --ticket <id> --marker <type> --body-file <path> [--provider github]

Flags:
  --ticket       GitHub issue number to comment on (required).
  --marker       Structured-comment type (e.g. progress, friction,
                 retro, epic-run-state, wave-0-start) (required).
  --body-file    Path to a file containing the markdown body (required).
  --provider     Provider name (default: value in .agentrc.json orchestration).
  --help         Show this message.
`;

/**
 * Core: idempotently upsert the structured comment and return the envelope.
 * Exported so tests can pin input/output parity against direct SDK use
 * without spawning a subprocess.
 */
export async function runPostStructuredComment({
  ticketId,
  type,
  body,
  provider,
}) {
  assertValidStructuredCommentType(type);
  await upsertStructuredComment(provider, ticketId, type, body);
  return { success: true, ticketId, type };
}

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      ticket: { type: 'string' },
      marker: { type: 'string' },
      'body-file': { type: 'string' },
      provider: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: false,
  });
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv);

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const ticketId = Number.parseInt(values.ticket ?? '', 10);
  const type = values.marker;
  const bodyFile = values['body-file'];

  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    process.stderr.write(
      `[post-structured-comment] --ticket <id> is required.\n${HELP}`,
    );
    process.exit(2);
  }
  if (!type) {
    process.stderr.write(
      `[post-structured-comment] --marker <type> is required.\n${HELP}`,
    );
    process.exit(2);
  }
  if (!bodyFile) {
    process.stderr.write(
      `[post-structured-comment] --body-file <path> is required.\n${HELP}`,
    );
    process.exit(2);
  }

  const body = await fs.readFile(bodyFile, 'utf8');

  const { orchestration } = resolveConfig();
  const effectiveOrchestration = values.provider
    ? { ...orchestration, provider: values.provider }
    : orchestration;
  const provider = createProvider(effectiveOrchestration);

  const envelope = await runPostStructuredComment({
    ticketId,
    type,
    body,
    provider,
  });
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

runAsCli(import.meta.url, main, { source: 'post-structured-comment' });
