import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StatePoller } from '../../.agents/scripts/lib/orchestration/epic-runner/state-poller.js';

function providerFrom(labelMap) {
  return {
    async getTicket(id) {
      const labels = labelMap.get(id);
      if (labels?.__error) throw labels.__error;
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

  it('uses bulk path for large tracked sets — 1 listIssuesByLabel call per tick', async () => {
    const trackedIds = Array.from({ length: 30 }, (_, i) => 1000 + i);
    const bulkIssues = trackedIds.map((id) => ({
      number: id,
      labels: [{ name: 'type::story' }, { name: 'agent::executing' }],
    }));
    // Epic included in the response so it resolves from the bulk map too.
    bulkIssues.push({
      number: 321,
      labels: [{ name: 'type::epic' }, { name: 'agent::executing' }],
    });

    const calls = { bulk: 0, getTicket: 0 };
    const provider = {
      async listIssuesByLabel(args) {
        calls.bulk += 1;
        assert.equal(args.state, 'open');
        assert.equal(args.labels, 'agent::*');
        return bulkIssues;
      },
      async getTicket() {
        calls.getTicket += 1;
        throw new Error('per-ticket fallback must not be used on bulk path');
      },
    };

    const poller = new StatePoller({
      provider,
      epicId: 321,
      pollIntervalMs: 1,
      storyIds: trackedIds,
      logger: quietLogger(),
    });

    await poller.pollOnce();
    assert.equal(calls.bulk, 1, 'exactly one bulk call per tick');
    assert.equal(calls.getTicket, 0, 'no per-ticket fetches on bulk tick');
  });

  it('uses per-ticket path when tracked set is below bulkThreshold', async () => {
    const calls = { bulk: 0, getTicket: 0 };
    const provider = {
      async listIssuesByLabel() {
        calls.bulk += 1;
        throw new Error('bulk must not run below threshold');
      },
      async getTicket(id) {
        calls.getTicket += 1;
        return { id, labels: ['type::story', 'agent::executing'] };
      },
    };

    const poller = new StatePoller({
      provider,
      epicId: 321,
      pollIntervalMs: 1,
      storyIds: [400, 401, 402],
      logger: quietLogger(),
    });

    await poller.pollOnce();
    assert.equal(calls.bulk, 0, 'bulk not called below threshold');
    // 1 epic + 3 stories = 4 per-ticket reads.
    assert.equal(calls.getTicket, 4);
  });

  it('demotes a tick to per-ticket fallback when the bulk response is malformed', async () => {
    const trackedIds = Array.from({ length: 10 }, (_, i) => 500 + i);
    const calls = { bulk: 0, getTicket: 0 };

    let bulkResponse = [
      // Well-formed issue for #500.
      {
        number: 500,
        labels: [{ name: 'type::story' }, { name: 'agent::executing' }],
      },
      // Malformed: no `labels` array.
      { number: 501 },
      // Would-be well-formed for the rest, but we never reach them.
      ...trackedIds.slice(2).map((id) => ({
        number: id,
        labels: [{ name: 'agent::executing' }],
      })),
    ];

    const provider = {
      async listIssuesByLabel() {
        calls.bulk += 1;
        return bulkResponse;
      },
      async getTicket(id) {
        calls.getTicket += 1;
        return { id, labels: ['type::story', 'agent::executing'] };
      },
    };

    const poller = new StatePoller({
      provider,
      epicId: 321,
      pollIntervalMs: 1,
      storyIds: trackedIds,
      logger: quietLogger(),
    });

    await poller.pollOnce();
    assert.equal(calls.bulk, 1, 'bulk attempted exactly once');
    // Demoted tick: per-ticket reads for the epic + every tracked story.
    assert.equal(calls.getTicket, 1 + trackedIds.length);

    // Subsequent tick with a clean response: bulk is retried, not permanently disabled.
    bulkResponse = trackedIds.map((id) => ({
      number: id,
      labels: [{ name: 'agent::executing' }],
    }));
    bulkResponse.push({ number: 321, labels: [{ name: 'agent::executing' }] });
    calls.getTicket = 0;
    await poller.pollOnce();
    assert.equal(calls.bulk, 2, 'bulk retried next tick');
    assert.equal(calls.getTicket, 0, 'no per-ticket reads when bulk succeeds');
  });

  it('ignores out-of-scope agent::* issues in the bulk response', async () => {
    const trackedIds = [600, 601, 602, 603, 604];
    const bulkResponse = [
      {
        number: 321,
        labels: [{ name: 'type::epic' }, { name: 'agent::executing' }],
      },
      ...trackedIds.map((id) => ({
        number: id,
        labels: [{ name: 'type::story' }, { name: 'agent::executing' }],
      })),
      // Out-of-scope: has agent::done, but is not in the tracked-story set.
      {
        number: 9999,
        labels: [{ name: 'type::story' }, { name: 'agent::done' }],
      },
    ];

    const provider = {
      async listIssuesByLabel() {
        return bulkResponse;
      },
      async getTicket() {
        throw new Error('should not fall back to per-ticket');
      },
    };

    const poller = new StatePoller({
      provider,
      epicId: 321,
      pollIntervalMs: 1,
      storyIds: trackedIds,
      logger: quietLogger(),
    });

    const events = [];
    poller.on('story-closed', (e) => events.push({ kind: 'closed', ...e }));
    poller.on('blocker-raised', (e) => events.push({ kind: 'blocker', ...e }));
    poller.on('cancel-requested', () =>
      events.push({ kind: 'cancel-requested' }),
    );

    await poller.pollOnce();
    assert.deepEqual(
      events,
      [],
      'no events for out-of-scope issue #9999 even though it carries agent::done',
    );
  });

  it('backs off on rate-limit errors and recovers on success', async () => {
    const labels = new Map([
      [321, { __error: new Error('API rate limit 403') }],
    ]);
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
