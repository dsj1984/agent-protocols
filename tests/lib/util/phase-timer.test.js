import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOWED_PHASE_NAMES,
  createPhaseTimer,
} from '../../../.agents/scripts/lib/util/phase-timer.js';

function makeClock(steps) {
  let i = 0;
  return () => steps[Math.min(i++, steps.length - 1)];
}

describe('createPhaseTimer', () => {
  it('records ordered phases with wall-clock elapsedMs between marks', () => {
    const now = makeClock([1000, 1100, 1350, 1360, 2000]);
    // createdAt, mark worktree-create, mark bootstrap, mark install, finish
    const lines = [];
    const t = createPhaseTimer(123, {
      now,
      logger: (l) => lines.push(l),
    });
    t.mark('worktree-create'); // opens at 1100
    t.mark('bootstrap'); // closes wc=250, opens at 1350
    t.mark('install'); // closes bootstrap=10, opens at 1360
    const summary = t.finish(); // closes install=640

    assert.equal(summary.storyId, 123);
    assert.equal(summary.totalMs, 1000); // 2000 - 1000
    assert.deepEqual(summary.phases, [
      { name: 'worktree-create', elapsedMs: 250 },
      { name: 'bootstrap', elapsedMs: 10 },
      { name: 'install', elapsedMs: 640 },
    ]);
    assert.equal(lines.length, 3);
    assert.equal(
      lines[0],
      '[phase-timing] story=123 phase=worktree-create elapsedMs=250',
    );
    assert.equal(
      lines[2],
      '[phase-timing] story=123 phase=install elapsedMs=640',
    );
  });

  it('rejects unknown phase names', () => {
    const t = createPhaseTimer(1, { now: () => 0, logger: () => {} });
    assert.throws(() => t.mark('compile'), /unknown phase 'compile'/);
    // Enum membership check is exhaustive on the known set.
    for (const name of ALLOWED_PHASE_NAMES) {
      // Fresh timer each iter so prior marks don't interact.
      const fresh = createPhaseTimer(1, { now: () => 0, logger: () => {} });
      assert.doesNotThrow(() => fresh.mark(name));
    }
  });

  it('finish() is idempotent — returns the same summary on repeat calls', () => {
    let t = 0;
    const now = () => ++t;
    const timer = createPhaseTimer(42, { now, logger: () => {} });
    timer.mark('implement');
    const first = timer.finish();
    const second = timer.finish();
    assert.equal(first, second); // cached reference
    // Calling finish again must not advance the clock via another close.
    assert.deepEqual(first.phases, second.phases);
  });

  it('mark() after finish() throws', () => {
    const timer = createPhaseTimer(7, {
      now: makeClock([0, 1, 2, 3]),
      logger: () => {},
    });
    timer.mark('lint');
    timer.finish();
    assert.throws(
      () => timer.mark('test'),
      /cannot mark\('test'\) after finish/,
    );
  });

  it('snapshot/restore round-trips across a process boundary', () => {
    const clockA = makeClock([100, 200, 400]);
    const linesA = [];
    const t1 = createPhaseTimer(9, {
      now: clockA,
      logger: (l) => linesA.push(l),
    });
    t1.mark('worktree-create'); // opens at 200
    // Snapshot while wc is still open — simulates end of init phase.
    const snap = t1.snapshot();
    assert.equal(snap.current.name, 'worktree-create');
    assert.equal(snap.current.openedAt, 200);
    assert.equal(snap.createdAt, 100);
    assert.equal(snap.phases.length, 0);

    // Second process: restore and continue.
    const clockB = makeClock([500, 700, 900]);
    const linesB = [];
    const t2 = createPhaseTimer(9, {
      now: clockB,
      logger: (l) => linesB.push(l),
      restore: JSON.parse(JSON.stringify(snap)), // force a serialization round-trip
    });
    t2.mark('lint'); // closes worktree-create at 500 → elapsed 300, opens lint at 500
    const summary = t2.finish(); // closes lint at 700 → elapsed 200

    assert.equal(summary.storyId, 9);
    assert.equal(summary.totalMs, 600); // 700 - 100 (createdAt preserved)
    assert.deepEqual(summary.phases, [
      { name: 'worktree-create', elapsedMs: 300 },
      { name: 'lint', elapsedMs: 200 },
    ]);
    // Only the second process's closures log from its logger.
    assert.equal(linesA.length, 0);
    assert.equal(linesB.length, 2);
  });

  it('snapshot preserves a finished summary so post-finish restores are stable', () => {
    const t = createPhaseTimer(5, {
      now: makeClock([0, 10, 20]),
      logger: () => {},
    });
    t.mark('close');
    const original = t.finish();
    const snap = t.snapshot();

    const restored = createPhaseTimer(5, {
      now: () => 9999,
      logger: () => {},
      restore: snap,
    });
    assert.throws(() => restored.mark('api-sync'), /after finish\(\)/);
    assert.deepEqual(restored.finish(), original);
  });
});
