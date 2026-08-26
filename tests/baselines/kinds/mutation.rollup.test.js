import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBaselineSemantics } from '../../../.agents/scripts/lib/baselines/kernel.js';
import {
  assertBaselineCompatible,
  kernelVersion,
  rollup,
} from '../../../.agents/scripts/lib/baselines/kinds/mutation.js';

// ---------------------------------------------------------------------------
// mutation.rollup.test.js — the mutant-weighted rollup aggregate and its
// fail-closed semantics migration (Story #5058). `aggregate` is not exported;
// it is reached through `rollup(rows)['*']`, which is how every production
// caller reaches it too.
// ---------------------------------------------------------------------------

function row(path, score, killed = 0, survived = 0) {
  return { path, score, killed, survived };
}

/** The superseded arithmetic, kept here only as the contrast under test. */
function unweightedMean(rows) {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + (r.score ?? 0), 0);
  return Number((sum / rows.length).toFixed(2));
}

/** Build a 1887-mutant, 31-file set whose score is 85.18 either way. */
function calibratedSet() {
  const rows = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push(row(`src/f${i}.js`, 85.18, 51, 9)); // 60 mutants each → 1800
  }
  rows.push(row('src/big.js', 85.18, 74, 13)); // 87 mutants → 1887 total
  return rows;
}

describe('kinds/mutation rollup aggregate — mutant weighting', () => {
  it('AC-1: weights each file score by its mutant count, not by file count', () => {
    const rows = [row('src/a.js', 100, 3, 0), row('src/b.js', 0, 0, 97)];
    // (100*3 + 0*97) / (3 + 97) = 3.0 — the unweighted file mean is 50.
    assert.equal(rollup(rows)['*'].score, 3);
    assert.equal(unweightedMean(rows), 50);
  });

  it('AC-2: killed and survived stay plain sums and noCoverage stays 0', () => {
    const rows = [row('src/a.js', 100, 3, 0), row('src/b.js', 0, 0, 97)];
    const out = rollup(rows)['*'];
    assert.equal(out.killed, 3);
    assert.equal(out.survived, 97);
    assert.equal(out.noCoverage, 0);
  });

  it('AC-2: weighting changes score only — the rollup keeps its four keys', () => {
    const out = rollup([row('src/a.js', 80, 8, 2)])['*'];
    assert.deepEqual(Object.keys(out).sort(), [
      'killed',
      'noCoverage',
      'score',
      'survived',
    ]);
  });

  it('AC-3: empty rows return the zero rollup shape', () => {
    assert.deepEqual(rollup([])['*'], {
      score: 0,
      killed: 0,
      survived: 0,
      noCoverage: 0,
    });
  });

  it('AC-3: rows whose mutant counts sum to zero produce no NaN or Infinity', () => {
    const out = rollup([row('src/a.js', 50, 0, 0), row('src/b.js', 75, 0, 0)])[
      '*'
    ];
    assert.ok(Number.isFinite(out.score), `score was ${out.score}`);
    assert.deepEqual(out, {
      score: 0,
      killed: 0,
      survived: 0,
      noCoverage: 0,
    });
  });

  it('AC-3: a zero-mutant row does not poison a set that has mutants', () => {
    const out = rollup([row('src/a.js', 90, 9, 1), row('src/b.js', 0, 0, 0)])[
      '*'
    ];
    assert.equal(out.score, 90);
    assert.ok(Number.isFinite(out.score));
  });

  it('AC-4: a new row can move the rollup by no more than its mutant share', () => {
    const before = calibratedSet();
    assert.equal(rollup(before)['*'].score, 85.18);

    // A thinly-mutated new file: 4 mutants, all survived, 0%.
    const newRow = row('src/new.js', 0, 0, 4);
    const after = [...before, newRow];

    const weightedDelta = rollup(before)['*'].score - rollup(after)['*'].score;
    assert.ok(
      weightedDelta < 0.2,
      `weighted score moved by ${weightedDelta}, expected < 0.2`,
    );

    // The superseded unweighted mean gave the same 4-mutant file a full
    // 1/32 share of the whole-repo number. (The Story cites 2.68 from a real
    // consumer set; the exact figure varies with file count, the point is the
    // order of magnitude.)
    const unweightedDelta = unweightedMean(before) - unweightedMean(after);
    assert.ok(
      unweightedDelta > 2.5,
      `unweighted mean moved by ${unweightedDelta}, expected > 2.5`,
    );
  });

  it('rolls components up with the same weighting as the whole-repo bucket', () => {
    const rows = [
      row('src/a.js', 100, 3, 0),
      row('src/b.js', 0, 0, 97),
      row('other/c.js', 100, 50, 0),
    ];
    const out = rollup(rows, [{ name: 'src', includes: 'src' }]);
    assert.equal(out.src.score, 3);
    assert.equal(out.src.killed, 3);
    assert.equal(out.src.survived, 97);
  });
});

describe('kinds/mutation semantics migration (Story #5058)', () => {
  it('AC-5: the kernel version is bumped off the pre-weighting 1.0.0', () => {
    assert.notEqual(kernelVersion(), '1.0.0');
    assert.equal(kernelVersion(), '2.0.0');
  });

  it('AC-5: a baseline stamped below the new kernel version is rejected', () => {
    const message = assertBaselineCompatible({
      kernelVersion: '1.0.0',
      rows: [row('src/a.js', 85, 85, 15)],
    });
    assert.ok(message, 'expected an operator-facing rejection message');
    assert.match(message, /\[mutation\]/);
    assert.match(message, /1\.0\.0/);
    assert.match(message, /2\.0\.0/);
  });

  it('AC-5: the rejection names the command that re-seeds the baseline', () => {
    const message = assertBaselineCompatible({ kernelVersion: '1.0.0' });
    assert.match(message, /stryker run/);
    assert.match(message, /baseline-refresh:/);
  });

  it('AC-5: an unstamped baseline is rejected too (fail closed)', () => {
    const message = assertBaselineCompatible({ rows: [] });
    assert.ok(message);
    assert.match(message, /<unstamped>/);
  });

  it('AC-6: a baseline stamped with the new kernel version passes', () => {
    assert.equal(
      assertBaselineCompatible({
        kernelVersion: '2.0.0',
        rows: [row('src/a.js', 85, 85, 15)],
      }),
      null,
    );
  });

  it('AC-6: a baseline stamped above the new kernel version passes', () => {
    assert.equal(assertBaselineCompatible({ kernelVersion: '3.1.0' }), null);
  });

  it('AC-6: a missing baseline is not a semantics failure', () => {
    assert.equal(assertBaselineCompatible(null), null);
  });

  it('AC-5/AC-6: the hook is reachable through checkBaselineSemantics', () => {
    assert.ok(checkBaselineSemantics('mutation', { kernelVersion: '1.0.0' }));
    assert.equal(
      checkBaselineSemantics('mutation', { kernelVersion: '2.0.0' }),
      null,
    );
  });
});
