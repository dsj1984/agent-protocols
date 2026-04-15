#!/usr/bin/env node

/**
 * .agents/scripts/sprint-wave-gate.js — Wave Completeness Gate
 *
 * Reads the latest `dispatch-manifest` structured comment on an Epic,
 * parses its story list, and verifies every story in the manifest is
 * closed. Exits non-zero if any remain open so `/sprint-close` can halt
 * before any merge-to-main work begins.
 *
 * Usage:
 *   node .agents/scripts/sprint-wave-gate.js --epic <EPIC_ID>
 *
 * Exit codes:
 *   0 — all manifest stories are closed.
 *   1 — one or more stories are still open; list is printed to stderr.
 *   2 — configuration or manifest-parse error.
 */

import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { findStructuredComment } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

function extractJsonBlock(body) {
  if (typeof body !== 'string') return null;
  const fence = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!fence) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}

export async function runWaveGate({ epicId, injectedProvider } = {}) {
  if (!epicId || Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal('Usage: node sprint-wave-gate.js --epic <EPIC_ID>');
  }

  const { orchestration } = resolveConfig();
  const provider = injectedProvider || createProvider(orchestration);

  const comment = await findStructuredComment(
    provider,
    epicId,
    'dispatch-manifest',
  );
  if (!comment) {
    console.error(
      `[wave-gate] No dispatch-manifest comment on Epic #${epicId}. ` +
        `Run \`node .agents/scripts/dispatcher.js <epicId>\` to produce one.`,
    );
    process.exit(2);
  }

  const parsed = extractJsonBlock(comment.body);
  if (!parsed || !Array.isArray(parsed.stories)) {
    console.error(
      `[wave-gate] dispatch-manifest comment #${comment.id} on Epic #${epicId} did not contain a parseable story list.`,
    );
    process.exit(2);
  }

  const open = [];
  for (const entry of parsed.stories) {
    const id = Number(entry.storyId);
    if (!Number.isFinite(id)) continue;
    try {
      const ticket = await provider.getTicket(id);
      if (ticket.state !== 'closed') {
        open.push({ id, title: entry.title, wave: entry.wave });
      }
    } catch (err) {
      // Treat fetch failures as "still open" — better to halt than to
      // silently skip a story we could not confirm.
      open.push({
        id,
        title: entry.title,
        wave: entry.wave,
        error: err.message,
      });
    }
  }

  if (open.length > 0) {
    console.error(
      `[wave-gate] ❌ Wave-completeness gate FAILED for Epic #${epicId}: ` +
        `${open.length} story(ies) still open.`,
    );
    for (const s of open) {
      const tag = s.error ? ` (${s.error})` : '';
      console.error(`  - #${s.id} (wave ${s.wave}) — ${s.title}${tag}`);
    }
    console.error('');
    console.error(
      'Resolve the open stories with `/sprint-execute <storyId>` or close them manually, then re-run `/sprint-close`.',
    );
    process.exit(1);
  }

  console.log(
    `[wave-gate] ✅ All ${parsed.stories.length} manifest story(ies) for Epic #${epicId} are closed.`,
  );
  return { success: true, total: parsed.stories.length };
}

async function main() {
  const { values } = parseArgs({
    options: { epic: { type: 'string' } },
    strict: false,
  });
  const epicId = parseInt(values.epic ?? '', 10);
  await runWaveGate({ epicId });
}

runAsCli(import.meta.url, main, { source: 'sprint-wave-gate' });
