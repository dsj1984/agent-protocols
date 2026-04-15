#!/usr/bin/env node
/**
 * generate-roadmap.js — v5 Roadmap Artifact Generator
 *
 * This script is responsible for generating the `ROADMAP.md` file in the
 * repository root. It serves as a read-only, auto-generated artifact that
 * mirrors the state of GitHub Issues (the Single Source of Truth).
 *
 * Usage:
 *   node generate-roadmap.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

/**
 * Renders a 10-character text progress bar.
 * @param {number} percentage - 0 to 100
 * @returns {string}
 */
function renderProgressBar(percentage) {
  const filledCount = Math.round(percentage / 10);
  const emptyCount = 10 - filledCount;
  return `\`${'█'.repeat(filledCount)}${'░'.repeat(emptyCount)}\``;
}

async function main() {
  const { settings, orchestration } = resolveConfig();
  const roadmapPath = settings.roadmap?.path || 'docs/ROADMAP.md';
  const excludeLabels = settings.roadmap?.excludeLabels || ['roadmap-exclude'];
  const fileName = path.basename(roadmapPath);

  console.log(`Syncing ${fileName} from GitHub Epics...`);

  const provider = createProvider(orchestration);

  // 1. Fetch all Epics (Open and Closed)
  const allEpics = await provider.getEpics({ state: 'all' });

  // Filter out excluded labels
  const filteredEpics = allEpics.filter((e) => {
    return !e.labels.some((l) => excludeLabels.includes(l));
  });

  // 2. Fetch children for all Epics to determine progress and classification
  // Using Promise.all for concurrency
  const epicsWithProgress = await Promise.all(
    filteredEpics.map(async (epic) => {
      try {
        const children = await provider.getTickets(epic.id);
        const total = children.length;
        const closed = children.filter(
          (t) => t.state === 'closed' || t.labels.includes('agent::done'),
        ).length;
        const percent = total > 0 ? Math.round((closed / total) * 100) : 0;

        return {
          ...epic,
          totalCount: total,
          closedCount: closed,
          percentage: percent,
        };
      } catch (err) {
        console.warn(
          `[RoadmapSync] Failed to fetch children for Epic #${epic.id}: ${err.message}`,
        );
        return {
          ...epic,
          totalCount: 0,
          closedCount: 0,
          percentage: 0,
        };
      }
    }),
  );

  // 3. Classify Epics
  const completed = epicsWithProgress
    .filter((e) => e.state === 'closed' && e.state_reason !== 'not_planned')
    .sort((a, b) => a.id - b.id);

  const inProgress = epicsWithProgress
    .filter((e) => e.state === 'open' && e.closedCount > 0)
    .sort((a, b) => a.id - b.id);

  const planned = epicsWithProgress
    .filter((e) => e.state === 'open' && e.closedCount === 0)
    .sort((a, b) => a.id - b.id);

  // 4. Build Markdown
  const lines = [
    '# Project Roadmap',
    '',
    '> **Auto-generated** from GitHub Issues — do not edit manually.',
    `> Last synced: ${new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })}`,
    '',
  ];

  const renderTable = (title, emoji, epics, statusText) => {
    if (epics.length === 0) return '';

    const tableLines = [
      `## ${emoji} ${title}`,
      '',
      '| Epic | Status | Progress |',
      '| ---- | ------ | -------- |',
    ];

    for (const epic of epics) {
      const url = `https://github.com/${orchestration.github.owner}/${orchestration.github.repo}/issues/${epic.id}`;
      const progressBar = renderProgressBar(epic.percentage);
      const progressText = `${progressBar} ${epic.percentage}% (${epic.closedCount}/${epic.totalCount})`;
      tableLines.push(
        `| [#${epic.id} — ${epic.title}](${url}) | ${emoji} ${statusText} | ${progressText} |`,
      );
    }

    tableLines.push('');
    return tableLines.join('\n');
  };

  // Sections in order: In Progress, Planned, Completed
  const inProgressTable = renderTable(
    'In Progress',
    '🚧',
    inProgress,
    'In Progress',
  );
  const plannedTable = renderTable('Planned', '📋', planned, 'Planned');
  const completedTable = renderTable('Completed', '✅', completed, 'Completed');

  if (inProgressTable) lines.push(inProgressTable);
  if (plannedTable) lines.push(plannedTable);
  if (completedTable) lines.push(completedTable);

  const content = `${lines.join('\n').trim()}\n`;

  // 5. Write to file
  const outputPath = path.resolve(PROJECT_ROOT, roadmapPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');

  console.log(`Successfully synced ${fileName} at ${outputPath}`);
}

main().catch((err) => {
  Logger.fatal(err.message);
});
