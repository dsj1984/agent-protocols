#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';
import { fetchTasks } from './lib/orchestration/dispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vlog = {
  info: (...args) => console.log('INFO:', ...args),
  warn: (...args) => console.warn('WARN:', ...args),
  error: (...args) => console.error('ERROR:', ...args)
};

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string', short: 'e' },
      'dry-run': { type: 'boolean', default: false }
    },
    strict: true,
  });

  if (!values.epic) {
    console.error('Usage: node health-monitor.js --epic <number>');
    process.exit(1);
  }

  const epicId = parseInt(values.epic, 10);
  const dryRun = values['dry-run'];
  
  vlog.info(`Initializing health monitor for Epic #${epicId}...`);

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  const allEpicTickets = await provider.getTickets(epicId);
  const healthIssue = allEpicTickets.find((t) =>
    (t.labels ?? []).includes('type::health') || t.title.startsWith('📉 Sprint Health:')
  );

  if (!healthIssue) {
    vlog.error(`No Sprint Health issue found for Epic #${epicId}. It must be created by the dispatcher first.`);
    process.exit(1);
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
  let totalFriction = 0;
  try {
    const comments = await provider.getRecentComments(100);
    // filter comments that contain friction markers or were added to Task IDs
    const taskIds = new Set(tasks.map(t => t.id));
    for (const comment of comments) {
      if (taskIds.has(comment.issue_url ? parseInt(comment.issue_url.split('/').pop(), 10) : -1)) {
        if (comment.body && (comment.body.includes('[FRICTION]') || comment.body.includes('type: friction'))) {
          totalFriction++;
        }
      }
    }
  } catch (err) {
    vlog.warn(`Could not fetch recent comments: ${err.message}`);
  }

  const progressPercent = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

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
      body: body
    });
    vlog.info('✅ Health issue updated successfully.');
  }
}

main().catch((err) => {
  vlog.error(`Health Monitor fatal error: ${err.stack}`);
  process.exit(1);
});
