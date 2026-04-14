#!/usr/bin/env node
/* node:coverage ignore file */

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { getEpicBranch, getStoryBranch } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

export {
  hydrateContext,
  parseHierarchy,
  truncateToTokenBudget,
} from './lib/orchestration/context-hydrator.js';

import { hydrateContext } from './lib/orchestration/context-hydrator.js';

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      epic: { type: 'string' },
      output: { type: 'string' },
    },
    strict: false,
  });

  const taskId = parseInt(values.task ?? '', 10);
  const epicId = parseInt(values.epic ?? '', 10);

  if (!taskId || !epicId) {
    Logger.fatal();
  }

  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  console.error(
    `[Hydrator] Hydrating context for Task #${taskId} (Epic #${epicId})...`,
  );

  // Fetch full task ticket to get labels/body
  const t = await provider.getTicket(taskId);
  const labels = t.labels ?? [];
  const persona = labels
    .find((l) => l.startsWith('persona::'))
    ?.replace('persona::', '');
  const skills = labels
    .filter((l) => l.startsWith('skill::'))
    .map((l) => l.replace('skill::', ''));

  const task = {
    id: taskId,
    title: t.title,
    body: t.body ?? '',
    persona,
    skills,
  };

  // Resolve the story branch by parent story ID (v5: story-<storyId>)
  const parentMatch = (t.body ?? '').match(/parent:\s*#(\d+)/i);
  const storyId = parentMatch ? parseInt(parentMatch[1], 10) : taskId;
  const epicBranch = getEpicBranch(epicId);
  const taskBranch = getStoryBranch(epicId, storyId);

  const prompt = await hydrateContext(
    task,
    provider,
    epicBranch,
    taskBranch,
    epicId,
  );

  if (values.output) {
    fs.writeFileSync(values.output, prompt, 'utf8');
    console.error(`[Hydrator] ✅ Prompt written to: ${values.output}`);
  } else if (process.env.MCP_SERVER) {
    process.stderr.write(prompt);
  } else {
    process.stdout.write(prompt);
  }
}

runAsCli(import.meta.url, main, { source: 'ContextHydrator' });
