import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTelemetry } from '../../.agents/scripts/lib/orchestration/telemetry.js';
import { MockProvider } from '../fixtures/mock-provider.js';

describe('telemetry', () => {
  it('detects friction markers in recent comments', async () => {
    const provider = new MockProvider();
    provider.comments = [
      { id: 101, payload: { body: '⚠️ **Friction** Stalling here' } },
      { id: 102, payload: { body: '[FRICTION] API timed out' } },
      { id: 103, payload: { body: 'Normal progress update' } },
      { id: 101, payload: { body: 'Fixed the issue' } },
    ];

    const tasks = [{ id: 101 }, { id: 102 }];
    const result = await fetchTelemetry(provider, tasks);

    assert.strictEqual(result.totalFriction, 2);
    assert.strictEqual(result.recentFriction.length, 2);
    assert.strictEqual(result.recentFriction[0].taskId, 101);
    assert.ok(result.recentFriction[0].message.includes('Stalling here'));
    assert.strictEqual(result.recentFriction[1].taskId, 102);
    assert.ok(result.recentFriction[1].message.includes('API timed out'));
  });

  it('limits recentFriction to 5 entries', async () => {
    const provider = new MockProvider();
    for (let i = 0; i < 10; i++) {
        provider.comments.push({ id: 200, payload: { body: '[FRICTION] Error ' + i } });
    }

    const tasks = [{ id: 200 }];
    const result = await fetchTelemetry(provider, tasks);

    assert.strictEqual(result.totalFriction, 10);
    assert.strictEqual(result.recentFriction.length, 5);
  });

  it('swallows errors if provider.getRecentComments fails', async () => {
    const provider = {
      getRecentComments: () => { throw new Error('API Down'); }
    };

    const result = await fetchTelemetry(provider, [{ id: 1 }]);
    assert.strictEqual(result.totalFriction, 0);
    assert.strictEqual(result.recentFriction.length, 0);
  });

  it('truncates long friction messages', async () => {
    const provider = new MockProvider();
    const longMsg = 'A'.repeat(200);
    provider.comments = [{ id: 101, payload: { body: '[FRICTION] ' + longMsg } }];

    const tasks = [{ id: 101 }];
    const result = await fetchTelemetry(provider, tasks);

    assert.strictEqual(result.recentFriction[0].message.length, 153); // 150 + ...
    assert.ok(result.recentFriction[0].message.endsWith('...'));
  });
});
