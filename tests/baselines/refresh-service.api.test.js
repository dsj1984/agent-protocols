/**
 * refresh-service.api.test.js — unit coverage for the refreshBaseline()
 * API surface (Story #2197, Task #2203).
 *
 * Acceptance:
 *   - refreshBaseline throws when kind is unknown.
 *   - refreshBaseline uses canonicalizeBaselinePath on every output row path.
 *   - Export is a named ESM export.
 *   - writePath / scopeFiles / fullScope option-bag contract is enforced.
 */

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as refreshServiceModule from '../../.agents/scripts/lib/baselines/refresh-service.js';
import { refreshBaseline } from '../../.agents/scripts/lib/baselines/refresh-service.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

const FIXED = '2026-05-15T00:00:00Z';

/**
 * A two-file repository the registered default scorer can walk in full.
 *
 * The default-scorer test below runs `refreshBaseline` with **no** injected
 * scorer, which is the whole point — it proves the kind's registered default
 * is wired. But the default scorer resolves its `targetDirs` from the
 * `.agentrc.json` found at the call's `cwd`, and with `cwd` left at
 * `process.cwd()` that was *this repository*: a full-scope maintainability
 * scan of `.agents/scripts` across an 18-worker pool, and the suite's
 * single largest memory peak (~1.10 GB max RSS) — all of it incidental to
 * the assertion. Pointing `cwd` at this fixture keeps the registration
 * assertion intact and makes the scan two files wide.
 */
const FIXTURE_ROOT = fileURLToPath(
  new URL('../fixtures/refresh-service-fixture', import.meta.url),
);

/**
 * The rows that walk produces. Persisted paths are canonicalized against the
 * repository root (Story #2192), not the scan cwd, so they carry the
 * fixture's location rather than the config-relative `src/`.
 */
const FIXTURE_ROWS = [
  'tests/fixtures/refresh-service-fixture/src/a.js',
  'tests/fixtures/refresh-service-fixture/src/b.js',
];

// Deterministic scorer used across the suite. Returns the supplied
// `staticRows` regardless of which files the service hands it; that's all
// the API surface needs to assert.
function makeStaticScorer(staticRows) {
  return (_files, _opts) => staticRows;
}

describe('refreshBaseline — module shape (Task #2203 AC: named ESM export)', () => {
  it('exports refreshBaseline as a named ESM export', () => {
    assert.equal(typeof refreshServiceModule.refreshBaseline, 'function');
    assert.equal(refreshBaseline, refreshServiceModule.refreshBaseline);
  });

  it('does not expose a default export', () => {
    assert.equal(refreshServiceModule.default, undefined);
  });
});

describe('refreshBaseline — option-bag validation', () => {
  let workDir;

  beforeEach(() => {
    workDir = makeTempDir('mandrel-refresh-api-');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('AC: throws when kind is unknown', async () => {
    await assert.rejects(
      () =>
        refreshBaseline({
          kind: 'bogus',
          writePath: path.join(workDir, 'baselines', 'bogus.json'),
          fullScope: true,
          scorer: makeStaticScorer([]),
        }),
      /unknown kind "bogus"/,
    );
  });

  it('throws when writePath is missing', async () => {
    await assert.rejects(
      () =>
        refreshBaseline({
          kind: 'maintainability',
          fullScope: true,
          scorer: makeStaticScorer([]),
        }),
      /writePath is required/,
    );
  });

  it('throws when scopeFiles is neither null nor an array', async () => {
    await assert.rejects(
      () =>
        refreshBaseline({
          kind: 'maintainability',
          writePath: path.join(workDir, 'm.json'),
          scopeFiles: 'src/a.js',
          scorer: makeStaticScorer([]),
        }),
      /scopeFiles must be null or an array/,
    );
  });

  it('throws when fullScope=true is combined with an explicit scopeFiles array', async () => {
    await assert.rejects(
      () =>
        refreshBaseline({
          kind: 'maintainability',
          writePath: path.join(workDir, 'm.json'),
          fullScope: true,
          scopeFiles: ['src/a.js'],
          scorer: makeStaticScorer([]),
        }),
      /fullScope=true is incompatible/,
    );
  });

  it('uses the registered default scorer when no scorer is injected (Story #3658)', async () => {
    // Story #3658 completes the Epic #2173 migration: all four kinds now have
    // registered default scorers, so callers no longer need to inject one. A
    // full-scope invocation with no scorer must resolve the registered
    // scorer, honour the `targetDirs` it reads from the config at `cwd`,
    // and write a valid envelope.
    const writePath = path.join(workDir, 'm.json');
    const result = await refreshBaseline({
      kind: 'maintainability',
      writePath,
      fullScope: true,
      cwd: FIXTURE_ROOT,
      generatedAt: FIXED,
    });
    assert.equal(result.kind, 'maintainability');
    assert.equal(result.scope.mode, 'full');
    assert.equal(result.wrote, true);

    // The registered default really scored — and scored exactly the fixture's
    // configured target dir, not whatever tree the test happened to run in.
    const rows = result.envelope?.rows ?? [];
    assert.deepEqual(
      rows.map((r) => r.path).sort(),
      FIXTURE_ROWS,
      "the default scorer walks the fixture config's targetDirs",
    );
    for (const row of rows) {
      assert.equal(
        typeof row.mi,
        'number',
        `row ${row.path} must carry a maintainability score`,
      );
    }
    assert.deepEqual(
      JSON.parse(readFileSync(writePath, 'utf8')).rows.map((r) => r.path),
      FIXTURE_ROWS,
    );
  });
});

describe('refreshBaseline — per-kind dispatch (Task #2203)', () => {
  let workDir;

  beforeEach(() => {
    workDir = makeTempDir('mandrel-refresh-disp-');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('dispatches to the maintainability kind and writes an envelope-shape baseline', async () => {
    const writePath = path.join(workDir, 'baselines', 'maintainability.json');
    const result = await refreshBaseline({
      kind: 'maintainability',
      writePath,
      fullScope: true,
      generatedAt: FIXED,
      scorer: makeStaticScorer([
        { path: 'src/a.js', mi: 80 },
        { path: 'src/b.js', mi: 90 },
      ]),
    });
    assert.equal(result.kind, 'maintainability');
    assert.equal(result.scope.mode, 'full');
    assert.equal(result.wrote, true);
    const parsed = JSON.parse(readFileSync(writePath, 'utf8'));
    assert.equal(
      parsed.$schema,
      '.agents/schemas/baselines/maintainability.schema.json',
    );
    assert.deepEqual(
      parsed.rows.map((r) => r.path),
      ['src/a.js', 'src/b.js'],
    );
  });

  it('dispatches to the crap kind and writes an envelope-shape baseline', async () => {
    const writePath = path.join(workDir, 'baselines', 'crap.json');
    const result = await refreshBaseline({
      kind: 'crap',
      writePath,
      fullScope: true,
      generatedAt: FIXED,
      scorer: makeStaticScorer([
        { path: 'src/a.js', method: 'fn', startLine: 1, crap: 5 },
      ]),
    });
    assert.equal(result.kind, 'crap');
    const parsed = JSON.parse(readFileSync(writePath, 'utf8'));
    assert.equal(parsed.$schema, '.agents/schemas/baselines/crap.schema.json');
    assert.equal(parsed.rows[0].path, 'src/a.js');
  });

  it('dispatches to the coverage kind and writes an envelope-shape baseline', async () => {
    const writePath = path.join(workDir, 'baselines', 'coverage.json');
    const result = await refreshBaseline({
      kind: 'coverage',
      writePath,
      fullScope: true,
      generatedAt: FIXED,
      scorer: makeStaticScorer([
        { path: 'src/a.js', lines: 90, branches: 80, functions: 100 },
      ]),
    });
    assert.equal(result.kind, 'coverage');
    const parsed = JSON.parse(readFileSync(writePath, 'utf8'));
    assert.equal(
      parsed.$schema,
      '.agents/schemas/baselines/coverage.schema.json',
    );
    assert.equal(parsed.rows[0].path, 'src/a.js');
  });
});

describe('refreshBaseline — path canonicalization (AC-7)', () => {
  let workDir;

  beforeEach(() => {
    workDir = makeTempDir('mandrel-refresh-canon-');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('AC: every output row path is canonicalized', async () => {
    const writePath = path.join(workDir, 'baselines', 'maintainability.json');
    // Scorer emits a mix of Windows-style backslashes, leading `./`, and a
    // worktree-prefixed absolute-ish path. After the service runs every
    // row's `path` must be canonical (POSIX, repo-relative).
    await refreshBaseline({
      kind: 'maintainability',
      writePath,
      fullScope: true,
      generatedAt: FIXED,
      scorer: makeStaticScorer([
        { path: 'src\\windows.js', mi: 70 },
        { path: './src/dotrel.js', mi: 75 },
        { path: '/abs/src/abs.js', mi: 80 },
      ]),
    });
    const parsed = JSON.parse(readFileSync(writePath, 'utf8'));
    const paths = parsed.rows.map((r) => r.path);
    // Sorted by writer.sortRows; canonical form has forward slashes and
    // no leading `./` or drive prefix.
    assert.deepEqual(paths.sort(), [
      'abs/src/abs.js',
      'src/dotrel.js',
      'src/windows.js',
    ]);
    for (const p of paths) {
      assert.equal(
        p.includes('\\'),
        false,
        `path "${p}" must not contain backslashes`,
      );
      assert.equal(
        p.startsWith('./'),
        false,
        `path "${p}" must not start with ./`,
      );
    }
  });
});
