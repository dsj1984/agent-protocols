#!/usr/bin/env node
/* node:coverage ignore file */
/**
 * Epic Runner — thin CLI wrapper around `lib/orchestration/epic-runner.js`.
 *
 * Scaffolded by Story #331. The engine it wraps is added in a follow-up Story
 * (see tech spec #323, Core Components → `lib/orchestration/epic-runner.js`).
 * Until the engine lands, this CLI exits with a clear `not-yet-implemented`
 * message rather than silently no-op'ing — making the dependency explicit for
 * anyone wiring `/sprint-execute-epic` before the engine merge.
 *
 * Usage:
 *   node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]
 */

import { runAsCli } from './lib/cli-utils.js';

function parseArgs(argv) {
  const args = { epicId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--epic') {
      args.epicId = Number(argv[++i]);
    } else if (flag === '--dry-run') {
      args.dryRun = true;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node .agents/scripts/epic-runner.js --epic <epicId> [--dry-run]',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.epicId || Number.isNaN(args.epicId)) {
    console.error('[epic-runner] ERROR: --epic <epicId> is required.');
    printUsage();
    process.exit(2);
  }

  const { runEpic } = await import('./lib/orchestration/epic-runner.js');
  const { resolveConfig } = await import('./lib/config-resolver.js');
  const { createProvider } = await import('./lib/provider-factory.js');

  const config = resolveConfig();
  if (!config.orchestration) {
    console.error(
      '[epic-runner] ERROR: no orchestration block in .agentrc.json.',
    );
    process.exit(1);
  }

  const provider = createProvider(config.orchestration);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          epicId: args.epicId,
          dryRun: true,
          epicRunner: config.orchestration.epicRunner,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await runEpic({
    epicId: args.epicId,
    provider,
    config: config.orchestration,
    spawn: defaultSpawn,
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Default spawn adapter — delegates to the in-repo `/sprint-execute-story`
 * CLI. Real usage inside the Claude remote-agent environment replaces this
 * with an Agent-tool invocation at the skill layer.
 */
async function defaultSpawn({ storyId }) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    ['.agents/scripts/sprint-story-init.js', '--story', String(storyId)],
    { stdio: 'inherit', shell: false },
  );
  if (r.status !== 0) return { status: 'failed', detail: `exit ${r.status}` };
  return { status: 'done' };
}

runAsCli(import.meta.url, main, { source: 'EpicRunner' });
