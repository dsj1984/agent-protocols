#!/usr/bin/env node

/**
 * .agents/scripts/sprint-wave-gate.js — Wave Completeness Gate
 *
 * Reads the latest `dispatch-manifest` structured comment on an Epic — the
 * single source of truth for which Stories the sprint committed to — and
 * verifies every Story in the manifest is closed. Exits non-zero if any
 * remain open so `/sprint-close` can halt before any merge-to-main work
 * begins.
 *
 * The gate never reads `temp/dispatch-manifest-<epicId>.{md,json}`: those
 * files are derived views (regenerated on demand by `render-manifest.js`)
 * and can legitimately be stale or absent. Pinning the gate to the
 * structured comment keeps its decision reproducible across workstations,
 * CI runners, and fresh worktrees.
 *
 * Also reads the `parked-follow-ons` structured comment (if present) so
 * the operator sees recuts and parked Stories as part of the same gate
 * checkpoint. Open parked follow-ons halt the gate by default — the
 * operator must adopt (re-dispatch) or explicitly defer (close with
 * `not_planned`) before closure can proceed. Pass `--allow-parked` to
 * waive. Open recuts likewise halt unless `--allow-open-recuts` is set.
 *
 * Usage:
 *   node .agents/scripts/sprint-wave-gate.js --epic <EPIC_ID>
 *                                           [--allow-parked]
 *                                           [--allow-open-recuts]
 *
 * Exit codes:
 *   0 — all manifest stories are closed (and no blocking follow-ons).
 *   1 — one or more manifest stories / follow-ons are still open.
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

async function readParkedFollowOns(provider, epicId) {
  const comment = await findStructuredComment(
    provider,
    epicId,
    'parked-follow-ons',
  );
  if (!comment) return { recuts: [], parked: [], present: false };
  const parsed = extractJsonBlock(comment.body);
  if (!parsed) return { recuts: [], parked: [], present: true };
  return {
    present: true,
    recuts: Array.isArray(parsed.recuts) ? parsed.recuts : [],
    parked: Array.isArray(parsed.parked) ? parsed.parked : [],
  };
}

export async function runWaveGate({
  epicId,
  allowParked = false,
  allowOpenRecuts = false,
  injectedProvider,
} = {}) {
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

  // Read parked follow-ons + recuts structured comment (non-fatal if absent).
  const followOns = await readParkedFollowOns(provider, epicId);
  const openRecuts = [];
  const openParked = [];
  for (const r of followOns.recuts) {
    const id = Number(r.storyId);
    if (!Number.isFinite(id)) continue;
    try {
      const ticket = await provider.getTicket(id);
      if (ticket.state !== 'closed') {
        openRecuts.push({ id, parentId: r.parentId });
      }
    } catch (err) {
      openRecuts.push({ id, parentId: r.parentId, error: err.message });
    }
  }
  for (const p of followOns.parked) {
    const id = Number(p.storyId);
    if (!Number.isFinite(id)) continue;
    try {
      const ticket = await provider.getTicket(id);
      if (ticket.state !== 'closed') {
        openParked.push({ id });
      }
    } catch (err) {
      openParked.push({ id, error: err.message });
    }
  }

  const problems = [];
  if (open.length > 0) {
    problems.push(
      `${open.length} manifest story(ies) still open:` +
        '\n' +
        open
          .map((s) => {
            const tag = s.error ? ` (${s.error})` : '';
            return `  - #${s.id} (wave ${s.wave}) — ${s.title}${tag}`;
          })
          .join('\n'),
    );
  }
  if (openRecuts.length > 0 && !allowOpenRecuts) {
    problems.push(
      `${openRecuts.length} recut story(ies) still open:` +
        '\n' +
        openRecuts
          .map((r) => {
            const tag = r.error ? ` (${r.error})` : '';
            return `  - #${r.id} (recut-of #${r.parentId})${tag}`;
          })
          .join('\n'),
    );
  }
  if (openParked.length > 0 && !allowParked) {
    problems.push(
      `${openParked.length} parked follow-on(s) still open — adopt (re-dispatch) or close with \`not_planned\`:` +
        '\n' +
        openParked
          .map((p) => {
            const tag = p.error ? ` (${p.error})` : '';
            return `  - #${p.id}${tag}`;
          })
          .join('\n'),
    );
  }

  if (problems.length > 0) {
    console.error(
      `[wave-gate] ❌ Wave-completeness gate FAILED for Epic #${epicId}:`,
    );
    for (const p of problems) console.error(p);
    console.error('');
    console.error(
      'Resolve the open items with `/sprint-execute <storyId>` or close them manually, then re-run `/sprint-close`.',
    );
    process.exit(1);
  }

  const followOnNote =
    followOns.recuts.length > 0 || followOns.parked.length > 0
      ? ` · ${followOns.recuts.length} recut + ${followOns.parked.length} parked (all closed)`
      : '';
  console.log(
    `[wave-gate] ✅ All ${parsed.stories.length} manifest story(ies) for Epic #${epicId} are closed${followOnNote}.`,
  );
  return {
    success: true,
    total: parsed.stories.length,
    recuts: followOns.recuts.length,
    parked: followOns.parked.length,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      'allow-parked': { type: 'boolean', default: false },
      'allow-open-recuts': { type: 'boolean', default: false },
    },
    strict: false,
  });
  const epicId = Number.parseInt(values.epic ?? '', 10);
  await runWaveGate({
    epicId,
    allowParked: values['allow-parked'] === true,
    allowOpenRecuts: values['allow-open-recuts'] === true,
  });
}

runAsCli(import.meta.url, main, { source: 'sprint-wave-gate' });
