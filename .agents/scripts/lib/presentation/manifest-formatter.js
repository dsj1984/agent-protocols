/**
 * manifest-formatter.js
 *
 * Pure Markdown / console rendering for dispatch and story manifests. No fs
 * access, no provider calls, no config I/O. Callers that need injected values
 * (e.g. `renderStoryManifestMarkdown`'s script-path hints) pass them via `opts`.
 *
 * The facade `manifest-renderer.js` re-exports from this module and owns the
 * one impure helper that reads config to build the options bag.
 */

import { AGENT_LABELS } from '../label-constants.js';

// ---------------------------------------------------------------------------
// Dispatch manifest (Epic-level) Markdown
// ---------------------------------------------------------------------------

export function formatManifestMarkdown(manifest, _opts = {}) {
  const lines = [];
  const { epicId, epicTitle, summary, storyManifest, dryRun, generatedAt } =
    manifest;

  // --- Header ---
  lines.push(`# 📋 Dispatch Manifest — Epic #${epicId}`);
  lines.push('');
  lines.push(`> **${epicTitle}**`);
  lines.push('');

  lines.push('## 🤖 Agent Operating Procedures');
  lines.push('');
  lines.push(
    '> 1. **Identify**: Start with the lowest available wave where `Status` is `🚀 Ready`.',
  );
  lines.push(
    '> 2. **Select**: Pick a Story from the **Execution Plan** that is not yet `✅`.',
  );
  lines.push('> 3. **Execute**: Run `/sprint-execute [STORY_ID]`.');
  lines.push(
    '> 4. **Repeat**: Continue iterating on execution until all stories and waves are complete',
  );
  lines.push('> 5. **Close**: Run `/sprint-close`');
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
  const storyCount = (storyManifest ?? []).filter(
    (s) => s.storyId !== '__ungrouped__' && s.type === 'story',
  ).length;
  const featureCount = (storyManifest ?? []).filter(
    (s) => s.type === 'feature',
  ).length;
  lines.push(`| Stories | ${storyCount} |`);
  if (featureCount > 0)
    lines.push(`| Features (containers) | ${featureCount} |`);
  lines.push(
    `| Execution Waves | ${storyWaveCount} _(${summary.totalWaves} task-level waves)_ |`,
  );
  lines.push(`| Dispatched | ${summary.dispatched} |`);
  lines.push(`| Held for Approval | ${summary.heldForApproval} |`);
  lines.push('');

  // --- Hero Progress Bar ---
  const pct = summary.progressPercent;
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const statusEmoji = pct === 100 ? '🎉' : pct >= 50 ? '🔥' : '🏗️';
  lines.push(`## ${statusEmoji} Sprint Progress`);
  lines.push('');
  lines.push('```');
  lines.push(
    `  ${bar}  ${pct}%  (${summary.doneTasks}/${summary.totalTasks} tasks)`,
  );
  lines.push('```');
  lines.push('');
  // Compute story-level completion for the hero section
  const allStoryItems = (storyManifest ?? []).filter(
    (s) => s.type === 'story' && s.storyId !== '__ungrouped__',
  );
  const doneStories = allStoryItems.filter(
    (s) =>
      s.tasks.length > 0 &&
      s.tasks.every((t) => t.status === AGENT_LABELS.DONE),
  ).length;
  lines.push(
    `> **Stories:** ${doneStories}/${allStoryItems.length} complete · **Tasks:** ${summary.doneTasks}/${summary.totalTasks} complete`,
  );
  lines.push('');

  // --- Wave Summary Table ---
  // Only Stories participate in execution waves. Features are containers.
  const allItems =
    manifest.storyManifest ||
    manifest.stories ||
    manifest.summary?.stories ||
    [];
  const waveEligible = allItems.filter((s) => s.type !== 'feature');
  if (waveEligible && waveEligible.length > 0) {
    const waveStats = new Map();

    for (const s of waveEligible) {
      const w = s.earliestWave ?? -1;
      if (!waveStats.has(w)) {
        waveStats.set(w, { stories: 0, tasks: 0, done: 0 });
      }
      const stat = waveStats.get(w);
      stat.stories++;
      stat.tasks += s.tasks.length;
      stat.done += s.tasks.filter((t) => t.status === AGENT_LABELS.DONE).length;
    }

    const sortedWaves = [...waveStats.keys()].sort((a, b) => a - b);
    lines.push('## Wave Summary');
    lines.push('');
    lines.push('| Wave | Stories | Progress | Tasks | Status |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');

    for (const w of sortedWaves) {
      const stat = waveStats.get(w);
      const isDone = stat.tasks > 0 && stat.done === stat.tasks;
      const waveLabel = w === -1 ? 'Ungrouped' : `Wave ${w}`;
      const isReady =
        w === 0 ||
        sortedWaves
          .filter((sw) => sw < w)
          .every((sw) => {
            const swStat = waveStats.get(sw);
            return swStat.done === swStat.tasks;
          });

      const statusLabel = isDone
        ? '✅ Done'
        : isReady
          ? '🚀 Ready'
          : '⏳ Blocked';
      // Mini progress bar for the wave
      const wavePct =
        stat.tasks > 0 ? Math.round((stat.done / stat.tasks) * 100) : 0;
      const waveFilled = Math.round(wavePct / 10);
      const waveEmpty = 10 - waveFilled;
      const waveBar = '█'.repeat(waveFilled) + '░'.repeat(waveEmpty);
      lines.push(
        `| ${waveLabel} | ${stat.stories} | ${waveBar} ${wavePct}% | ${stat.done}/${stat.tasks} | ${statusLabel} |`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // --- Story Dispatch Table grouped by wave (Features excluded from waves) ---
  if (storyManifest && storyManifest.length > 0) {
    const waveStories = storyManifest.filter((s) => s.type !== 'feature');
    const featureItems = storyManifest.filter((s) => s.type === 'feature');

    const waveGroups = new Map();
    for (const story of waveStories) {
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
      lines.push('| | Story | Title | Model Tier | Tasks |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');

      for (const s of stories) {
        const allDone =
          s.tasks.length > 0 &&
          s.tasks.every((t) => t.status === AGENT_LABELS.DONE);
        const storyCheckbox = allDone ? '✅' : '⬜';
        lines.push(
          `| ${storyCheckbox} | #${s.storyId} | ${s.storySlug} | \`${s.model_tier}\` | ${s.tasks.length} |`,
        );
      }
      lines.push('');
    }

    // --- Feature Containers (informational, not executable) ---
    if (featureItems.length > 0) {
      lines.push('## Feature Containers');
      lines.push('');
      lines.push(
        '> Features are organizational groupings and are **not directly executable**.',
      );
      lines.push('> Execute the Stories within each Feature instead.');
      lines.push('');
      lines.push('| Feature | Title | Child Tasks |');
      lines.push('| :--- | :--- | :--- |');
      for (const f of featureItems) {
        lines.push(`| #${f.storyId} | ${f.storySlug} | ${f.tasks.length} |`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    // --- Detailed story sections ---
    lines.push('## Story Details');
    lines.push('');

    for (const story of storyManifest) {
      const typeLabel =
        (story.type || 'story').charAt(0).toUpperCase() +
        (story.type || 'story').slice(1);
      const storyLabel =
        story.storyId === '__ungrouped__'
          ? 'Ungrouped Tasks'
          : `${typeLabel} #${story.storyId}: ${story.storySlug}`;
      const isFeature = story.type === 'feature';

      lines.push(`### ${storyLabel}`);
      lines.push('');
      lines.push(`- **Branch:** \`${story.branchName}\``);
      lines.push(`- **Model Tier:** \`${story.model_tier}\``);
      if (isFeature) {
        lines.push('- **Type:** Feature (container — not directly executable)');
      } else {
        lines.push(
          `- **Wave:** ${story.earliestWave === -1 ? 'N/A' : story.earliestWave}`,
        );
      }
      lines.push('');
      lines.push('**Tasks (execution order):**');
      lines.push('');

      for (const task of story.tasks) {
        const isDone = task.status === AGENT_LABELS.DONE;
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

  // --- Agent Telemetry ---
  /* node:coverage ignore next */
  if (manifest.agentTelemetry) {
    lines.push('## 📈 Agent Telemetry & Diagnostics');
    lines.push('');
    lines.push(
      `- **Total Friction Events:** ${manifest.agentTelemetry.totalFriction}`,
    );
    if (manifest.agentTelemetry.recentFriction.length > 0) {
      lines.push('- **Active Issues & Friction:**');
      for (const item of manifest.agentTelemetry.recentFriction) {
        const safeMessage = item.message
          .replace(/\s+/g, ' ')
          .replace(/\n/g, ' ')
          .trim();
        lines.push(`  - Task **#${item.taskId}**: ${safeMessage}`);
      }
    } else {
      lines.push('- **Active Issues:** None recorded.');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // --- Execution instructions ---
  lines.push('## How to Execute');
  lines.push('');
  lines.push('1. Pick a Story from the next ready wave (🚀 status above).');
  lines.push(
    "2. Select a model that matches the Story's **Model Tier** (`high` = deep-reasoning, `low` = fast execution). The concrete model choice is left to the operator/router.",
  );
  lines.push('3. Run: `/sprint-execute #[Story ID]`');
  lines.push('');
  lines.push(
    '> **Tip:** Story closure and dashboard refresh are handled automatically by `sprint-story-close.js`. ' +
      'Check the updated `temp/` manifest files after closing a story.',
  );
  lines.push('');

  return lines.join('\n');
}

// Backward-compat alias (existing callers and tests import this name).
export const renderManifestMarkdown = formatManifestMarkdown;

// ---------------------------------------------------------------------------
// Story-execution manifest Markdown
// ---------------------------------------------------------------------------

/**
 * Format the per-story execution manifest. Pure: caller must supply
 * `opts.settings` (typically the resolved agentSettings bag) so we can cite
 * the canonical `sprint-story-init.js` / `sprint-story-close.js` paths without
 * touching `resolveConfig` (fs).
 *
 * @param {object} manifest
 * @param {{ settings: { scriptsRoot: string, validationCommand?: string, testCommand?: string } }} opts
 * @returns {string}
 */
export function formatStoryManifestMarkdown(manifest, opts = {}) {
  const settings = opts.settings ?? {};
  const scriptsRoot = settings.scriptsRoot ?? '.agents/scripts';
  const validationCommand = settings.validationCommand ?? 'npm run lint';
  const testCommand = settings.testCommand ?? 'npm test';

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
      const isDone = task.status === AGENT_LABELS.DONE;
      const checkbox = isDone ? '[x]' : '[ ]';
      const deps =
        task.dependencies && task.dependencies.length > 0
          ? ` _(blocked by: ${task.dependencies.map((d) => `#${d}`).join(', ')})_`
          : '';
      lines.push(`- ${checkbox} **#${task.taskId}** — ${task.title}${deps}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Execution Steps');
  lines.push('');

  const initPath = `${scriptsRoot}/sprint-story-init.js`;
  const closePath = `${scriptsRoot}/sprint-story-close.js`;

  lines.push(
    `1. \`node ${initPath} --story <storyId>\` (bootstraps branch, transitions tasks)`,
  );
  lines.push('2. Implement each Task sequentially and commit after each one.');
  lines.push(
    `3. Run \`${validationCommand}\` and \`${testCommand}\` to validate.`,
  );
  lines.push(
    `4. \`node <main-repo>/${closePath} --story <storyId> --cwd <main-repo>\` (merges, cleans up, closes tickets)`,
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Story dispatch table (CLI output)
// ---------------------------------------------------------------------------

/**
 * Print the CLI Story Dispatch Table. Writes to the supplied `logger.log`
 * channel (defaults to `console.log`). Keeping the sink injectable makes the
 * function testable without capturing stdout.
 *
 * @param {object[]} storyManifest
 * @param {{ logger?: { log: (line: string) => void } }} [opts]
 */
/* node:coverage ignore next */
export function printStoryDispatchTable(storyManifest, opts = {}) {
  const log = opts.logger?.log ?? ((line) => console.log(line));
  if (!storyManifest || storyManifest.length === 0) return;

  // Split into wave-eligible Stories and Feature containers
  const stories = storyManifest.filter((s) => s.type !== 'feature');
  const features = storyManifest.filter((s) => s.type === 'feature');

  log(
    '\n┌─────────┬──────────────────────────────────────┬──────┬────────────┬──────────────┐',
  );
  log(
    '│                           📋 STORY DISPATCH TABLE                            │',
  );
  log(
    '├─────────┼──────────────────────────────────────┼──────┼────────────┼──────────────┤',
  );
  log(
    '│ Story   │ Title                                │ Wave │ Model Tier │ Tasks        │',
  );
  log(
    '├─────────┼──────────────────────────────────────┼──────┼────────────┼──────────────┤',
  );

  for (const story of stories) {
    const id =
      story.storyId === '__ungrouped__' ? '(none)' : `#${story.storyId}`;
    const title = (story.storySlug ?? '').substring(0, 36).padEnd(36);
    const wave = (
      story.earliestWave === -1 ? '-' : String(story.earliestWave)
    ).padEnd(4);
    const tier = (story.model_tier ?? '').padEnd(10);
    const taskCount = `${story.tasks.length} task(s)`.padEnd(12);
    log(`│ ${id.padEnd(7)} │ ${title} │ ${wave} │ ${tier} │ ${taskCount} │`);
  }

  log(
    '└─────────┴──────────────────────────────────────┴──────┴────────────┴──────────────┘',
  );
  log('');
  log('  💡 Stories in the same [Wave] can be executed in parallel.');
  log(
    '  💡 Use /sprint-execute #[Story ID] to execute a Story. Pick a model matching the Model Tier.',
  );

  if (features.length > 0) {
    log('');
    log('  📦 Feature Containers (not directly executable):');
    for (const f of features) {
      log(
        `     #${f.storyId} — ${f.storySlug} (${f.tasks.length} orphaned tasks)`,
      );
    }
  }
  log('');
}
