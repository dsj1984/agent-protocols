import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WaveScheduler } from '../../.agents/scripts/lib/orchestration/epic-runner/wave-scheduler.js';

describe('WaveScheduler', () => {
  it('yields waves in order and advances the pointer', () => {
    const waves = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
      [{ id: 4 }, { id: 5 }],
    ];
    const s = new WaveScheduler(waves);
    assert.equal(s.totalWaves, 3);
    assert.equal(s.hasMoreWaves(), true);

    const w0 = s.nextWave();
    assert.equal(w0.index, 0);
    assert.deepEqual(
      w0.stories.map((x) => x.id),
      [1, 2],
    );

    const w1 = s.nextWave();
    assert.equal(w1.index, 1);

    const w2 = s.nextWave();
    assert.equal(w2.index, 2);

    assert.equal(s.hasMoreWaves(), false);
    assert.equal(s.nextWave(), null);
  });

  it('tracks completed waves without allowing out-of-order completion', () => {
    const s = new WaveScheduler([[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]]);
    s.nextWave();
    s.markWaveComplete(0);
    s.markWaveComplete(0); // idempotent
    assert.deepEqual(s.completedWaves(), [0]);

    assert.throws(() => s.markWaveComplete(1), /has not been yielded/);
    assert.throws(() => s.markWaveComplete(99), RangeError);
  });

  it('rejects non-array input', () => {
    assert.throws(() => new WaveScheduler(null), TypeError);
    assert.throws(() => new WaveScheduler('nope'), TypeError);
  });
});
