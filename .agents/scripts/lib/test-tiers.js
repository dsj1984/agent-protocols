import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

/**
 * Globs for slow / integration-style suites excluded from `test:quick`.
 *
 * Curated from `npm run test:profile` (Stories #2742 / #2744). Real-git
 * harnesses, binary-spawn CLI contracts, and other suites whose setup
 * dominates quick-tier feedback stay here; unit-guard / mock paths remain
 * in quick.
 */
export const INTEGRATION_INCLUDE = [
  'tests/**/*.integration.test.js',
  'tests/hook-chain-reflog-invariant.test.js',
  'tests/contract/check-baselines-regression.test.js',
  'tests/contract/check-baselines-kernel-mismatch.test.js',
  'tests/integration-prime-after-sweep.test.js',
  'tests/scripts/git-cleanup.test.js',
  'tests/lib/checks/runner-integration.test.js',
  'tests/single-story-close-sync.test.js',
];

const matchesIntegration = picomatch(INTEGRATION_INCLUDE, { dot: true });

/**
 * Globs for the `e2e` tier — real-binary suites under `tests/e2e/` that pack
 * this repository, install it into a temp consumer and drive the shipped
 * `mandrel` binary end to end.
 *
 * They are the most expensive files the repository owns by an order of
 * magnitude: one `npm pack` plus real `npm install` spawns per file, measured
 * (Story #5111) at ~7 s of system time and ~17 s of summed install wall clock
 * for `update-chain.integration.test.js` alone. Every one of those seconds was
 * charged to `npm test` — i.e. to every pre-push hook and every local
 * iteration — for a signal that only changes when the release-shaped install
 * path changes.
 *
 * So they get their own tier and leave every other one: `full` (`npm test`),
 * `quick` and `integration` all exclude them, and `npm run test:e2e` is how
 * they run. CI runs that tier as its own job on every PR, so the
 * release-shaped path keeps its per-PR signal.
 *
 * Deliberately not exported: a second reader of this list is a second place
 * for the tier definition to drift. `listTestFilesForTier('e2e', root)` is the
 * public answer to "which files are e2e", and the tests assert through it.
 */
const E2E_INCLUDE = ['tests/e2e/**/*.test.js'];

const matchesE2E = picomatch(E2E_INCLUDE, { dot: true });

/** Tier names `parseTierArgv` accepts, in the order `--help` lists them. */
const TIERS = ['full', 'quick', 'integration', 'e2e'];

/**
 * `node --test` flags the runner forwards verbatim to the child.
 *
 * Everything else that looks like a flag is a mistake — a typo, a retired
 * option, or a flag meant for `npm` that landed after the `--` separator —
 * and `parseTierArgv` rejects it rather than passing it to `node --test`,
 * which reads an unknown `--flag` as a *file pattern* and silently runs a
 * suite that matches nothing while exiting 0.
 */
const PASSTHROUGH_FLAGS = ['--test-name-pattern', '--test-only'];

/**
 * Repo-relative roots the tier walker scans for test files (names ending in
 * `.test.js`).
 *
 * `tests` holds the framework's suite tree; `lib` holds the published CLI
 * (under `lib/cli` and `lib/migrations`) whose tests are colocated in
 * `__tests__` directories per the unit-tier convention in
 * `rules/testing-standards.md`. `.agents/scripts` holds the orchestration
 * engine; some of its modules colocate tests in `__tests__` directories the
 * same way (Story #4195). Without each root here, both the quick /
 * integration walk and the full-tier glob set miss the colocated tests,
 * leaving that coverage dark in `npm test`. The matching full-tier globs
 * live in the exported `FULL_TIER_GLOBS` — every full-tier runner
 * (`run-tests.js`, `run-coverage.js`) MUST consume that constant rather than
 * restate a glob literal, or a runner silently walks a narrower surface.
 */
const TEST_WALK_ROOTS = ['tests', 'lib', '.agents/scripts'];

/**
 * Glob targets for the `full` tier — one per walk root in `TEST_WALK_ROOTS`.
 * The `tests` glob is a flat recursive sweep; the `lib` and `.agents/scripts`
 * globs are scoped to `__tests__` subtrees so they only match colocated
 * tests, never the shipped source modules themselves.
 *
 * Exported because it is the **measured surface**: `run-coverage.js` — the
 * required CI job, and the run every coverage / CRAP baseline is scored from —
 * consumes it directly. Story #4922: the coverage runner used to restate
 * `tests/**` on its own, so the 47 colocated `__tests__` files ran under
 * `npm test` but were absent from the measured surface, leaving the coverage
 * and CRAP numbers computed over code the measuring run never executed.
 * Consume this constant; never restate a glob.
 *
 * Story #5111 made this a strict **superset** of the `full` runner tier: the
 * measured surface still includes `tests/e2e/**`, while `npm test` no longer
 * runs it. That asymmetry is deliberate and load-bearing. The e2e suites drive
 * the shipped binary through `bin/mandrel.js` and `lib/cli/update.js` in real
 * child processes, and c8's `NODE_V8_COVERAGE` is inherited by those children —
 * so dropping them from the measured run would deflate exactly the CLI files
 * they exist to exercise and red the coverage ratchet on code nobody touched.
 * Cheapening the pre-push loop must not cost the measurement its subject.
 */
export const FULL_TIER_GLOBS = [
  'tests/**/*.test.js',
  'lib/**/__tests__/**/*.test.js',
  '.agents/scripts/**/__tests__/**/*.test.js',
];

/**
 * @param {string} dir
 * @param {string} prefix
 * @param {typeof fs} fsLike
 * @returns {string[]}
 */
function walkTestFiles(dir, prefix, fsLike) {
  const out = [];
  if (!fsLike.existsSync(dir)) return out;
  for (const ent of fsLike.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push(...walkTestFiles(abs, rel, fsLike));
    } else if (ent.name.endsWith('.test.js')) {
      out.push(rel.replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * Split the walked set into the `e2e` tier and the remainder every other tier
 * is drawn from, so an e2e file belongs to exactly one tier and `npm test`
 * never pays for it.
 *
 * @param {string[]} all
 * @returns {{ e2e: string[], rest: string[] }}
 */
function partitionE2E(all) {
  const e2e = all.filter((file) => matchesE2E(file));
  const e2eSet = new Set(e2e);
  return { e2e, rest: all.filter((file) => !e2eSet.has(file)) };
}

/**
 * Split the non-e2e remainder into the slow `integration` tier and the `quick`
 * complement — the historical partition, unchanged.
 *
 * @param {string[]} rest
 * @param {'quick' | 'integration'} tier
 * @returns {string[]}
 */
function splitBySpeed(rest, tier) {
  const integration = rest.filter((file) => matchesIntegration(file));
  if (tier === 'integration') {
    return integration;
  }
  const integrationSet = new Set(integration);
  return rest.filter((file) => !integrationSet.has(file));
}

/**
 * List repo-relative test file paths for a tier.
 *
 * `full` used to return {@link FULL_TIER_GLOBS} verbatim and let `node --test`
 * expand them. It enumerates files instead since Story #5111, because the one
 * thing a glob list cannot express is an exclusion: `node --test` has no
 * negative pattern, so "everything except `tests/e2e/**`" is only sayable as
 * a file set. The measured surface keeps the globs (see `FULL_TIER_GLOBS`).
 *
 * @param {'full' | 'quick' | 'integration' | 'e2e'} tier
 * @param {string} repoRoot
 * @param {typeof fs} [fsLike]
 * @returns {string[]}
 */
export function listTestFilesForTier(tier, repoRoot, fsLike = fs) {
  const all = TEST_WALK_ROOTS.flatMap((root) =>
    walkTestFiles(path.join(repoRoot, root), root, fsLike),
  ).sort();
  const { e2e, rest } = partitionE2E(all);
  if (tier === 'e2e') {
    return e2e;
  }
  if (tier === 'full') {
    return rest;
  }
  return splitBySpeed(rest, tier);
}

/**
 * Reject argv tokens that look like flags but are neither `--tier` (already
 * consumed) nor a sanctioned `node --test` pass-through.
 *
 * Silence was the old behaviour and the reason this exists: the runner
 * forwarded every unrecognized token verbatim, and `node --test` treats an
 * unknown `--flag` as another **file pattern**. A typo therefore produced a
 * run that matched nothing, printed a plausible-looking summary and exited 0 —
 * a green that proved nothing.
 *
 * @param {string[]} rest
 * @throws {Error} naming both the accepted tiers and the accepted flags.
 */
function assertKnownFlags(rest) {
  const unknown = rest.filter(
    (arg) =>
      arg.startsWith('--') &&
      !PASSTHROUGH_FLAGS.includes(arg) &&
      !PASSTHROUGH_FLAGS.some((flag) => arg.startsWith(`${flag}=`)),
  );
  if (unknown.length === 0) return;
  throw new Error(
    `[run-tests] unrecognized argument(s): ${unknown.join(', ')}. ` +
      `Accepted: --tier <${TIERS.join('|')}>, ${PASSTHROUGH_FLAGS.join(', ')}, --help. ` +
      'Unrecognized flags are not forwarded: `node --test` would read them as ' +
      'file patterns and exit 0 having run nothing.',
  );
}

/**
 * Parse `--tier <name>` from argv. Unknown tiers and unknown flags throw.
 *
 * @param {string[]} argv
 * @returns {{ tier: 'full' | 'quick' | 'integration' | 'e2e', rest: string[] }}
 */
export function parseTierArgv(argv) {
  const tierIdx = argv.indexOf('--tier');
  if (tierIdx === -1) {
    assertKnownFlags(argv);
    return { tier: 'full', rest: argv };
  }
  const tier = argv[tierIdx + 1];
  if (!tier || !TIERS.includes(tier)) {
    throw new Error(
      `[run-tests] --tier requires one of: ${TIERS.join(', ')} (got ${JSON.stringify(tier)})`,
    );
  }
  const rest = argv.filter((_, i) => i !== tierIdx && i !== tierIdx + 1);
  assertKnownFlags(rest);
  return { tier, rest };
}
