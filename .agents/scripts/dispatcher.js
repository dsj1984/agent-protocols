#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * dispatcher.js — CLI Entry Point for the Dispatch Engine
 *
 * Thin wrapper around the orchestration SDK. Parses CLI arguments,
 * delegates core logic to `lib/orchestration/dispatch-engine.js`, then
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

import { runAsCli } from './lib/cli-utils.js';
import { Logger } from './lib/Logger.js';
import { resolveAndDispatch } from './lib/orchestration/index.js';

// Re-export SDK functions so that direct consumers of dispatcher.js
// (tests, CI scripts) continue to work without modification.
export {
  dispatch,
  executeStory,
  resolveAndDispatch,
} from './lib/orchestration/index.js';

// ---------------------------------------------------------------------------
// Presentation helpers (CLI-only — not part of the SDK)
// ---------------------------------------------------------------------------

import { parseSprintArgs } from './lib/cli-args.js';
import {
  persistManifest,
  printStoryDispatchTable,
} from './lib/presentation/manifest-renderer.js';

/**
 * High-level orchestrator that resolves the execution strategy, generates the manifest,
 * persists the files to temp, and outputs summaries.
 *
 * @param {number} ticketId
 * @param {boolean} [dryRun]
 * @param {string|null} [executorOverride]
 * @param {{ provider?: object }} [opts] - Optional overrides. `provider`
 *   lets callers pass a provider whose per-instance ticket cache is already
 *   primed, so dashboard regeneration issues zero extra REST calls.
 */
export async function generateAndSaveManifest(
  ticketId,
  dryRun = false,
  executorOverride = null,
  opts = {},
) {
  // Delegate to the SDK's unified resolver
  const manifest = await resolveAndDispatch({
    ticketId,
    dryRun,
    executorOverride,
    provider: opts.provider,
  });

  // Write manifest files using the new presentation abstraction
  persistManifest(manifest);

  if (manifest.type === 'story-execution') {
    const key = manifest.stories.map((s) => s.storyId).join('-');
    console.log(
      `\n[Dispatcher] ✅ Story manifest: temp/story-manifest-${key}.json`,
    );
    console.log(`[Dispatcher] 📄 Markdown: temp/story-manifest-${key}.md\n`);
    // Omit console dump for brevity
  } else {
    const epicId = manifest.epicId;
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
  return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/* node:coverage ignore next */
/* node:coverage ignore next */
async function main() {
  const { ticketId, dryRun, executor } = parseSprintArgs();

  if (!ticketId) {
    console.error(
      '[Dispatcher] Error: No valid Issue ID provided.\n' +
        'Usage: node dispatcher.js <ticketId> [--dry-run]',
    );
    process.exit(1);
  }

  await generateAndSaveManifest(ticketId, dryRun, executor);
}

runAsCli(import.meta.url, main, {
  source: 'Dispatcher',
  // Preserve legacy behaviour: report but do not exit; only abort via
  // Logger.fatal if DEBUG is set (the orchestration tests depend on this).
  onError: (err) => {
    console.error('[Dispatcher] Fatal error:', err.message);
    if (process.env.DEBUG) Logger.fatal();
  },
});
