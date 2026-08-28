// tests/lib/source-extensions.test.js
/**
 * Story #5076 — the scorable-source extension set is a single source of truth.
 *
 * Three surfaces select "the files the CRAP scanner scores" and used to carry
 * three different literals: the coverage-freshness check (`js|mjs` only), the
 * close-validation CRAP projection (no `.mts`/`.cts`), and the scanner's own
 * directory walk. A selector narrower than the scanner's walk makes the gate
 * green while measuring nothing — that is the defect these tests pin shut.
 *
 * The agreement test below is deliberately behavioural: it exercises each
 * consumer's real selector against the same extensions rather than asserting
 * that they import a particular symbol, so refactoring the plumbing cannot
 * make the test pass while the behaviours drift apart.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeContentDigest } from '../../.agents/scripts/lib/coverage-capture.js';
import {
  isScorableSourceFile,
  SCORABLE_SOURCE_EXT_RE,
  SCORABLE_SOURCE_EXTENSIONS,
} from '../../.agents/scripts/lib/source-extensions.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(
  HERE,
  '../../.agents/scripts/lib/source-extensions.js',
);

/** Extensions the CRAP and maintainability engines can score. */
const EXPECTED = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

/** Extensions no consumer may treat as scorable. */
const NOT_SCORABLE = ['.astro', '.vue', '.svelte', '.md', '.json', '.txt'];

describe('SCORABLE_SOURCE_EXTENSIONS', () => {
  it('is exactly the set the CRAP/maintainability engines score', () => {
    assert.deepEqual([...SCORABLE_SOURCE_EXTENSIONS], EXPECTED);
  });

  it('is frozen so a consumer cannot mutate the shared set in place', () => {
    assert.equal(Object.isFrozen(SCORABLE_SOURCE_EXTENSIONS), true);
  });

  it('derives its regex from the list, so there is one definition', () => {
    for (const ext of EXPECTED) {
      assert.equal(
        SCORABLE_SOURCE_EXT_RE.test(`src/a${ext}`),
        true,
        `${ext} should match`,
      );
    }
    for (const ext of NOT_SCORABLE) {
      assert.equal(
        SCORABLE_SOURCE_EXT_RE.test(`src/a${ext}`),
        false,
        `${ext} should not match`,
      );
    }
  });

  it('matches on extension case-insensitively via the path predicate', () => {
    assert.equal(isScorableSourceFile('src/Component.TSX'), true);
    assert.equal(isScorableSourceFile('src/a.MJS'), true);
    assert.equal(isScorableSourceFile('src/page.ASTRO'), false);
  });

  it('reads an extension only from the final segment', () => {
    assert.equal(isScorableSourceFile('a.ts/b.astro'), false);
    assert.equal(isScorableSourceFile('a.astro/b.ts'), true);
    assert.equal(isScorableSourceFile('noextension'), false);
  });
});

describe('source-extensions module graph (pre-push safety)', () => {
  /**
   * `coverage-capture.js` imports this module and runs on the pre-push path.
   * Sourcing the set from `maintainability-utils.js` instead would drag
   * `typhonjs-escomplex` and `typescript` into every freshness probe, so the
   * module must stay free of third-party imports.
   */
  it('imports only `node:` builtins', () => {
    const src = fs.readFileSync(MODULE_PATH, 'utf8');
    const specifiers = [
      ...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]);
    assert.ok(specifiers.length > 0, 'expected at least one import to check');
    const foreign = specifiers.filter((s) => !s.startsWith('node:'));
    assert.deepEqual(
      foreign,
      [],
      `source-extensions.js must import only node: builtins, found: ${foreign.join(', ')}`,
    );
  });
});

describe('the three scorable-source selectors agree', () => {
  /**
   * Each consumer's real selector, exercised through its own public surface:
   *
   * - the maintainability/CRAP directory walk (`scanDirectory`),
   * - the coverage-freshness digest filter (`computeContentDigest`),
   * - the close-validation CRAP projection's changed-file filter.
   *
   * `scanDirectory` is imported lazily so this file's cheap cases do not pay
   * for the scoring engines' module graph.
   */
  const sampleFor = (ext) => `src/sample${ext}`;

  it('the maintainability scanner walks exactly the shared set', async () => {
    const { scanDirectory } = await import(
      '../../.agents/scripts/lib/maintainability-utils.js'
    );
    const dir = makeTempDir('src-ext-');
    for (const ext of [...EXPECTED, ...NOT_SCORABLE]) {
      fs.writeFileSync(path.join(dir, `sample${ext}`), '');
    }
    const found = scanDirectory(dir)
      .map((f) => path.extname(f))
      .sort();
    assert.deepEqual(found, [...EXPECTED].sort());
  });

  it('the coverage-freshness digest filter accepts exactly the shared set', () => {
    // Every extension tracked: a digest is produced (the set is non-empty).
    // Only unscorable extensions tracked: the digest reports "unavailable".
    const digestFor = (exts) =>
      computeContentDigest('/repo', ['src'], {
        spawnSync: (_bin, args) => ({
          status: 0,
          stdout:
            args[0] === 'ls-files'
              ? exts
                  .map((e, i) => `100644 aaa${i} 0\t${sampleFor(e)}`)
                  .join('\n')
              : '',
        }),
        readFileSync: () => Buffer.from(''),
      });

    for (const ext of EXPECTED) {
      assert.equal(
        typeof digestFor([ext]),
        'string',
        `${ext} should be digested`,
      );
    }
    assert.equal(
      digestFor(NOT_SCORABLE),
      null,
      'unscorable extensions alone must not produce a digest',
    );
  });

  it('the close-validation CRAP projection filters to exactly the shared set', async () => {
    const { projectCrapBreaches } = await import(
      '../../.agents/scripts/lib/close-validation/projections/crap.js'
    );
    const all = [...EXPECTED, ...NOT_SCORABLE].map(sampleFor);
    let scored = null;
    await projectCrapBreaches({
      cwd: '/repo',
      baseBranch: 'main',
      storyBranch: 'story-1',
      baselinePath: '/repo/baselines/crap.json',
      git: {
        gitSpawn: (_cwd, ...args) => ({
          status: 0,
          stdout: args[0] === 'diff' ? all.join('\n') : '',
          stderr: '',
        }),
      },
      loadBaseline: () => [
        { file: 'src/sample.js', method: 'wide', startLine: 10, crap: 12 },
      ],
      scoreFiles: (files) => {
        scored = files;
        return [];
      },
    });
    assert.deepEqual(
      (scored ?? []).map((f) => path.extname(f)).sort(),
      [...EXPECTED].sort(),
    );
  });
});
