#!/usr/bin/env node

// .agents/scripts/check-baseline-drift.js — scheduled full-scope baseline
// drift check (Story #4776).
//
// The three per-PR enforcement sites (close-validation, pre-push, CI) are all
// diff-scoped: they compare the files a branch touched against their committed
// baseline rows. A file nobody touches after its row is written is therefore
// never re-scored, so drift introduced indirectly — a dependency getting more
// complex, coverage moving underneath a method — stays invisible indefinitely.
//
// This CLI is the periodic full-scope counterpart. It re-scores every target
// directory through the same scorer that writes the baseline, prints a per-row
// before/after table for everything that moved beyond the gate's tolerance,
// and exits non-zero when it finds any — so a consumer can wire it as a
// scheduled CI job without wrapping it in verdict-parsing glue. Wiring it is
// deliberately consumer-side work; nothing in this repo schedules it.
//
// Exit codes:
//   0 — no drift (or every kind skipped: disabled gate, no baseline, no scorer)
//   1 — drift detected in at least one kind
//   2 — the check itself could not run

// Fail-fast if the framework's runtime deps are not installed — must be the
// first import so the check runs before any third-party-importing sibling
// module is evaluated (Story #3432).
import './lib/runtime-deps/ensure-installed.js';
import {
  DRIFT_KINDS,
  detectBaselineDrift,
  formatDriftReport,
} from './lib/baselines/drift-detector.js';
import { runAsCli } from './lib/cli-utils.js';

export const HELP_TEXT = `Usage: node .agents/scripts/check-baseline-drift.js [options]

Re-score the configured baselines FULL-SCOPE and report every row whose
current score has drifted from its committed baseline by more than the
gate's tolerance — including files untouched by any recent diff, which the
diff-scoped gates structurally cannot see.

Options:
  --gate <kind>       Restrict to one kind (repeatable). Default: ${DRIFT_KINDS.join(', ')}.
  --tolerance <n>     Override the per-gate absolute tolerance.
  --json              Emit the machine-readable report instead of the table.
  -h, --help          Show this help.

Exit codes: 0 no drift · 1 drift detected · 2 the check could not run.

On drift, refresh with the printed \`*:update -- --full-scope\` command and
commit the result with a \`baseline-refresh:\` tagged subject (non-empty body).`;

/**
 * Parse the CLI surface. Unknown flags are rejected so a typo'd `--gate`
 * cannot silently widen a scheduled job's scope.
 *
 * @param {string[]} argv
 * @returns {{ kinds: string[], tolerance: number|null, json: boolean }}
 */
export function parseArgs(argv = []) {
  const kinds = [];
  let tolerance = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--gate' && argv[i + 1]) {
      const kind = argv[i + 1];
      if (!DRIFT_KINDS.includes(kind)) {
        throw new Error(
          `[drift] unknown --gate "${kind}"; expected one of ${DRIFT_KINDS.join(', ')}`,
        );
      }
      kinds.push(kind);
      i += 1;
    } else if (arg === '--tolerance' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value)) {
        throw new Error(
          `[drift] --tolerance must be a number (got ${argv[i + 1]})`,
        );
      }
      tolerance = value;
      i += 1;
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`[drift] unrecognised argument "${arg}"`);
    }
  }
  return {
    kinds: kinds.length > 0 ? kinds : [...DRIFT_KINDS],
    tolerance,
    json,
  };
}

/**
 * Run the drift check and render it. Returns the process exit code rather
 * than exiting, so the whole path is unit-testable.
 *
 * @param {{ argv?: string[], cwd?: string, detect?: typeof detectBaselineDrift }} opts
 * @returns {Promise<{ exitCode: number, output: string }>}
 */
export async function runCheckBaselineDrift({
  argv = [],
  cwd = process.cwd(),
  detect = detectBaselineDrift,
} = {}) {
  const args = parseArgs(argv);
  const run = await detect({
    kinds: args.kinds,
    cwd,
    tolerance: args.tolerance,
  });
  const output = args.json
    ? JSON.stringify({ schemaVersion: '1', ...run }, null, 2)
    : formatDriftReport(run);
  return { exitCode: run.ok ? 0 : 1, output };
}

/**
 * Run the drift check and *return* its exit code rather than calling
 * `process.exit()` — this CLI prints one row per drifted baseline entry
 * full-scope, so its report is exactly the kind of payload that outgrows the
 * 64 KiB pipe buffer under a `| tee`. `process.exit()` terminates before a
 * queued async pipe write drains, silently truncating it (Story #4783, the
 * same defect `check-baselines.js` carried). Handing the code back lets
 * `runAsCli`'s `propagateExitCode` path settle it through
 * `settleCli`/`flushStdio` instead. The 0/1/2 contract documented at the top
 * of this file is unchanged — only *when* the process leaves is.
 *
 * @returns {Promise<number>} 0 no drift, 1 drift detected, 2 could not run.
 */
async function main() {
  let result;
  try {
    result = await runCheckBaselineDrift({ argv: process.argv.slice(2) });
  } catch (err) {
    process.stdout.write(`${err?.message ?? String(err)}\n`);
    return 2;
  }
  process.stdout.write(`${result.output}\n`);
  return result.exitCode;
}

runAsCli(import.meta.url, main, {
  source: 'check-baseline-drift',
  usage: HELP_TEXT,
  exitCode: 2,
  propagateExitCode: true,
});
