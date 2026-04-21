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

  // The engine is implemented in a later Story. Fail loudly until then so
  // /sprint-execute-epic wiring that arrives first does not silently succeed.
  let runEpic;
  try {
    ({ runEpic } = await import('../../lib/orchestration/epic-runner.js'));
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(
        '[epic-runner] ERROR: engine not yet implemented ' +
          '(lib/orchestration/epic-runner.js missing). ' +
          'This CLI is a scaffold from Story #331; the engine lands in a ' +
          'follow-up Story per tech spec #323.',
      );
      process.exit(64);
    }
    throw err;
  }

  const result = await runEpic({
    epicId: args.epicId,
    options: { dryRun: args.dryRun },
  });

  console.log(JSON.stringify(result, null, 2));
}

runAsCli(import.meta.url, main, { source: 'EpicRunner' });
