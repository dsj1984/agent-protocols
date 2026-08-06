#!/usr/bin/env node

// .agents/scripts/check-knip-entries.js — the guard #5001 left unbuilt.
//
// Story #5001 made two changes that are individually right and jointly unsafe:
// it replaced knip's blanket `.agents/scripts/*.js!` entry glob with an
// explicit list (so an uninvoked CLI surfaces as dead), and it promoted knip's
// `files` rule to `error` (so whole-file death produces baseline rows). The
// explicit list is hand-maintained; nothing checked it.
//
// So any CLI added after #5001 is, by default, invisible to knip: absent from
// the entry list, it reads as unreachable, emits a `{ file, symbol: '*' }` row,
// and drags every lib module only it imports into the dead set with it. Story
// #5012 hit exactly this — 5 false rows — and the ratchet's natural remedy
// (accept the diff) would have written live operator CLIs into
// `baselines/dead-exports-production.json` as expected-dead, permanently. It
// was caught by luck: a base-sync conflict forced a manual read of the diff.
//
// This gate removes the luck. It derives the invoked set from the executable
// surfaces #5001's own acceptance criterion named — package.json scripts, husky
// hooks, `.github/workflows`, `.agents` workflow/skill/agent/rule markdown, and
// script-to-script spawns — and asserts it matches `knip.json`'s entry array in
// both directions. See `lib/knip-entry-sync.js` for why liveness means
// *invoked* rather than *present*, and why documentation prose does not count.
//
// Measurement-free by construction: no knip spawn, no scorer, no coverage
// artifact. It is a directory read and a handful of regexes, which is what
// makes it cheap enough to sit in the required-check set next to
// `check-baseline-scope.js`.
//
// Exit codes:
//   0  entry list matches the invoked set
//   1  divergence — a missing, stale, or phantom entry
//   2  the check could not run (unreadable knip.json, unusable repository)

import process from 'node:process';
import { runAsCli } from './lib/cli-utils.js';
import {
  renderEntrySyncReport,
  resolveEntrySync,
} from './lib/knip-entry-sync.js';

const EXIT_PASS = 0;
const EXIT_DIVERGED = 1;
const EXIT_CANNOT_RUN = 2;

const HELP = {
  invocation:
    'node .agents/scripts/check-knip-entries.js [--cwd <dir>] [--json]',
  summary:
    "Assert knip.json's explicit .agents/scripts entry list matches the set of CLIs something actually invokes.",
  flags: [
    ['--cwd <dir>', 'Repository root to check. Default: process.cwd().'],
    ['--json', 'Emit the report as JSON instead of text.'],
  ],
  notes: [
    'Exit codes:\n  0  entry list matches\n  1  divergence\n  2  the check could not run',
    'A missing entry is the dangerous one: knip calls the CLI dead, and accepting\nthe dead-exports diff would record a live CLI as expected-dead (Story #5012).',
  ],
};

/**
 * Parse argv into an options bag. An unknown flag is a config error rather than
 * a silent no-op, matching `check-baseline-scope.js`.
 *
 * @param {string[]} argv
 * @returns {{ cwd: string | null, json: boolean }}
 */
export function parseArgs(argv = []) {
  const out = { cwd: null, json: false };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    i += 1;
    if (arg === '--json') out.json = true;
    else if (arg === '--cwd') {
      out.cwd = argv[i];
      i += 1;
    } else throw new Error(`unknown flag "${arg}" (try --help)`);
  }
  return out;
}

/**
 * Top-level CLI entry. Exported so tests can drive it against a fixture tree
 * without spawning a process.
 *
 * @param {{
 *   argv?: string[],
 *   cwd?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 * @returns {Promise<number>} 0 pass, 1 divergence, 2 cannot run
 */
export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`[knip-entries] ❌ ${err?.message ?? String(err)}\n`);
    return EXIT_CANNOT_RUN;
  }
  const repoRoot = args.cwd ?? cwd;
  const report = resolveEntrySync({ repoRoot });

  if (args.json) {
    stdout.write(
      `${JSON.stringify({ kind: 'knip-entry-sync', ...report }, null, 2)}\n`,
    );
    if (report.error) return EXIT_CANNOT_RUN;
    return report.missing.length + report.stale.length + report.phantom.length >
      0
      ? EXIT_DIVERGED
      : EXIT_PASS;
  }

  if (report.error) {
    stderr.write(`[knip-entries] ❌ ${report.error}\n`);
    return EXIT_CANNOT_RUN;
  }

  stdout.write(`\n--- knip-entries ---\n`);
  stdout.write(`${renderEntrySyncReport(report)}\n`);
  return report.missing.length + report.stale.length + report.phantom.length > 0
    ? EXIT_DIVERGED
    : EXIT_PASS;
}

runAsCli(import.meta.url, async () => runCli(), {
  source: 'knip-entries',
  propagateExitCode: true,
  errorPrefix: '[knip-entries] ❌ Fatal error',
  usage: HELP,
});
