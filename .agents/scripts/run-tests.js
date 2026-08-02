#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * Cross-platform driver for `npm test`.
 *
 * npm lifecycle `posttest` scripts only run after a successful `test` script.
 * This wrapper keeps cleanup in the same process path as the Node test runner
 * so reserved test temp artefacts are removed even when tests fail.
 *
 * Webhook scrub: the test child inherits an environment where
 * `NOTIFICATION_WEBHOOK_URL` is unset and `NODE_ENV=test`. Operators keep a
 * real webhook URL in `.env` for development (resolveConfig loads it into
 * process.env); without this scrub, any test that transitively reaches
 * `notify()` POSTs to the live endpoint. Set `MANDREL_ALLOW_TEST_WEBHOOKS=1`
 * to opt back in for the rare case where a contract test deliberately
 * exercises a sandbox endpoint.
 *
 * Windows arg-length safety: the `quick` / `integration` tiers enumerate
 * explicit test-file targets (they exclude specific slow suites, so a single
 * glob will not do). With ~700+ targets the joined command line crosses the
 * Windows `CreateProcess` ~32 767-char `lpCommandLine` ceiling, and
 * `spawnSync` throws `ENAMETOOLONG` before a single test runs. To stay safe
 * on every platform the runner partitions the targets into chunks whose
 * joined length stays well under that ceiling (`MAX_TARGET_CHARS`) and spawns
 * one `node --test` process per chunk, aggregating the exit codes. The
 * `full` tier (a single recursive `tests` glob) yields exactly one chunk, so
 * its behaviour is unchanged.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoReservedIdStreams } from './check-test-temp-hygiene.js';
import { cleanupRepoTestTempArtifacts } from './cleanup-repo-test-temp.js';
import { runAsCli } from './lib/cli-utils.js';
import { buildWebhookSafeTestEnv } from './lib/test-env.js';
import {
  resolveTestConcurrency,
  runTierPreflight,
  TEST_CONCURRENCY_MAX,
  TEST_CONCURRENCY_MIN,
  TEST_RUNNER_FLAGS,
} from './lib/test-runner-contract.js';
import { listTestFilesForTier, parseTierArgv } from './lib/test-tiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// The runner contract (flag set, concurrency clamp, tier preflight) is
// declared once in `lib/test-runner-contract.js` so `run-coverage.js` shares
// it by construction. Re-exported here because this module is the runner's
// public face for its own unit tests.
export {
  resolveTestConcurrency,
  TEST_CONCURRENCY_MAX,
  TEST_CONCURRENCY_MIN,
  TEST_RUNNER_FLAGS,
};

/**
 * Per-spawn character budget for the joined *targets* portion of the argv.
 *
 * The Windows `CreateProcess` command-line ceiling is 32 767 chars for the
 * whole `lpCommandLine` (node exe path + flags + targets + extra args +
 * quoting). Budgeting the targets to 8 000 chars keeps every spawn's full
 * command line at roughly a quarter of the ceiling — ample headroom for the
 * exe path and any pass-through `--test-name-pattern` args — while keeping
 * the chunk count (and thus the extra `node` start-ups) low.
 *
 * `MAX_TARGET_CHARS` is the **Windows** budget. On POSIX hosts `ARG_MAX` is
 * far higher (~256 KB on macOS, ~1 MB on Linux), so applying the Windows
 * budget there needlessly serializes the quick tier into several sequential
 * `node --test` spawns — each chunk pays a fresh runner start-up, and cores
 * idle at every chunk's tail. `POSIX_MAX_TARGET_CHARS` (100 000) lets the
 * whole quick-tier target list (~33 000 chars today) collapse into a single
 * spawn on POSIX while staying far below `ARG_MAX`.
 * `resolveMaxTargetChars` picks the budget per platform; the Windows
 * semantics of `MAX_TARGET_CHARS` are unchanged.
 */
export const MAX_TARGET_CHARS = 8000;
export const POSIX_MAX_TARGET_CHARS = 100_000;

/**
 * Resolve the per-spawn target-character budget for the host platform.
 * The `platform` parameter is injected in tests.
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {number}
 */
export function resolveMaxTargetChars(platform = process.platform) {
  return platform === 'win32' ? MAX_TARGET_CHARS : POSIX_MAX_TARGET_CHARS;
}

/**
 * Partition an ordered list of test-file targets into chunks whose joined
 * length (targets + single-space separators) stays at or below `maxChars`.
 * Order is preserved. A single target longer than the budget still lands in
 * its own chunk rather than being dropped. An empty target list yields a
 * single empty chunk so the caller still issues exactly one spawn (matching
 * the historical single-spawn behaviour, e.g. the `full`-tier glob path).
 *
 * @param {string[]} targets
 * @param {number} [maxChars]
 * @returns {string[][]}
 */
export function chunkTestTargets(targets, maxChars = MAX_TARGET_CHARS) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const target of targets) {
    // +1 for the separator that would join this target to the previous one.
    const addition = target.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && currentLen + addition > maxChars) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(target);
    currentLen += target.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.extraArgs]
 * @param {'full' | 'quick' | 'integration'} [opts.tier]
 * @param {string} [opts.repoRoot]
 */
export function buildNodeTestArgs({
  extraArgs = [],
  tier = 'full',
  repoRoot = ROOT,
} = {}) {
  const targets = listTestFilesForTier(tier, repoRoot);
  return [...TEST_RUNNER_FLAGS, ...targets, ...extraArgs];
}

export function runTestSuite({
  argv = process.argv.slice(2),
  cwd = ROOT,
  spawn = spawnSync,
  cleanup = cleanupRepoTestTempArtifacts,
  listTargets = listTestFilesForTier,
  maxTargetChars = resolveMaxTargetChars(),
  fixtureStreamGuard = assertNoReservedIdStreams,
  preflight = runTierPreflight,
} = {}) {
  const { tier, rest } = parseTierArgv(argv);

  // Preflight first, and abort on refusal — the tier's checks exist to stop
  // the suite starting from a known-bad state, so running them after the
  // spawn would be pointless. Nothing has been created yet, so there is
  // nothing to clean up on this path.
  const preflightStatus = preflight({ tier, repoRoot: cwd });
  if (preflightStatus !== 0) return preflightStatus;

  const targets = listTargets(tier, cwd);
  const chunks = chunkTestTargets(targets, maxTargetChars);

  const env = buildWebhookSafeTestEnv(process.env);
  let status = 0;
  let spawnError = null;

  for (const chunk of chunks) {
    const testRun = spawn(
      process.execPath,
      [...TEST_RUNNER_FLAGS, ...chunk, ...rest],
      { cwd, stdio: 'inherit', env },
    );
    if (testRun.error) {
      spawnError = testRun.error;
      break;
    }
    const chunkStatus = testRun.status ?? 1;
    // First non-zero exit code wins; later chunks still run so the full
    // failure surface is reported in one CI pass.
    if (chunkStatus !== 0 && status === 0) status = chunkStatus;
  }

  cleanup({ repoRoot: cwd });

  // A test that spawns a real CLI at the repository root inherits the real
  // state directory, so its fixture telemetry can land in the operator's live
  // signals tree — where the retro graduator counts it as recurrence evidence
  // and files a ticket citing a fixture Story id. Fail the run that caused it
  // rather than discovering it from that ticket.
  const polluted = fixtureStreamGuard({ cwd });
  if (polluted !== 0 && status === 0) status = polluted;

  if (spawnError) {
    throw spawnError;
  }

  return status;
}

runAsCli(import.meta.url, async () => runTestSuite(), {
  source: 'run-tests',
  propagateExitCode: true,
});
