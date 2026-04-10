#!/usr/bin/env node
/* node:coverage ignore file */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSprintArgs } from './lib/cli-args.js';
import { resolveConfig } from './lib/config-resolver.js';
import { fetchTasks } from './lib/orchestration/task-fetcher.js';
import { fetchTelemetry } from './lib/orchestration/telemetry.js';
import { createProvider } from './lib/provider-factory.js';

const vlog = {
  info: (...args) => console.log('INFO:', ...args),
  warn: (...args) => console.warn('WARN:', ...args),
  error: (...args) => console.error('ERROR:', ...args),
};

export async function updateHealthMetrics(epicId, dryRun = false) {
  if (!epicId || Number.isNaN(epicId)) {
    throw new Error('updateHealthMetrics requires a valid epicId');
  }

  vlog.info(`Initializing health monitor for Epic #${epicId}...`);

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  const allEpicTickets = await provider.getTickets(epicId);
  const healthIssue = allEpicTickets.find(
    (t) =>
      (t.labels ?? []).includes('type::health') ||
      t.title.startsWith('📉 Sprint Health:'),
  );

  if (!healthIssue) {
    throw new Error(
      `No Sprint Health issue found for Epic #${epicId}. It must be created by the dispatcher first.`,
    );
  }

  const tasks = await fetchTasks(provider, epicId);

  let doneTasks = 0;
  let blockedTasks = 0;
  let inProgressTasks = 0;

  for (const task of tasks) {
    if ((task.labels ?? []).includes('agent::done')) doneTasks++;
    if ((task.labels ?? []).includes('agent::blocked')) blockedTasks++;
    if ((task.labels ?? []).includes('agent::executing')) inProgressTasks++;
  }

  // Attempt to fetch friction logs using recent comments
  const { totalFriction } = await fetchTelemetry(provider, tasks);

  const progressPercent =
    tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

  const body = `## Real-time Sprint Health Monitoring

This issue tracks the execution metrics, progress, and friction logs for this sprint.

| Metric | Status |
|--------|--------|
| **Progress** | \`${progressPercent}%\` |
| **Tasks** | \`${doneTasks}/${tasks.length}\` |
| **Executing** | \`${inProgressTasks}\` |
| **Blocked** | \`${blockedTasks}\` |
| **Friction Events** | \`${totalFriction}\` |

_Last updated: ${new Date().toISOString()}_

---
parent: #${epicId}
Epic: #${epicId}
`;

  if (dryRun) {
    vlog.info('--- DRY RUN: Would update Health Ticket Body ---');
    console.log(body);
  } else {
    vlog.info(`Updating Health Ticket #${healthIssue.id}`);
    await provider.updateTicket(healthIssue.id, {
      body: body,
    });
    vlog.info('✅ Health issue updated successfully.');
  }
}

// CLI execution fallback
/* node:coverage ignore next */
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { epicId, dryRun } = parseSprintArgs();
  if (!epicId) {
    console.error('Usage: node health-monitor.js --epic <number>');
    process.exit(1);
  }
  updateHealthMetrics(epicId, dryRun).catch((err) => {
    vlog.error(`Health Monitor fatal error: ${err.message}`);
    process.exit(1);
  });
}
