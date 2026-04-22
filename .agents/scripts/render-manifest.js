#!/usr/bin/env node

/**
 * .agents/scripts/render-manifest.js — Derived-view Manifest Renderer
 *
 * Regenerates `temp/dispatch-manifest-<epicId>.{md,json}` from the
 * `dispatch-manifest` structured comment on the Epic. The comment is the
 * single source of truth for which Stories the sprint committed to; the
 * `temp/` files are a convenience view that lets wave-gate runs, local
 * tooling, and CI consumers work offline.
 *
 * Running this script never mutates GitHub state — it only performs a read
 * of the existing comment and writes the derived artefacts under
 * `<projectRoot>/temp/`.
 *
 * Usage:
 *   node .agents/scripts/render-manifest.js --epic <EPIC_ID>
 *
 * Exit codes:
 *   0 — render succeeded.
 *   1 — no manifest comment (or no parseable JSON) on the Epic.
 *   2 — configuration or provider transport error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { findStructuredComment } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

export function extractManifestJson(body) {
  if (typeof body !== 'string') return null;
  const fence = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!fence) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}

/**
 * Write the rendered manifest files. Separated from the I/O boundary so
 * tests can exercise the pure contract without touching disk.
 *
 * @param {{ epicId: number, body: string, parsed: object, projectRoot?: string }} opts
 * @returns {{ mdPath: string, jsonPath: string }}
 */
export function writeRenderedManifest({
  epicId,
  body,
  parsed,
  projectRoot = PROJECT_ROOT,
}) {
  const tempDir = path.join(projectRoot, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const mdPath = path.join(tempDir, `dispatch-manifest-${epicId}.md`);
  const jsonPath = path.join(tempDir, `dispatch-manifest-${epicId}.json`);
  fs.writeFileSync(mdPath, body, 'utf8');
  fs.writeFileSync(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { mdPath, jsonPath };
}

export async function renderManifestFromComment({
  epicId,
  injectedProvider,
} = {}) {
  if (!epicId || Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal('Usage: node render-manifest.js --epic <EPIC_ID>');
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
      `[render-manifest] No dispatch-manifest comment on Epic #${epicId}. ` +
        `Run the dispatcher (\`node .agents/scripts/dispatcher.js ${epicId}\`) first.`,
    );
    process.exit(1);
  }

  const parsed = extractManifestJson(comment.body);
  if (!parsed) {
    console.error(
      `[render-manifest] dispatch-manifest comment #${comment.id} on Epic #${epicId} did not contain a parseable JSON block.`,
    );
    process.exit(1);
  }

  const { mdPath, jsonPath } = writeRenderedManifest({
    epicId,
    body: comment.body,
    parsed,
  });

  const storyCount = Array.isArray(parsed.stories) ? parsed.stories.length : 0;
  console.log(
    `[render-manifest] ✅ Rendered ${storyCount} story(ies) for Epic #${epicId}:\n` +
      `  - ${mdPath}\n` +
      `  - ${jsonPath}`,
  );
  return { mdPath, jsonPath, stories: storyCount };
}

async function main() {
  const { values } = parseArgs({
    options: { epic: { type: 'string' } },
    strict: false,
  });
  const epicId = Number.parseInt(values.epic ?? '', 10);
  await renderManifestFromComment({ epicId });
}

runAsCli(import.meta.url, main, { source: 'render-manifest' });
