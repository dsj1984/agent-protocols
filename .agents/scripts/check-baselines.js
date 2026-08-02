#!/usr/bin/env node

// .agents/scripts/check-baselines.js — Story #2466 thin CLI shell.
//
// Unified baseline dispatcher. The pipeline now lives under
// `lib/orchestration/check-baselines/phases/`:
//
//   1. parse-args  — CLI flag parsing + canned `--help` text.
//   2. floors      — `compareToFloor`, `assertFloorAxesExist`, `applyFloors`.
//   3. compare     — scope resolution, base-baseline read, compare + tolerance.
//   4. evaluate    — per-kind pipeline: load → floor → compare → tolerance.
//   5. friction    — centralised friction emission (one event per
//                    {kind, severity} tuple).
//   6. report      — JSON / text rendering of the aggregated report.
//   7. pipeline    — fan-out across enabled kinds, accumulate, aggregate
//                    exit codes via `lib/baselines/exit-codes#aggregate`.
//
// Public CLI surface, exit codes, and friction payloads are byte-identical
// to the pre-refactor implementation. The named exports below are the
// same set the existing unit tests import.
//
// Pipeline stages per kind (Story #1965 / Task #1977):
//   1. schema   — `reader.load(kind)` validates against per-kind schema.
//   2. floor    — `applyFloors(kind, rollup, gateBlock.floors)`.
//   3. tolerance — `gateBlock.tolerance` clamps near-floor compare deltas.
//   4. compare   — head vs base via `git-base.readBaseFromGit(ref, path)`.
//
// Exit-code contract (Task #1975, see `lib/baselines/exit-codes.js`):
//   0 EXIT_PASS        — every enabled gate is green.
//   1 EXIT_FLOOR       — at least one floor breach.
//   2 EXIT_SCHEMA      — at least one schema validation error.
//   3 EXIT_CONFIG      — config resolution failure (mapped by main()).
//   4 EXIT_REGRESSION  — at least one head-vs-base regression.

// Fail-fast if the framework's runtime deps are not installed — must be the
// first import so the check runs before any third-party-importing sibling
// module is evaluated (Story #3432).
import './lib/runtime-deps/ensure-installed.js';
import { EXIT_CONFIG } from './lib/baselines/exit-codes.js';
import { runAsCli } from './lib/cli-utils.js';
import {
  applyFloors,
  assertFloorAxesExist,
  compareToFloor,
} from './lib/orchestration/check-baselines/phases/floors.js';
import {
  HELP_TEXT,
  parseArgs,
} from './lib/orchestration/check-baselines/phases/parse-args.js';
import {
  runCheckBaselines,
  selectEnabledGates,
} from './lib/orchestration/check-baselines/phases/pipeline.js';
import { formatReport } from './lib/orchestration/check-baselines/phases/report.js';

// Named exports preserved for the unit-test surface (Story #2466 — byte-
// identical CLI parity). Tests import directly from this module path.
export {
  applyFloors,
  assertFloorAxesExist,
  compareToFloor,
  formatReport,
  parseArgs,
  runCheckBaselines,
  selectEnabledGates,
};

/**
 * Run the dispatcher and *return* its exit code rather than calling
 * `process.exit()`.
 *
 * The return is load-bearing (Story #4783's defect, reintroduced here):
 * `process.exit()` terminates before a queued async pipe write drains, so a
 * full `--gate coverage` report — a quarter of a megabyte of JSON — arrived
 * truncated at the 64 KiB pipe boundary under the `| tee` in CI's coverage
 * step, while still exiting 0. Handing the code back to `runAsCli`'s
 * `propagateExitCode` path settles it through `settleCli`/`flushStdio`
 * instead, which assigns `process.exitCode` and lets Node terminate once
 * stdout has drained. The 0/1/2/3/4 contract in `lib/baselines/exit-codes.js`
 * is unchanged — only *when* the process leaves is.
 *
 * @returns {Promise<number>} An exit code from the `EXIT_*` contract.
 */
async function main() {
  let result;
  try {
    result = await runCheckBaselines({ argv: process.argv.slice(2) });
  } catch (err) {
    const message = err?.message ?? String(err);
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: '1', error: message }, null, 2)}\n`,
    );
    return EXIT_CONFIG;
  }
  process.stdout.write(`${result.output}\n`);
  return result.exitCode;
}

runAsCli(import.meta.url, main, {
  source: 'check-baselines',
  usage: HELP_TEXT,
  propagateExitCode: true,
});
