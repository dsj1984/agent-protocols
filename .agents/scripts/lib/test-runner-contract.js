/**
 * The contract every test-running entrypoint shares: the `node --test` flag
 * set, and the per-tier preflight.
 *
 * ## Why this is a module and not two literals (Story #4936)
 *
 * The repository has two full-tier runners — `run-tests.js` (`npm test`) and
 * `run-coverage.js` (`npm run test:coverage`, the *required* CI job). When
 * they disagree about a `node --test` flag, they disagree about whether a
 * test can execute at all: `--experimental-test-module-mocks` decides whether
 * `t.mock.module` works, so a divergence makes a suite pass under one runner
 * and fail under the other with no source defect. `FULL_TIER_GLOBS` in
 * [`test-tiers.js`](test-tiers.js) already solved the sibling problem for
 * *which files* run; this module is the same fix for *how they are run*.
 * Both runners import from here; neither restates a literal.
 *
 * ## The preflight is invoked, never hooked
 *
 * `.npmrc` sets `ignore-scripts=true` as deliberate defence against malicious
 * postinstall hooks (CWE-1357). That setting is correct and stays — but it
 * suppresses every `pre*` / `post*` lifecycle script for `npm run` as well as
 * for installs, so a `pretest` entry in `package.json` never fires. The
 * repository carried `pretest`, `pretest:quick` and `pretest:integration`
 * entries that therefore ran for no tier at all, and Story #4922 worked
 * around it for the coverage tier alone by having CI name `pretest:coverage`
 * explicitly. `runTierPreflight` closes the gap for every tier by moving the
 * invocation into the runners, where it executes under `npm test`,
 * `npm run test:coverage`, and a bare `node .agents/scripts/run-tests.js`
 * alike — no lifecycle hook involved.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Minimum and maximum bounds for `--test-concurrency`. */
export const TEST_CONCURRENCY_MIN = 1;
export const TEST_CONCURRENCY_MAX = 16;

/**
 * Resolve the `--test-concurrency` value for the current host.
 *
 * Uses `os.availableParallelism()` (Node ≥18.14 / ≥20.0) clamped to the
 * range `[TEST_CONCURRENCY_MIN, TEST_CONCURRENCY_MAX]`. The `parallelism`
 * parameter is injected in tests so the clamping logic is verifiable
 * without touching the OS.
 *
 * @param {number} [parallelism] - defaults to `os.availableParallelism()`
 * @returns {number}
 */
export function resolveTestConcurrency(
  parallelism = os.availableParallelism(),
) {
  return Math.min(
    TEST_CONCURRENCY_MAX,
    Math.max(TEST_CONCURRENCY_MIN, parallelism),
  );
}

/**
 * Fixed `node --test` flags applied to every spawn of every runner.
 *
 * `--test-concurrency` is derived at startup from the host's available
 * parallelism so the value suits the machine running the suite rather than
 * being pinned to the historical constant of 8.
 *
 * This is the **single** declaration. A flag added here reaches both runners;
 * a flag added to one runner's argv builder instead is caught by the
 * flag-set equality assertion in `tests/scripts/run-coverage.test.js`.
 */
export const TEST_RUNNER_FLAGS = Object.freeze([
  '--experimental-test-module-mocks',
  '--test',
  `--test-concurrency=${resolveTestConcurrency()}`,
]);

/**
 * Preflight scripts per tier, repo-relative. These are the definitions that
 * used to live in `package.json` as inert `pretest*` entries.
 *
 * `full` carries the skills validator on top of the state-probe wrapper
 * because the full tier is the release-shaped run (and the surface the
 * coverage tier measures); `quick` and `integration` run the state probe
 * only, matching the tiers' historical `pretest:quick` / `pretest:integration`
 * definitions. The coverage runner runs the full tier, so it shares `full`.
 *
 * Deliberately not exported: a second importer would be a second place to
 * read the tier→preflight mapping from, and tests assert the mapping through
 * the spawns `runTierPreflight` actually issues — which is the thing that
 * has to be true.
 */
const TIER_PREFLIGHT_SCRIPTS = Object.freeze({
  full: Object.freeze([
    '.agents/scripts/test-wrapper.js',
    '.agents/scripts/validate-skills.js',
  ]),
  quick: Object.freeze(['.agents/scripts/test-wrapper.js']),
  integration: Object.freeze(['.agents/scripts/test-wrapper.js']),
});

/**
 * Run the preflight for a tier, in order, stopping at the first failure.
 *
 * Mirrors npm's own `pre<script>` semantics — a failed preflight aborts
 * before the test runner is spawned and propagates its exit code (the
 * wrapper reserves 2 for "preflight refused") — except that it actually
 * executes, which the npm hook does not under `ignore-scripts=true`.
 *
 * @param {object} [opts]
 * @param {'full' | 'quick' | 'integration'} [opts.tier]
 * @param {string} [opts.repoRoot] Absolute repository root.
 * @param {typeof spawnSync} [opts.spawn] Injected in tests.
 * @param {string} [opts.execPath] Node binary to spawn; injected in tests.
 * @returns {number} 0 when every preflight script passed, else the first
 *   non-zero exit code.
 */
export function runTierPreflight({
  tier = 'full',
  repoRoot = process.cwd(),
  spawn = spawnSync,
  execPath = process.execPath,
} = {}) {
  for (const script of TIER_PREFLIGHT_SCRIPTS[tier] ?? []) {
    const run = spawn(execPath, [path.join(repoRoot, script)], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (run.error) throw run.error;
    const status = run.status ?? 1;
    if (status !== 0) return status;
  }
  return 0;
}
