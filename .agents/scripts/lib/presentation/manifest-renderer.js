/**
 * manifest-renderer.js
 *
 * Presentation logic for rendering markdown manifests and CLI dispatch tables.
 */

export function renderManifestMarkdown(manifest) {
  // DEBUG HELPER
  process.stderr.write(`[MCP] Rendering manifest for Epic #${manifest.epicId || 'unknown'}. Keys: ${Object.keys(manifest).join(', ')}\n`);

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
  lines.push(`| Stories/Features | ${(storyManifest ?? []).filter(s => s.storyId !== '__ungrouped__').length} |`);
  lines.push(
    `| Execution Waves | ${storyWaveCount} _(${summary.totalWaves} task-level waves)_ |`,
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

  // --- Wave Summary Table ---
  // Detailed fallback for robustness across different SDK versions/entrypoints
  const stories = manifest.storyManifest || manifest.stories || (manifest.summary && manifest.summary.stories) || [];
  if (stories && stories.length > 0) {
    const waveStats = new Map();

    for (const s of stories) {
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
    lines.push('| Wave | Items | Total Tasks | Done | Status |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');

    for (const w of sortedWaves) {
      const stat = waveStats.get(w);
      const isDone = stat.tasks > 0 && stat.done === stat.tasks;
      const isReady = w === 0 || sortedWaves.filter(sw => sw < w).every(sw => {
        const swStat = waveStats.get(sw);
        return swStat.done === swStat.tasks;
      });
      
      const statusLabel = isDone ? '✅ Done' : (isReady ? '🚀 Ready' : '⏳ Blocked');
      lines.push(
        `| ${waveLabel} | ${stat.stories} | ${stat.tasks} | ${stat.done} | ${statusLabel} |`,
      );
    }
    lines.push('');
  }

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
          ? ` — ✅ ${stories.length} items can run in parallel`
          : '';

      lines.push(`### ${waveLabel}${parallelHint}`);
      lines.push('');
      lines.push('| Ticket | Title | Type | Model Tier | Recommended Model | Tasks |');
      lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

      for (const s of stories) {
        const typeLabel = (s.type || 'story').charAt(0).toUpperCase() + (s.type || 'story').slice(1);
        lines.push(
          `| #${s.storyId} | ${s.storySlug} | ${typeLabel} | \`${s.model_tier}\` | **${s.recommendedModel}** | ${s.tasks.length} |`,
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
      const typeLabel = (story.type || 'story').charAt(0).toUpperCase() + (story.type || 'story').slice(1);
      const storyLabel =
        story.storyId === '__ungrouped__'
          ? 'Ungrouped Tasks'
          : `${typeLabel} #${story.storyId}: ${story.storySlug}`;

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

export function printStoryDispatchTable(storyManifest) {
  if (!storyManifest || storyManifest.length === 0) return;

  console.log(
    '\n┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐',
  );
  console.log(
    '│                                            📋 STORY DISPATCH TABLE                                                   │',
  );
  console.log(
    '├─────────┬──────────────────────────────────────┬─────────┬──────┬────────────┬──────────────────────────────┬──────────────┤',
  );
  console.log(
    '│ Ticket  │ Title                                │ Type    │ Wave │ Model Tier │ Recommended Model            │ Tasks        │',
  );
  console.log(
    '├─────────┼──────────────────────────────────────┼─────────┼──────┼────────────┼──────────────────────────────┼──────────────┤',
  );

  for (const story of storyManifest) {
    const id =
      story.storyId === '__ungrouped__' ? '(none)' : `#${story.storyId}`;
    const title = (story.storySlug ?? '').substring(0, 36).padEnd(36);
    const type = (story.type || 'story').substring(0, 7).padEnd(7);
    const wave = (
      story.earliestWave === -1 ? '-' : String(story.earliestWave)
    ).padEnd(4);
    const tier = (story.model_tier ?? '').padEnd(10);
    const model = (story.recommendedModel ?? '').substring(0, 28).padEnd(28);
    const taskCount = `${story.tasks.length} task(s)`.padEnd(12);
    console.log(
      `│ ${id.padEnd(7)} │ ${title} │ ${type} │ ${wave} │ ${tier} │ ${model} │ ${taskCount} │`,
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
