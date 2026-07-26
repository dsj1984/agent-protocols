// tests/lib/baselines/drift-detector.test.js
/**
 * Story #4776 — full-scope baseline drift detection.
 *
 * The point of this module is the case the diff-scoped gates structurally
 * cannot see: a file nobody has touched since its baseline row was written.
 * The centrepiece test below therefore drifts ONLY an untouched row and
 * asserts it is still caught.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseArgs,
  runCheckBaselineDrift,
} from '../../../.agents/scripts/check-baseline-drift.js';
import {
  DRIFT_KINDS,
  detectBaselineDrift,
  detectKindDrift,
  diffRows,
  formatDriftReport,
  formatKindDrift,
  projectScoredRows,
  resolveTolerance,
} from '../../../.agents/scripts/lib/baselines/drift-detector.js';

const MI_BASELINE = [
  { path: 'src/touched.js', mi: 80 },
  { path: 'src/untouched.js', mi: 75 },
];

function miSeams({ rows, baseline = MI_BASELINE }) {
  return {
    loadBaselineRows: () => baseline,
    scoreFullScope: async () => rows,
  };
}

describe('resolveTolerance', () => {
  it('prefers an explicit override, as an absolute value', () => {
    assert.equal(resolveTolerance('maintainability', {}, -2), 2);
  });

  it("falls back to the gate's configured absolute tolerance", () => {
    const gate = { tolerance: { kind: 'absolute', value: 1.25 } };
    assert.equal(resolveTolerance('maintainability', gate, null), 1.25);
  });

  it('falls back to the per-kind default when nothing is configured', () => {
    assert.equal(resolveTolerance('maintainability', undefined, null), 0.5);
    assert.equal(resolveTolerance('crap', undefined, null), 0.001);
  });
});

describe('projectScoredRows', () => {
  it("reconciles the CRAP scorer's `file` key with the envelope's `path`", () => {
    const rows = projectScoredRows('crap', [
      { file: 'src/a.js', method: 'go', startLine: 3, crap: 9 },
    ]);
    assert.deepEqual(rows, [
      { path: 'src/a.js', method: 'go', startLine: 3, crap: 9 },
    ]);
  });

  it('drops rows the writer itself would refuse rather than throwing', () => {
    const rows = projectScoredRows('maintainability', [
      { path: 'src/a.js', mi: 70 },
      { path: '/absolute/is/not/canonical.js', mi: 70 },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, 'src/a.js');
  });
});

describe('diffRows', () => {
  it('classifies drift in both directions, plus added and removed rows', () => {
    const out = diffRows({
      kind: 'maintainability',
      baselineRows: MI_BASELINE,
      currentRows: [
        { path: 'src/touched.js', mi: 84 },
        { path: 'src/brand-new.js', mi: 90 },
      ],
      tolerance: 0.5,
    });
    assert.equal(out.drifted.length, 1);
    assert.equal(out.drifted[0].delta, 4);
    assert.deepEqual(
      out.added.map((a) => a.label),
      ['src/brand-new.js'],
    );
    assert.deepEqual(
      out.removed.map((r) => r.label),
      ['src/untouched.js'],
    );
  });

  it('holds rows within tolerance', () => {
    const out = diffRows({
      kind: 'maintainability',
      baselineRows: MI_BASELINE,
      currentRows: [
        { path: 'src/touched.js', mi: 80.4 },
        { path: 'src/untouched.js', mi: 75 },
      ],
      tolerance: 0.5,
    });
    assert.deepEqual(out.drifted, []);
  });

  it('keys CRAP rows per method, not per file', () => {
    const out = diffRows({
      kind: 'crap',
      baselineRows: [
        { path: 'src/a.js', method: 'one', startLine: 1, crap: 5 },
        { path: 'src/a.js', method: 'two', startLine: 9, crap: 5 },
      ],
      currentRows: [
        { path: 'src/a.js', method: 'one', startLine: 1, crap: 5 },
        { path: 'src/a.js', method: 'two', startLine: 9, crap: 22 },
      ],
      tolerance: 0.001,
    });
    assert.equal(out.drifted.length, 1);
    assert.equal(out.drifted[0].key, 'src/a.js::two@9');
  });
});

describe('detectKindDrift (AC-6)', () => {
  it('catches drift on a file untouched by any recent diff', async () => {
    const result = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      ...miSeams({
        rows: [
          // The file the branch changed is unchanged in score; only the
          // never-touched one moved. A diff-scoped gate sees nothing here.
          { path: 'src/touched.js', mi: 80 },
          { path: 'src/untouched.js', mi: 61 },
        ],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.drifted.length, 1);
    assert.equal(result.drifted[0].label, 'src/untouched.js');
    assert.equal(result.drifted[0].baseline, 75);
    assert.equal(result.drifted[0].current, 61);
    assert.equal(result.drifted[0].delta, -14);
  });

  it('is clean when every re-scored row matches its baseline', async () => {
    const result = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      ...miSeams({ rows: MI_BASELINE }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.drifted, []);
    assert.equal(result.scanned, 2);
  });

  it('honours an explicit tolerance override', async () => {
    const seams = miSeams({
      rows: [
        { path: 'src/touched.js', mi: 80 },
        { path: 'src/untouched.js', mi: 73 },
      ],
    });
    const tight = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      tolerance: 0.5,
      ...seams,
    });
    assert.equal(tight.ok, false);
    const loose = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      tolerance: 5,
      ...seams,
    });
    assert.equal(loose.ok, true);
  });

  it('skips a disabled gate, a missing baseline, and a missing scorer', async () => {
    const disabled = await detectKindDrift({
      kind: 'crap',
      quality: { crap: { enabled: false } },
      ...miSeams({ rows: [] }),
    });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.skipped, 'gate-disabled');

    const noBaseline = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      loadBaselineRows: () => null,
      scoreFullScope: async () => [],
    });
    assert.equal(noBaseline.ok, true);
    assert.equal(noBaseline.skipped, 'no-baseline');

    const noScorer = await detectKindDrift({
      kind: 'maintainability',
      quality: {},
      loadBaselineRows: () => MI_BASELINE,
      scoreFullScope: async () => null,
    });
    assert.equal(noScorer.ok, true);
    assert.equal(noScorer.skipped, 'no-scorer');
  });

  it('rejects an unknown kind', async () => {
    await assert.rejects(
      () => detectKindDrift({ kind: 'bogus', quality: {} }),
      /unknown kind "bogus"/,
    );
  });
});

describe('detectBaselineDrift', () => {
  it('is red when any single kind drifts', async () => {
    const run = await detectBaselineDrift({
      kinds: ['maintainability', 'crap'],
      quality: { crap: { enabled: false } },
      ...miSeams({
        rows: [
          { path: 'src/touched.js', mi: 80 },
          { path: 'src/untouched.js', mi: 40 },
        ],
      }),
    });
    assert.equal(run.ok, false);
    assert.equal(run.results.length, 2);
    assert.equal(run.results[1].skipped, 'gate-disabled');
  });

  it('defaults to every drift kind', () => {
    assert.deepEqual([...DRIFT_KINDS], ['maintainability', 'crap']);
  });
});

describe('drift report rendering (AC-7)', () => {
  const drifted = {
    kind: 'maintainability',
    ok: false,
    tolerance: 0.5,
    scanned: 2,
    baselineRows: 2,
    refreshCommand: 'npm run maintainability:update -- --full-scope',
    drifted: [
      {
        key: 'src/untouched.js',
        label: 'src/untouched.js',
        baseline: 75,
        current: 61,
        delta: -14,
      },
    ],
    added: [],
    removed: [],
  };

  it('prints a per-row before/after table', () => {
    const text = formatKindDrift(drifted);
    assert.match(text, /BASELINE/);
    assert.match(text, /CURRENT/);
    assert.match(text, /DELTA/);
    assert.match(text, /src\/untouched\.js\s+75\.00\s+61\.00\s+-14\.00/);
  });

  it('names the refresh remedy', () => {
    const text = formatKindDrift(drifted);
    assert.match(text, /npm run maintainability:update -- --full-scope/);
    assert.match(text, /baseline-refresh:/);
  });

  it('reports a clean or skipped kind on one line', () => {
    assert.match(
      formatKindDrift({ kind: 'crap', skipped: 'no-baseline' }),
      /⏭ crap: skipped \(no-baseline\)/,
    );
    assert.match(
      formatKindDrift({ kind: 'crap', ok: true, scanned: 9, tolerance: 0.001 }),
      /✓ crap: 9 row\(s\) re-scored full-scope/,
    );
  });

  it('summarises the whole run', () => {
    assert.match(
      formatDriftReport({ ok: true, results: [] }),
      /No baseline drift detected/,
    );
    assert.match(
      formatDriftReport({ ok: false, results: [drifted] }),
      /Baseline drift detected/,
    );
  });
});

describe('check-baseline-drift CLI (AC-7)', () => {
  it('parses gates, tolerance and --json', () => {
    assert.deepEqual(parseArgs([]), {
      kinds: ['maintainability', 'crap'],
      tolerance: null,
      json: false,
    });
    assert.deepEqual(
      parseArgs(['--gate', 'crap', '--tolerance', '2', '--json']),
      {
        kinds: ['crap'],
        tolerance: 2,
        json: true,
      },
    );
  });

  it('rejects an unknown gate, a non-numeric tolerance, and stray argv', () => {
    assert.throws(() => parseArgs(['--gate', 'bogus']), /unknown --gate/);
    assert.throws(() => parseArgs(['--tolerance', 'x']), /must be a number/);
    assert.throws(() => parseArgs(['--wat']), /unrecognised argument/);
  });

  it('exits non-zero on drift and zero when clean', async () => {
    const red = await runCheckBaselineDrift({
      argv: [],
      detect: async () => ({
        ok: false,
        results: [
          {
            kind: 'crap',
            ok: false,
            tolerance: 0.001,
            scanned: 1,
            baselineRows: 1,
            refreshCommand: 'npm run crap:update -- --full-scope',
            drifted: [
              {
                key: 'src/a.js::go@1',
                label: 'src/a.js::go (line 1)',
                baseline: 5,
                current: 40,
                delta: 35,
              },
            ],
            added: [],
            removed: [],
          },
        ],
      }),
    });
    assert.equal(red.exitCode, 1);
    assert.match(red.output, /src\/a\.js::go \(line 1\)/);
    assert.match(red.output, /\+35\.00/);

    const green = await runCheckBaselineDrift({
      argv: [],
      detect: async () => ({ ok: true, results: [] }),
    });
    assert.equal(green.exitCode, 0);
  });

  it('emits a machine-readable report under --json', async () => {
    const res = await runCheckBaselineDrift({
      argv: ['--json'],
      detect: async () => ({ ok: true, results: [] }),
    });
    assert.deepEqual(JSON.parse(res.output), {
      schemaVersion: '1',
      ok: true,
      results: [],
    });
  });
});
