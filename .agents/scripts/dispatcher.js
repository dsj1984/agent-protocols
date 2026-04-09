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
import { Logger } from './lib/Logger.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from './lib/config-resolver.js';
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

/**
 * Render a human-readable Markdown document from the Epic dispatch manifest.
 *
 * @param {object} manifest - The full dispatch manifest object.
 * @returns {string} Markdown string.
 */
function renderManifestMarkdown(manifest) {
  const lines = [];
  const { epicId, epicTitle, summary, storyManifest, dryRun, generatedAt } =
    manifest;

  // --- Header ---
  lines.push(`# 📋 Dispatch Manifest — Epic #${epicId}`);
  lines.push('');
  lines.push(`> **${epicTitle}**`);
  lines.push('');
  // Compute story-level wave count (distinct earliestWave values)
  const storyWaveSet = new Set(
    (storyManifest ?? []).map((s) => s.earliestWave).filter((w) => w !== -1),
  );
  const storyWaveCount = storyWaveSet.size || 1;

  lines.push('| Field | Value |');
  lines.push('| :--- | :--- |');
  lines.push(`| Generated | ${generatedAt} |`);
  lines.push(`| Mode | ${dryRun ? '🔍 Dry Run' : '🚀 Live Dispatch'} |`);
  lines.push(
    `| Progress | **${summary.doneTasks}/${summary.totalTasks}** tasks (${summary.progressPercent}%) |`,
  );
  lines.push(`| Stories | ${(storyManifest ?? []).length} |`);
  lines.push(
    `| Story Waves | ${storyWaveCount} _(${summary.totalWaves} task-level waves)_ |`,
  );
  lines.push(`| Dispatched | ${summary.dispatched} |`);
  lines.push(`| Held for Approval | ${summary.heldForApproval} |`);
  lines.push('');

  // --- Progress bar ---
  const filled = Math.round(summary.progressPercent / 5);
  const empty = 20 - filled;
  lines.push(
    `**Progress:** ${'█'.repeat(filled)}${'░'.repeat(empty)} ${summary.progressPercent}%`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // --- Story Dispatch Table grouped by wave ---
  if (storyManifest && storyManifest.length > 0) {
    const waveGroups = new Map();
    for (const story of storyManifest) {
      const w = story.earliestWave ?? -1;
      if (!waveGroups.has(w)) waveGroups.set(w, []);
      waveGroups.get(w).push(story);
    }

    const sortedWaves = [...waveGroups.keys()].sort((a, b) => a - b);

    lines.push('## Execution Plan');
    lines.push('');

    for (const waveIdx of sortedWaves) {
      const stories = waveGroups.get(waveIdx);
      const waveLabel = waveIdx === -1 ? 'Ungrouped' : `Wave ${waveIdx}`;
      const parallelHint =
        stories.length > 1
          ? ` — ✅ ${stories.length} stories can run in parallel`
          : '';

      lines.push(`### ${waveLabel}${parallelHint}`);
      lines.push('');
      lines.push('| Story | Title | Model Tier | Recommended Model | Tasks |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');

      for (const s of stories) {
        lines.push(
          `| #${s.storyId} | ${s.storySlug} | \`${s.model_tier}\` | **${s.recommendedModel}** | ${s.tasks.length} |`,
        );
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    // --- Detailed story sections ---
    lines.push('## Story Details');
    lines.push('');

    for (const story of storyManifest) {
      const storyLabel =
        story.storyId === '__ungrouped__'
          ? 'Ungrouped Tasks'
          : `Story #${story.storyId}: ${story.storySlug}`;

      lines.push(`### ${storyLabel}`);
      lines.push('');
      lines.push(`- **Branch:** \`${story.branchName}\``);
      lines.push(`- **Model Tier:** \`${story.model_tier}\``);
      lines.push(`- **Recommended Model:** ${story.recommendedModel}`);
      lines.push(
        `- **Wave:** ${story.earliestWave === -1 ? 'N/A' : story.earliestWave}`,
      );
      lines.push('');
      lines.push('**Tasks (execution order):**');
      lines.push('');

      for (const task of story.tasks) {
        const isDone = task.status === 'agent::done';
        const checkbox = isDone ? '[x]' : '[ ]';
        const deps =
          task.dependencies && task.dependencies.length > 0
            ? ` _(blocked by: ${task.dependencies.map((d) => `#${d}`).join(', ')})_`
            : '';
        lines.push(
          `- ${checkbox} **#${task.taskId}** — ${task.taskSlug}${deps}`,
        );
      }
      lines.push('');
    }
  }

  // --- Execution instructions ---
  lines.push('---');
  lines.push('');
  lines.push('## How to Execute');
  lines.push('');
  lines.push('1. Pick a Story from Wave 0 (all dependencies satisfied).');
  lines.push(
    '2. Select the **Recommended Model** shown in the table for your agent session.',
  );
  lines.push('3. Run: `/sprint-execute #[Story ID]`');
  lines.push(
    '4. After completing a wave, re-run `/sprint-execute [Epic ID]` to refresh the dashboard.',
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Render a human-readable Markdown manifest for Story execution.
 *
 * @param {object} manifest - The story execution manifest.
 * @returns {string} Markdown string.
 */
function renderStoryManifestMarkdown(manifest) {
  const lines = [];
  lines.push(`# 📚 Story Execution Manifest`);
  lines.push('');
  lines.push(`> **Generated:** ${manifest.generatedAt}`);
  lines.push('');

  for (const story of manifest.stories) {
    lines.push(`## Story #${story.storyId}: ${story.storyTitle}`);
    lines.push(`- **Epic Branch:** \`${story.epicBranch}\``);
    lines.push(`- **Story Branch:** \`${story.branchName}\``);
    lines.push(`- **Model Tier:** \`${story.model_tier}\``);
    lines.push('');
    lines.push('**Tasks (execution order):**');
    for (const task of story.tasks) {
      const isDone = task.status === 'agent::done';
      const checkbox = isDone ? '[x]' : '[ ]';
      lines.push(`- ${checkbox} **#${task.taskId}** — ${task.title}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Execution Steps');
  lines.push('');
  lines.push('1. Ensure the Epic branch exists locally and on the remote.');
  lines.push('2. Checkout the Story branch from the Epic branch (not main):');
  lines.push('   `git checkout -b <storyBranch> <epicBranch>`');
  lines.push('3. Transition all child Tasks to `agent::executing`.');
  lines.push('4. Implement each Task sequentially and commit after each one.');
  lines.push('5. Run `npm run lint` and `npm test` to validate.');
  lines.push('6. Merge the Story branch into the Epic branch (`--no-ff`).');
  lines.push('7. Transition all Tasks and the Story to `agent::done`.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Print a human-readable Story Dispatch Table to stdout.
 *
 * @param {object[]} storyManifest
 */
function printStoryDispatchTable(storyManifest) {
  if (!storyManifest || storyManifest.length === 0) return;

  console.log(
    '\n┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐',
  );
  console.log(
    '│                                            📋 STORY DISPATCH TABLE                                                   │',
  );
  console.log(
    '├─────────┬──────────────────────────────────────┬──────┬────────────┬──────────────────────────────┬──────────────┤',
  );
  console.log(
    '│ Story   │ Title                                │ Wave │ Model Tier │ Recommended Model            │ Tasks        │',
  );
  console.log(
    '├─────────┼──────────────────────────────────────┼──────┼────────────┼──────────────────────────────┼──────────────┤',
  );

  for (const story of storyManifest) {
    const id =
      story.storyId === '__ungrouped__' ? '(none)' : `#${story.storyId}`;
    const title = (story.storySlug ?? '').substring(0, 36).padEnd(36);
    const wave = (
      story.earliestWave === -1 ? '-' : String(story.earliestWave)
    ).padEnd(4);
    const tier = (story.model_tier ?? '').padEnd(10);
    const model = (story.recommendedModel ?? '').substring(0, 28).padEnd(28);
    const taskCount = `${story.tasks.length} task(s)`.padEnd(12);
    console.log(
      `│ ${id.padEnd(7)} │ ${title} │ ${wave} │ ${tier} │ ${model} │ ${taskCount} │`,
    );
  }

  console.log(
    '└─────────┴──────────────────────────────────────┴──────┴────────────┴──────────────────────────────┴──────────────┘',
  );
  console.log('');
  console.log('  💡 Stories in the same [Wave] can be executed in parallel.');
  console.log(
    '  💡 Use /sprint-execute #[Story ID] to execute a Story. Select the model shown above.',
  );
  console.log('');
}

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
