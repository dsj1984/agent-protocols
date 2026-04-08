import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveConfig } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';
import { getEpicBranch, getStoryBranch } from './lib/git-utils.js';

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
    console.error('Usage: node context-hydrator.js --task <taskId> --epic <epicId> [--output <file>]');
    process.exit(1);
  }

  const { settings, orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  console.log(`[Hydrator] Hydrating context for Task #${taskId} (Epic #${epicId})...`);

  // Fetch full task ticket to get labels/body
  const t = await provider.getTicket(taskId);
  const labels = t.labels ?? [];
  const persona = labels.find(l => l.startsWith('persona::'))?.replace('persona::', '');
  const skills = labels.filter(l => l.startsWith('skill::')).map(l => l.replace('skill::', ''));

  const task = {
    id: taskId,
    title: t.title,
    body: t.body ?? '',
    persona,
    skills
  };

  const epicBranch = getEpicBranch(epicId);
  const taskBranch = getStoryBranch(epicId, t.title); // Fallback: try to find parent story title?

  const prompt = await hydrateContext(task, provider, epicBranch, taskBranch, epicId);

  if (values.output) {
    fs.writeFileSync(values.output, prompt, 'utf8');
    console.log(`[Hydrator] ✅ Prompt written to: ${values.output}`);
  } else {
    process.stdout.write(prompt);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Hydrator] Fatal error:', err.message);
    process.exit(1);
  });
}
