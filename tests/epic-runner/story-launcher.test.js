import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StoryLauncher } from '../../.agents/scripts/lib/orchestration/epic-runner/story-launcher.js';

describe('StoryLauncher', () => {
  it('bounds concurrency to concurrencyCap', async () => {
    let active = 0;
    let peak = 0;
    const launcher = new StoryLauncher({
      concurrencyCap: 2,
      spawn: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { status: 'done' };
      },
    });

    const stories = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const results = await launcher.launchWave(stories);

    assert.equal(peak, 2, 'peak concurrency must respect cap');
    assert.equal(results.length, 5);
    for (const r of results) assert.equal(r.status, 'done');
  });

  it('preserves result order even under concurrent execution', async () => {
    const launcher = new StoryLauncher({
      concurrencyCap: 3,
      spawn: async ({ storyId }) => {
        // Bigger IDs finish faster → tests that we map back by original index.
        await new Promise((r) => setTimeout(r, (6 - storyId) * 5));
        return { status: 'done', detail: `finished-${storyId}` };
      },
    });
    const results = await launcher.launchWave([1, 2, 3, 4, 5].map((id) => ({ id })));
    assert.deepEqual(
      results.map((r) => r.storyId),
      [1, 2, 3, 4, 5],
    );
  });

  it('captures spawn errors as failed results instead of rejecting', async () => {
    const launcher = new StoryLauncher({
      concurrencyCap: 2,
      spawn: async ({ storyId }) => {
        if (storyId === 2) throw new Error('boom');
        return { status: 'done' };
      },
    });
    const results = await launcher.launchWave([{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.equal(results[0].status, 'done');
    assert.equal(results[1].status, 'failed');
    assert.match(results[1].detail, /boom/);
    assert.equal(results[2].status, 'done');
  });

  it('rejects invalid concurrencyCap', () => {
    assert.throws(
      () => new StoryLauncher({ concurrencyCap: 0, spawn: () => {} }),
      RangeError,
    );
    assert.throws(
      () => new StoryLauncher({ concurrencyCap: 1 }),
      TypeError,
    );
  });
});
