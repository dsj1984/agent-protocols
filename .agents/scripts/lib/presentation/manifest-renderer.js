/**
 * manifest-renderer.js
 *
 * Presentation logic for rendering markdown manifests and CLI dispatch tables.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function getProjectRoot() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../../../..');
}

export function persistManifest(manifest) {
  try {
    const PROJECT_ROOT = getProjectRoot();
    const manifestDir = path.join(PROJECT_ROOT, 'temp');
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    if (manifest.type === 'story-execution') {
      const key = manifest.stories.map((s) => s.storyId).join('-');
      fs.writeFileSync(
        path.join(manifestDir, `story-manifest-${key}.json`),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(manifestDir, `story-manifest-${key}.md`),
        renderStoryManifestMarkdown(manifest),
        'utf8',
      );
    } else if (manifest.epicId) {
      const epicId = manifest.epicId;
      fs.writeFileSync(
        path.join(manifestDir, `dispatch-manifest-${epicId}.json`),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(manifestDir, `dispatch-manifest-${epicId}.md`),
        renderManifestMarkdown(manifest),
        'utf8',
      );
    }
  } catch (persistErr) {
    process.stderr.write(
      `[MCP/Dispatcher] Failed to persist manifest to temp/: ${persistErr.message}\n`,
    );
  }
}

export function renderManifestMarkdown(manifest) {
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
      s.tasks.length > 0 && s.tasks.every((t) => t.status === 'agent::done'),
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
      stat.done += s.tasks.filter((t) => t.status === 'agent::done').length;
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
      lines.push(
        '| | Story | Title | Model Tier | Recommended Model | Tasks |',
      );
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

      for (const s of stories) {
        const allDone =
          s.tasks.length > 0 &&
          s.tasks.every((t) => t.status === 'agent::done');
        const storyCheckbox = allDone ? '✅' : '⬜';
        lines.push(
          `| ${storyCheckbox} | #${s.storyId} | ${s.storySlug} | \`${s.model_tier}\` | **${s.recommendedModel}** | ${s.tasks.length} |`,
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
      lines.push(`- **Recommended Model:** ${story.recommendedModel}`);
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

  // --- Agent Telemetry ---
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
    '2. Select the **Recommended Model** shown in the table for your agent session.',
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

export function renderStoryManifestMarkdown(manifest) {
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
  lines.push(
    '1. `node .agents/scripts/sprint-story-init.js --story <storyId>` (bootstraps branch, transitions tasks)',
  );
  lines.push('2. Implement each Task sequentially and commit after each one.');
  lines.push('3. Run `npm run lint` and `npm test` to validate.');
  lines.push(
    '4. `node .agents/scripts/sprint-story-close.js --story <storyId>` (merges, cleans up, closes tickets)',
  );
  lines.push('');

  return lines.join('\n');
}

export function printStoryDispatchTable(storyManifest) {
  if (!storyManifest || storyManifest.length === 0) return;

  // Split into wave-eligible Stories and Feature containers
  const stories = storyManifest.filter((s) => s.type !== 'feature');
  const features = storyManifest.filter((s) => s.type === 'feature');

  console.log(
    '\n┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐',
  );
  console.log(
    '│                                       📋 STORY DISPATCH TABLE                                          │',
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

  for (const story of stories) {
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

  if (features.length > 0) {
    console.log('');
    console.log('  📦 Feature Containers (not directly executable):');
    for (const f of features) {
      console.log(
        `     #${f.storyId} — ${f.storySlug} (${f.tasks.length} orphaned tasks)`,
      );
    }
  }
  console.log('');
}
