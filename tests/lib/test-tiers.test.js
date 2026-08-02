import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import picomatch from 'picomatch';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';
import {
  FULL_TIER_GLOBS,
  INTEGRATION_INCLUDE,
  listTestFilesForTier,
  parseTierArgv,
} from '../../.agents/scripts/lib/test-tiers.js';

test('parseTierArgv defaults to full', () => {
  assert.deepEqual(parseTierArgv(['--grep', 'foo']), {
    tier: 'full',
    rest: ['--grep', 'foo'],
  });
});

test('parseTierArgv extracts tier and remainder', () => {
  assert.deepEqual(parseTierArgv(['--tier', 'quick', '--grep', 'x']), {
    tier: 'quick',
    rest: ['--grep', 'x'],
  });
});

test('parseTierArgv rejects unknown tier', () => {
  assert.throws(() => parseTierArgv(['--tier', 'nope']), /quick, integration/);
});

test('listTestFilesForTier partitions quick vs integration', () => {
  const root = makeTempDir('tier-');
  const testsDir = path.join(root, 'tests', 'unit');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(testsDir, 'fast.test.js'), '');
  fs.writeFileSync(path.join(testsDir, 'slow.integration.test.js'), '');
  fs.writeFileSync(
    path.join(root, 'tests', 'hook-chain-reflog-invariant.test.js'),
    '',
  );

  const quick = listTestFilesForTier('quick', root, fs);
  const integration = listTestFilesForTier('integration', root, fs);

  assert.ok(quick.includes('tests/unit/fast.test.js'));
  assert.ok(!quick.includes('tests/unit/slow.integration.test.js'));
  assert.ok(!quick.includes('tests/hook-chain-reflog-invariant.test.js'));

  assert.ok(integration.includes('tests/unit/slow.integration.test.js'));
  assert.ok(integration.includes('tests/hook-chain-reflog-invariant.test.js'));
  assert.ok(!integration.includes('tests/unit/fast.test.js'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('listTestFilesForTier full returns the tests + lib + .agents/scripts glob set', () => {
  const root = makeTempDir('tier-full-');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  assert.deepEqual(listTestFilesForTier('full', root, fs), [
    'tests/**/*.test.js',
    'lib/**/__tests__/**/*.test.js',
    '.agents/scripts/**/__tests__/**/*.test.js',
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('quick / integration walk lib/**/__tests__ as a second root', () => {
  const root = makeTempDir('tier-lib-');
  const libTests = path.join(root, 'lib', 'cli', '__tests__');
  fs.mkdirSync(libTests, { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(libTests, 'update.test.js'), '');

  const quick = listTestFilesForTier('quick', root, fs);
  const integration = listTestFilesForTier('integration', root, fs);

  // The colocated CLI test is dark today; it must land in the runner's
  // walk-derived target list (quick tier — it is not in INTEGRATION_INCLUDE).
  assert.ok(quick.includes('lib/cli/__tests__/update.test.js'));
  assert.ok(!integration.includes('lib/cli/__tests__/update.test.js'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('quick / integration walk .agents/scripts/**/__tests__ as a third root', () => {
  const root = makeTempDir('tier-agents-');
  const agentTests = path.join(
    root,
    '.agents',
    'scripts',
    'lib',
    'audit-to-stories',
    '__tests__',
  );
  fs.mkdirSync(agentTests, { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(agentTests, 'audit-lenses.test.js'), '');

  const quick = listTestFilesForTier('quick', root, fs);
  const integration = listTestFilesForTier('integration', root, fs);

  // Colocated orchestration-engine tests under .agents/scripts must be
  // discovered (Story #4195) — quick tier, since they are not in
  // INTEGRATION_INCLUDE.
  const rel =
    '.agents/scripts/lib/audit-to-stories/__tests__/audit-lenses.test.js';
  assert.ok(quick.includes(rel));
  assert.ok(!integration.includes(rel));

  fs.rmSync(root, { recursive: true, force: true });
});

test('INTEGRATION_INCLUDE matches documented slow suites', () => {
  assert.ok(
    INTEGRATION_INCLUDE.some((p) =>
      p.includes('check-baselines-regression.test.js'),
    ),
  );
});

// Story #4545 — every curated (non-glob) entry must resolve to a real file.
// Three entries named files deleted in the v2.0.0 cutover
// (epic-execute-record-wave, push-epic-retry, concurrency-wiring). They failed
// SILENTLY rather than loudly: `listTestFilesForTier` filters a real directory
// walk through `matchesIntegration`, so a curated path with no file on disk
// simply never matches and is dropped from the tier. The suite it was meant to
// pin then stops running with no signal. This guard is what the old
// membership assertion should have been — it pinned one of the dead paths by
// name, which is precisely why the drift survived.
test('every curated INTEGRATION_INCLUDE entry resolves to a file on disk', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const missing = INTEGRATION_INCLUDE.filter(
    (entry) =>
      !entry.includes('*') && !fs.existsSync(path.join(repoRoot, entry)),
  );
  assert.deepEqual(
    missing,
    [],
    `curated integration entries name files that do not exist: ${missing.join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// Story #4922 — FULL_TIER_GLOBS is the single source of truth for the full
// tier's file set, and it has two consumers: run-tests.js (via
// listTestFilesForTier) and run-coverage.js. The coverage runner used to
// restate `tests/**/*.test.js` on its own, so the colocated __tests__ suites
// ran under `npm test` but were invisible to every coverage / CRAP reading.
// ---------------------------------------------------------------------------

test('FULL_TIER_GLOBS names one glob per test walk root', () => {
  assert.ok(Array.isArray(FULL_TIER_GLOBS));
  assert.deepEqual(FULL_TIER_GLOBS, [
    'tests/**/*.test.js',
    'lib/**/__tests__/**/*.test.js',
    '.agents/scripts/**/__tests__/**/*.test.js',
  ]);
});

test('listTestFilesForTier("full") returns exactly FULL_TIER_GLOBS', () => {
  const root = makeTempDir('tier-full-');
  assert.deepEqual(listTestFilesForTier('full', root), [...FULL_TIER_GLOBS]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('every FULL_TIER_GLOB matches at least one real test file', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const all = listTestFilesForTier('quick', repoRoot).concat(
    listTestFilesForTier('integration', repoRoot),
  );
  for (const glob of FULL_TIER_GLOBS) {
    const isMatch = picomatch(glob, { dot: true });
    assert.ok(
      all.some((f) => isMatch(f)),
      `full-tier glob ${glob} matches no file on disk — the tier walks a surface that does not exist`,
    );
  }
});

test('the coverage runner consumes FULL_TIER_GLOBS rather than a literal', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const src = fs.readFileSync(
    path.join(repoRoot, '.agents', 'scripts', 'run-coverage.js'),
    'utf8',
  );
  assert.ok(
    /FULL_TIER_GLOBS/.test(src),
    'run-coverage.js must import FULL_TIER_GLOBS',
  );
  // No glob literal of its own: a bare quoted `*.test.js` target in the
  // executable body is exactly the drift this SSOT exists to prevent.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /['"`][^'"`]*\*[^'"`]*\.test\.js['"`]/.test(code),
    false,
    'run-coverage.js restates a test glob literal instead of consuming FULL_TIER_GLOBS',
  );
});
