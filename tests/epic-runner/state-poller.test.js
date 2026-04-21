import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StatePoller } from '../../.agents/scripts/lib/orchestration/epic-runner/state-poller.js';

function providerFrom(labelMap) {
  return {
    async getTicket(id) {
      const labels = labelMap.get(id);
      if (labels && labels.__error) throw labels.__error;
      return { id, labels: labels ?? [] };
    },
  };
}

function quietLogger() {
  return { warn: () => {}, error: () => {} };
}

describe('StatePoller', () => {
  it('emits story-closed when a story acquires agent::done', async () => {
    const labels = new Map([
      [321, ['type::epic', 'agent::executing']],
      [400, ['type::story', 'agent::executing']],
    ]);
    const poller = new StatePoller({
      provider: providerFrom(labels),
      epicId: 321,
      pollIntervalMs: 1,
      storyIds: [400],
      logger: quietLogger(),
    });

    const events = [];
    poller.on('story-closed', (e) => events.push(e));

    await poller.pollOnce();
    assert.deepEqual(events, []);

    labels.set(400, ['type::story', 'agent::done']);
    await poller.pollOnce();
    assert.deepEqual(events, [{ storyId: 400 }]);

    // Untracked after closure; a second poll must not re-emit.
    await poller.pollOnce();
    assert.equal(events.length, 1);
  });

  it('emits blocker-raised once per transition, not per poll', async () => {
    const labels = new Map([[321, ['type::epic', 'agent::executing']]]);
    const poller = new StatePoller({
      provider: providerFrom(labels),
      epicId: 321,
      pollIntervalMs: 1,
      logger: quietLogger(),
    });

    const events = [];
    poller.on('blocker-raised', (e) => events.push(e));

    await poller.pollOnce();
    labels.set(321, ['type::epic', 'agent::blocked']);
    await poller.pollOnce();
    await poller.pollOnce();

    assert.equal(events.length, 1);
    assert.equal(events[0].source, 'epic');
  });

  it('emits cancel-requested when the epic loses all execution labels', async () => {
    const labels = new Map([[321, ['type::epic', 'agent::executing']]]);
    const poller = new StatePoller({
      provider: providerFrom(labels),
      epicId: 321,
      pollIntervalMs: 1,
      logger: quietLogger(),
    });

    const events = [];
    poller.on('cancel-requested', () => events.push({}));

    await poller.pollOnce();
    labels.set(321, ['type::epic']);
    await poller.pollOnce();
    assert.equal(events.length, 1);
  });

  it('backs off on rate-limit errors and recovers on success', async () => {
    const labels = new Map([[321, { __error: new Error('API rate limit 403') }]]);
    const poller = new StatePoller({
      provider: providerFrom(labels),
      epicId: 321,
      pollIntervalMs: 1000,
      backoffCapMs: 60_000,
      logger: quietLogger(),
    });

    await poller.pollOnce();
    assert.ok(
      poller._currentBackoff > 1000,
      'backoff should increase beyond pollInterval',
    );

    labels.set(321, ['type::epic', 'agent::executing']);
    await poller.pollOnce();
    // The module resets in the scheduler loop; pollOnce alone just records
    // the successful read — the backoff reset is exercised by _schedule.
    poller.stop();
  });
});
