/**
 * writer-scope.test.js — wires per-kind mergeRows into writer.write
 * (Story #1974 / Task #1988, Epic #1943).
 *
 * Acceptance:
 *   - writer.write({prior, scope:{mode:'diff', files:Set(['a.js'])}, ...})
 *     preserves rows whose `path !== 'a.js'` verbatim.
 *   - Two simulated concurrent Story scopes touching disjoint files
 *     produce non-overlapping baseline diffs (the moral equivalent of
 *     "git merge --no-ff with zero conflicts" — each Story's writer
 *     output keeps the other Story's rows untouched).
 *   - Omitting scope preserves current behaviour (regression-fail-safe).
 *   - Scope is composed BEFORE epsilon: out-of-scope rows are preserved
 *     verbatim regardless of epsilon, while in-scope rows still go through
 *     the stabilizer.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildWriterScopeArgs,
  readPriorBaselineRows,
} from '../../.agents/scripts/lib/baselines/diff-scope-cli.js';
import { write } from '../../.agents/scripts/lib/baselines/writer.js';

const FIXED = '2026-05-15T00:00:00Z';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const PRIOR_MI_ROWS = [
  { path: 'src/a.js', mi: 70 },
  { path: 'src/b.js', mi: 80 },
  { path: 'src/c.js', mi: 65 },
];

describe('writer.write — scope parameter (Story #1974)', () => {
  it('AC: preserves rows whose path !== scope.files entry verbatim', () => {
    const regen = [
      { path: 'src/a.js', mi: 90 }, // in-scope: regen wins
      { path: 'src/b.js', mi: 10 }, // out-of-scope: prior preserved
      { path: 'src/c.js', mi: 10 }, // out-of-scope: prior preserved
    ];
    const env = write({
      kind: 'maintainability',
      rows: regen,
      prior: PRIOR_MI_ROWS,
      scope: { mode: 'diff', files: new Set(['src/a.js']) },
      generatedAt: FIXED,
    });
    const byPath = Object.fromEntries(env.rows.map((r) => [r.path, r.mi]));
    assert.equal(byPath['src/a.js'], 90, 'in-scope row should be regenerated');
    assert.equal(
      byPath['src/b.js'],
      80,
      'out-of-scope row preserved from prior',
    );
    assert.equal(
      byPath['src/c.js'],
      65,
      'out-of-scope row preserved from prior',
    );
  });

  it('AC: omitting scope preserves current behaviour (regression-fail-safe)', () => {
    const regen = [
      { path: 'src/a.js', mi: 90 },
      { path: 'src/b.js', mi: 10 },
      { path: 'src/c.js', mi: 10 },
    ];
    const env = write({
      kind: 'maintainability',
      rows: regen,
      prior: PRIOR_MI_ROWS,
      generatedAt: FIXED,
    });
    const byPath = Object.fromEntries(env.rows.map((r) => [r.path, r.mi]));
    // Without scope, prior is irrelevant for merge — regen wins everywhere.
    assert.equal(byPath['src/a.js'], 90);
    assert.equal(byPath['src/b.js'], 10);
    assert.equal(byPath['src/c.js'], 10);
  });

  it('full-mode scope: regen wins everywhere (same as no scope)', () => {
    const regen = [
      { path: 'src/a.js', mi: 90 },
      { path: 'src/b.js', mi: 10 },
    ];
    const env = write({
      kind: 'maintainability',
      rows: regen,
      prior: PRIOR_MI_ROWS,
      scope: { mode: 'full', files: new Set() },
      generatedAt: FIXED,
    });
    const byPath = Object.fromEntries(env.rows.map((r) => [r.path, r.mi]));
    assert.equal(byPath['src/a.js'], 90);
    assert.equal(byPath['src/b.js'], 10);
  });

  it('AC: two concurrent stories on disjoint files produce non-overlapping baseline diffs', () => {
    // Both stories see PRIOR_MI_ROWS as their baseline starting point.
    // Story A touches src/a.js only; Story B touches src/b.js only.
    // The resulting envelopes must each preserve the OTHER story's rows
    // verbatim — this is the in-process moral equivalent of "git merge
    // --no-ff with zero conflicts on baselines/maintainability.json".
    const storyARegen = [
      { path: 'src/a.js', mi: 90 },
      // Story A's regen path may include rows from outside its scope (the
      // regen helper rewrites the whole file). The writer is responsible
      // for filtering them out via mergeRows.
      { path: 'src/b.js', mi: 100 },
      { path: 'src/c.js', mi: 100 },
    ];
    const storyBRegen = [
      { path: 'src/a.js', mi: 100 },
      { path: 'src/b.js', mi: 95 },
      { path: 'src/c.js', mi: 100 },
    ];
    const envA = write({
      kind: 'maintainability',
      rows: storyARegen,
      prior: PRIOR_MI_ROWS,
      scope: { mode: 'diff', files: new Set(['src/a.js']) },
      generatedAt: FIXED,
    });
    const envB = write({
      kind: 'maintainability',
      rows: storyBRegen,
      prior: PRIOR_MI_ROWS,
      scope: { mode: 'diff', files: new Set(['src/b.js']) },
      generatedAt: FIXED,
    });

    const aByPath = Object.fromEntries(envA.rows.map((r) => [r.path, r.mi]));
    const bByPath = Object.fromEntries(envB.rows.map((r) => [r.path, r.mi]));

    // Story A: only src/a.js drifts; src/b.js + src/c.js identical to PRIOR.
    assert.equal(aByPath['src/a.js'], 90);
    assert.equal(aByPath['src/b.js'], 80);
    assert.equal(aByPath['src/c.js'], 65);

    // Story B: only src/b.js drifts; src/a.js + src/c.js identical to PRIOR.
    assert.equal(bByPath['src/a.js'], 70);
    assert.equal(bByPath['src/b.js'], 95);
    assert.equal(bByPath['src/c.js'], 65);

    // The "diffs" against PRIOR are non-overlapping by row identity:
    //   Story A's drifted set: { src/a.js }
    //   Story B's drifted set: { src/b.js }
    // No row identity appears in both drifted sets → a textual three-way
    // merge of the two envelopes against PRIOR collides on zero rows.
    const driftedA = envA.rows
      .filter((r) => {
        const prior = PRIOR_MI_ROWS.find((p) => p.path === r.path);
        return !prior || prior.mi !== r.mi;
      })
      .map((r) => r.path);
    const driftedB = envB.rows
      .filter((r) => {
        const prior = PRIOR_MI_ROWS.find((p) => p.path === r.path);
        return !prior || prior.mi !== r.mi;
      })
      .map((r) => r.path);
    assert.deepEqual(driftedA, ['src/a.js']);
    assert.deepEqual(driftedB, ['src/b.js']);
    const overlap = driftedA.filter((p) => driftedB.includes(p));
    assert.deepEqual(overlap, [], 'drifted row sets must be disjoint');
  });

  it('scope is composed BEFORE epsilon: out-of-scope rows ignore epsilon entirely', () => {
    // Story scope is { src/a.js }. The regenerated value for src/b.js is
    // 100 — far over any reasonable epsilon. Without scope+merge, epsilon
    // would not save us. With scope-merge first, src/b.js never reaches
    // applyEpsilon — the prior row (mi=80) lands verbatim.
    const regen = [
      { path: 'src/a.js', mi: 70.3 }, // in-scope, sub-epsilon vs prior
      { path: 'src/b.js', mi: 100 }, // out-of-scope, would-be regression
    ];
    const env = write({
      kind: 'maintainability',
      rows: regen,
      prior: PRIOR_MI_ROWS,
      scope: { mode: 'diff', files: new Set(['src/a.js']) },
      epsilon: 0.5,
      generatedAt: FIXED,
    });
    const byPath = Object.fromEntries(env.rows.map((r) => [r.path, r.mi]));
    // src/a.js: in-scope, sub-epsilon → prior bytes (mi=70).
    assert.equal(byPath['src/a.js'], 70);
    // src/b.js: out-of-scope → prior bytes (mi=80), never reaches epsilon.
    assert.equal(byPath['src/b.js'], 80);
    // src/c.js: prior preserved (regen omitted it; the merge backfills).
    assert.equal(byPath['src/c.js'], 65);
  });

  it('null scope: behaves identically to omitted scope', () => {
    const regen = [{ path: 'src/a.js', mi: 90 }];
    const env = write({
      kind: 'maintainability',
      rows: regen,
      prior: PRIOR_MI_ROWS,
      scope: null,
      generatedAt: FIXED,
    });
    const byPath = Object.fromEntries(env.rows.map((r) => [r.path, r.mi]));
    assert.equal(byPath['src/a.js'], 90);
    // Without scope, the merger does not run — out-of-scope prior rows are
    // NOT backfilled. (Same contract as pre-#1974.)
    assert.equal(byPath['src/b.js'], undefined);
  });
});

// ---------------------------------------------------------------------------
// Story #4937 — the prior reader must dispatch per kind, or scope
// preservation and epsilon damping are both inert for every kind whose rows
// are not keyed on `mi`.
// ---------------------------------------------------------------------------

/**
 * One canonical row per baseline kind, in the exact shape that kind's
 * `projectRow` emits. The fixture is the audit: a kind whose rows survive
 * this reader is a kind the reader models correctly.
 */
const CANONICAL_ROWS_BY_KIND = Object.freeze({
  'bundle-size': [{ bundle: 'main', rawKb: 120.5, gzippedKb: 40.25 }],
  coverage: [{ path: 'src/a.js', lines: 90, branches: 80, functions: 85 }],
  crap: [{ path: 'src/a.js', method: 'render', startLine: 12, crap: 18 }],
  duplication: [
    { path: 'src/a.js', duplicatedLines: 10, totalLines: 100, percentage: 10 },
  ],
  lighthouse: [
    {
      route: 'dashboard',
      performance: 92,
      accessibility: 96,
      bestPractices: 90,
      seo: 88,
    },
  ],
  lint: [{ path: 'src/a.js', errorCount: 0, warningCount: 3 }],
  maintainability: [{ path: 'src/a.js', mi: 70 }],
  mutation: [{ path: 'src/a.js', score: 81, killed: 8, survived: 2 }],
});

/** The pre-#4937 default reader, kept verbatim as the regression oracle. */
function legacyMaintainabilityFilter(rows) {
  return rows.filter(
    (r) => r && typeof r.path === 'string' && typeof r.mi === 'number',
  );
}

/** An `fs` seam that serves one in-memory baseline envelope. */
function fsServing(envelope) {
  return { readFileSync: () => JSON.stringify(envelope) };
}

/** A `spawnSync` seam that reports `files` as the diff footprint. */
function spawnDiffing(files) {
  return () => ({ status: 0, stdout: `${files.join('\n')}\n` });
}

describe('readPriorBaselineRows — per-kind dispatch (Story #4937)', () => {
  it('AC-4: every kind reads its own rows back, whether or not they carry `mi`', () => {
    for (const [kind, rows] of Object.entries(CANONICAL_ROWS_BY_KIND)) {
      const prior = readPriorBaselineRows({
        kind,
        absBaselinePath: `/virtual/${kind}.json`,
        fsImpl: fsServing({ rows }),
      });
      assert.deepEqual(
        prior,
        rows,
        `kind "${kind}" must read its own canonical rows back intact`,
      );
    }
  });

  it('AC-4: the kinds that regressed are exactly those whose rows lack `mi`', () => {
    // Guards the fix against a silent re-introduction: if a kind's rows
    // survive the legacy `mi` filter, that kind was never at risk; every
    // other kind was returning an empty prior before this Story.
    const wouldHaveBeenEmptied = Object.entries(CANONICAL_ROWS_BY_KIND)
      .filter(
        ([kind, rows]) =>
          kind !== 'crap' && legacyMaintainabilityFilter(rows).length === 0,
      )
      .map(([kind]) => kind);
    assert.deepEqual(wouldHaveBeenEmptied.sort(), [
      'bundle-size',
      'coverage',
      'duplication',
      'lighthouse',
      'lint',
      'mutation',
    ]);
  });

  it('AC-1: a kind with no declared row contract throws instead of borrowing one', () => {
    assert.throws(
      () =>
        readPriorBaselineRows({
          kind: 'not-a-kind',
          absBaselinePath: '/virtual/none.json',
          fsImpl: fsServing({ rows: [] }),
        }),
      /no prior-row contract registered for kind "not-a-kind"/,
    );
  });

  it('AC-2: the committed duplication baseline reads back as a non-empty prior', () => {
    const prior = readPriorBaselineRows({
      kind: 'duplication',
      absBaselinePath: path.join(REPO_ROOT, 'baselines/duplication.json'),
    });
    assert.ok(Array.isArray(prior), 'prior must be an array');
    assert.ok(
      prior.length > 0,
      'update-duplication-baseline.js must receive a non-empty prior',
    );
    assert.equal(typeof prior[0].percentage, 'number');
  });

  it('AC-3: a --diff-scope duplication run PRESERVES out-of-scope rows', () => {
    const priorRows = [
      {
        path: 'src/a.js',
        duplicatedLines: 10,
        totalLines: 100,
        percentage: 10,
      },
      {
        path: 'src/b.js',
        duplicatedLines: 30,
        totalLines: 100,
        percentage: 30,
      },
      { path: 'src/c.js', duplicatedLines: 5, totalLines: 100, percentage: 5 },
    ];
    // The CLI's own compose call, with only the I/O seams substituted.
    const scopeArgs = buildWriterScopeArgs({
      kind: 'duplication',
      absBaselinePath: '/virtual/duplication.json',
      epsilon: 0.5,
      argv: ['--diff-scope', 'main'],
      logTag: '[Duplication]',
      fsImpl: fsServing({ rows: priorRows }),
      spawnImpl: spawnDiffing(['src/a.js']),
    });
    // A rescan: src/a.js is the only file in the diff. src/b.js comes back
    // re-measured and src/c.js does not come back at all (jscpd only reports
    // files it currently finds clones in). Both are out of scope, so both
    // must land from the prior — the second is the truncation case.
    const env = write({
      kind: 'duplication',
      rows: [
        {
          path: 'src/a.js',
          duplicatedLines: 40,
          totalLines: 100,
          percentage: 40,
        },
        {
          path: 'src/b.js',
          duplicatedLines: 0,
          totalLines: 100,
          percentage: 0,
        },
      ],
      generatedAt: FIXED,
      ...scopeArgs,
    });
    assert.deepEqual(
      env.rows.map((r) => r.path).sort(),
      ['src/a.js', 'src/b.js', 'src/c.js'],
      'a diff-scoped run must not truncate the baseline to the diff',
    );
    const byPath = Object.fromEntries(
      env.rows.map((r) => [r.path, r.percentage]),
    );
    assert.equal(byPath['src/a.js'], 40, 'in-scope row is regenerated');
    assert.equal(byPath['src/b.js'], 30, 'out-of-scope row preserved verbatim');
    assert.equal(
      byPath['src/c.js'],
      5,
      'an out-of-scope row absent from the rescan is carried forward, not dropped',
    );
  });

  it('AC-5: an explicit epsilon folds a sub-epsilon percentage back to the prior', () => {
    const priorRows = [
      {
        path: 'src/a.js',
        duplicatedLines: 10,
        totalLines: 100,
        percentage: 10,
      },
    ];
    const scopeArgs = buildWriterScopeArgs({
      kind: 'duplication',
      absBaselinePath: '/virtual/duplication.json',
      epsilon: 0.5,
      argv: ['--diff-scope', 'main'],
      logTag: '[Duplication]',
      fsImpl: fsServing({ rows: priorRows }),
      spawnImpl: spawnDiffing(['src/a.js']),
    });
    assert.equal(scopeArgs.epsilon, 0.5, 'a readable prior arms epsilon');
    const env = write({
      kind: 'duplication',
      // In-scope, and 0.3pp away from the prior — inside epsilon.
      rows: [
        {
          path: 'src/a.js',
          duplicatedLines: 10,
          totalLines: 100,
          percentage: 10.3,
        },
      ],
      generatedAt: FIXED,
      ...scopeArgs,
    });
    assert.equal(
      env.rows[0].percentage,
      10,
      'a sub-epsilon reading must fold back to the prior percentage',
    );
  });
});
