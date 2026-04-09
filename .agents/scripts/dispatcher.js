#!/usr/bin/env node

/**
 * dispatcher.js — CLI Entry Point for the Dispatch Engine
 *
 * Thin wrapper around the orchestration SDK. Parses CLI arguments,
 * delegates core logic to `lib/orchestration/dispatcher.js`, then
 * handles file I/O and console output.
 *
 * Usage:
 *   node dispatcher.js <ticketId> [--dry-run] [--executor <name>]
 *   node dispatcher.js --epic <epicId> [--dry-run]     (legacy, deprecated)
 *
 * The script auto-detects whether the ticket is an Epic or Story
 * and routes to the appropriate execution mode.
 *
 * @see .agents/scripts/lib/orchestration/index.js (SDK barrel)
 * @see .agents/schemas/dispatch-manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { resolveAndDispatch } from './lib/orchestration/index.js';

// Re-export SDK functions so that direct consumers of dispatcher.js
// (tests, CI scripts) continue to work without modification.
export {
  dispatch,
  executeStory,
  resolveAndDispatch,
} from './lib/orchestration/index.js';

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Presentation helpers (CLI-only — not part of the SDK)
// ---------------------------------------------------------------------------

import {
  printStoryDispatchTable,
  renderManifestMarkdown,
  renderStoryManifestMarkdown,
} from './lib/presentation/manifest-renderer.js';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      epic: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      executor: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  // Resolve the single ticket ID from positional arg or --epic flag
  const epicIdFromFlag = parseInt(values.epic ?? '', 10);
  const fromPositional = parseInt((positionals[0] ?? '').replace(/^#/, ''), 10);
  const ticketId =
    !Number.isNaN(fromPositional) && fromPositional > 0
      ? fromPositional
      : !Number.isNaN(epicIdFromFlag) && epicIdFromFlag > 0
        ? epicIdFromFlag
        : null;

  if (!ticketId) {
    console.error(
      '[Dispatcher] Error: No valid Issue ID provided.\n' +
        'Usage: node dispatcher.js <ticketId> [--dry-run]',
    );
    process.exit(1);
  }

  const dryRun = values['dry-run'] ?? false;
  const executorOverride = values.executor;

  // Delegate to the SDK's unified resolver
  const manifest = await resolveAndDispatch({
    ticketId,
    dryRun,
    executorOverride,
  });

  // Write manifest files
  const manifestDir = path.join(PROJECT_ROOT, 'temp');
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  if (manifest.type === 'story-execution') {
    // ── Story Execution output ──
    const key = manifest.stories.map((s) => s.storyId).join('-');
    const jsonPath = path.join(manifestDir, `story-manifest-${key}.json`);
    const mdPath = path.join(manifestDir, `story-manifest-${key}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(mdPath, renderStoryManifestMarkdown(manifest), 'utf8');

    console.log(
      `\n[Dispatcher] ✅ Story manifest: temp/story-manifest-${key}.json`,
    );
    console.log(`[Dispatcher] 📄 Markdown: temp/story-manifest-${key}.md\n`);
    console.log(renderStoryManifestMarkdown(manifest));
  } else {
    // ── Epic Dispatch output ──
    const epicId = manifest.epicId;
    const jsonPath = path.join(manifestDir, `dispatch-manifest-${epicId}.json`);
    const mdPath = path.join(manifestDir, `dispatch-manifest-${epicId}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(mdPath, renderManifestMarkdown(manifest), 'utf8');

    console.log(
      `\n[Dispatcher] ✅ Manifest: temp/dispatch-manifest-${epicId}.json`,
    );
    console.log(
      `[Dispatcher] 📄 Markdown: temp/dispatch-manifest-${epicId}.md`,
    );
    console.log(
      `[Dispatcher] Progress: ${manifest.summary.doneTasks}/${manifest.summary.totalTasks} tasks done (${manifest.summary.progressPercent}%)`,
    );
    console.log(
      `[Dispatcher] Dispatched: ${manifest.summary.dispatched}, Held: ${manifest.summary.heldForApproval}`,
    );

    printStoryDispatchTable(manifest.storyManifest);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Dispatcher] Fatal error:', err.message);
    if (process.env.DEBUG) Logger.fatal();
  });
}
