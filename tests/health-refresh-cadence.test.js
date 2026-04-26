import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideRefresh } from '../.agents/scripts/lib/orchestration/health-refresh-cadence.js';

describe('decideRefresh — every-close cadence', () => {
  it('refreshes on every close regardless of state', () => {
    const config = { cadence: 'every-close' };
    for (const closeCount of [0, 1, 5, 99]) {
      const result = decideRefresh(config, { closeCount });
      assert.equal(result.refresh, true);
      assert.match(result.reason, /every-close/);
    }
  });
});

describe('decideRefresh — every-n-closes cadence', () => {
  it('refreshes when (closeCount + 1) is a multiple of n', () => {
    const config = { cadence: 'every-n-closes', everyNCloses: 3 };
    // closeCount is the count BEFORE this one. The 3rd, 6th, 9th close fire.
    assert.equal(decideRefresh(config, { closeCount: 0 }).refresh, false); // 1st close
    assert.equal(decideRefresh(config, { closeCount: 1 }).refresh, false); // 2nd close
    assert.equal(decideRefresh(config, { closeCount: 2 }).refresh, true); // 3rd
    assert.equal(decideRefresh(config, { closeCount: 3 }).refresh, false); // 4th
    assert.equal(decideRefresh(config, { closeCount: 5 }).refresh, true); // 6th
    assert.equal(decideRefresh(config, { closeCount: 8 }).refresh, true); // 9th
  });

  it('fails open when everyNCloses is missing or invalid', () => {
    for (const everyNCloses of [undefined, null, 0, -1, 'three']) {
      const result = decideRefresh(
        { cadence: 'every-n-closes', everyNCloses },
        { closeCount: 0 },
      );
      assert.equal(result.refresh, true);
      assert.match(result.reason, /missing\/invalid/);
    }
  });

  it('with n=1 behaves like every-close', () => {
    const config = { cadence: 'every-n-closes', everyNCloses: 1 };
    for (const closeCount of [0, 1, 2, 7]) {
      assert.equal(decideRefresh(config, { closeCount }).refresh, true);
    }
  });
});

describe('decideRefresh — wave-boundary cadence', () => {
  it('refreshes on first encounter (lastRefreshedWave is null)', () => {
    const result = decideRefresh(
      { cadence: 'wave-boundary' },
      { currentStoryWave: 0, lastRefreshedWave: null },
    );
    assert.equal(result.refresh, true);
    assert.match(result.reason, /entered wave 0/);
  });

  it('refreshes when crossing into a higher wave', () => {
    const result = decideRefresh(
      { cadence: 'wave-boundary' },
      { currentStoryWave: 2, lastRefreshedWave: 1 },
    );
    assert.equal(result.refresh, true);
    assert.match(result.reason, /entered wave 2/);
  });

  it('skips when story sits in a wave already refreshed for', () => {
    const result = decideRefresh(
      { cadence: 'wave-boundary' },
      { currentStoryWave: 1, lastRefreshedWave: 1 },
    );
    assert.equal(result.refresh, false);
    assert.match(result.reason, /already refreshed for wave 1/);
  });

  it('skips when story sits in a lower wave than last refreshed', () => {
    // Pathological — out-of-order closure within a wave shouldn't trigger
    // a regress refresh.
    const result = decideRefresh(
      { cadence: 'wave-boundary' },
      { currentStoryWave: 0, lastRefreshedWave: 2 },
    );
    assert.equal(result.refresh, false);
  });

  it('fails open when current story wave is unknown', () => {
    for (const currentStoryWave of [null, undefined, 'one']) {
      const result = decideRefresh(
        { cadence: 'wave-boundary' },
        { currentStoryWave, lastRefreshedWave: 1 },
      );
      assert.equal(result.refresh, true);
      assert.match(result.reason, /unknown/);
    }
  });
});

describe('decideRefresh — min-interval cadence', () => {
  it('refreshes on the first call when lastRefreshAt is null', () => {
    const result = decideRefresh(
      { cadence: 'min-interval', minIntervalSec: 60 },
      { lastRefreshAt: null },
      1_700_000_000_000,
    );
    assert.equal(result.refresh, true);
    assert.match(result.reason, /first refresh/);
  });

  it('refreshes once minIntervalSec has elapsed', () => {
    const now = 1_700_000_000_000;
    const result = decideRefresh(
      { cadence: 'min-interval', minIntervalSec: 60 },
      { lastRefreshAt: now - 60_500 },
      now,
    );
    assert.equal(result.refresh, true);
    assert.match(result.reason, /60s elapsed/);
  });

  it('skips when not enough time has elapsed', () => {
    const now = 1_700_000_000_000;
    const result = decideRefresh(
      { cadence: 'min-interval', minIntervalSec: 60 },
      { lastRefreshAt: now - 30_000 },
      now,
    );
    assert.equal(result.refresh, false);
    assert.match(result.reason, /only 30s elapsed/);
  });

  it('fails open when minIntervalSec is missing or invalid', () => {
    for (const minIntervalSec of [undefined, null, 0, -1]) {
      const result = decideRefresh(
        { cadence: 'min-interval', minIntervalSec },
        { lastRefreshAt: 0 },
        1_000,
      );
      assert.equal(result.refresh, true);
      assert.match(result.reason, /missing\/invalid/);
    }
  });
});

describe('decideRefresh — defaults & edge cases', () => {
  it('treats null/undefined config as wave-boundary default', () => {
    // Default cadence is wave-boundary; with no story wave it fails open.
    const result = decideRefresh(undefined, {});
    assert.equal(result.refresh, true);
  });

  it('refreshes with explicit reason on unrecognised cadence value', () => {
    const result = decideRefresh({ cadence: 'bogus' }, { closeCount: 5 });
    assert.equal(result.refresh, true);
    assert.match(result.reason, /unrecognised/);
  });
});
