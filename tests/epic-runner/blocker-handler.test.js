import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BlockerHandler } from '../../.agents/scripts/lib/orchestration/epic-runner/blocker-handler.js';

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function recordingProvider() {
  const updates = [];
  const comments = [];
  return {
    updates,
    comments,
    async updateTicket(id, mutations) {
      updates.push({ id, mutations });
    },
    async postComment(id, payload) {
      comments.push({ id, payload });
    },
    async getTicket() {
      return { labels: [] };
    },
  };
}

describe('BlockerHandler', () => {
  it('halts and resumes when the epic transitions back to executing', async () => {
    const provider = recordingProvider();
    const labels = ['type::epic', 'agent::executing'];

    const hook = { fireCalls: [], fire: async (p) => hook.fireCalls.push(p) };
    const handler = new BlockerHandler({
      provider,
      epicId: 321,
      notificationHook: hook,
      labelFetcher: async () => [...labels],
      pollIntervalMs: 5,
      logger: quietLogger(),
    });

    const waitPromise = handler.halt({
      reason: 'merge_conflict',
      storyId: 400,
    });
    // Let halt() mark blocked and enter the wait loop, then flip label back.
    await new Promise((r) => setTimeout(r, 20));
    labels.splice(0, labels.length, 'type::epic', 'agent::executing');

    const result = await waitPromise;
    assert.equal(result.resumed, true);

    // Marked blocked: add agent::blocked, remove agent::executing.
    const update = provider.updates[0];
    assert.ok(update.mutations.labels.add.includes('agent::blocked'));
    assert.ok(update.mutations.labels.remove.includes('agent::executing'));

    // Posted friction comment mentioning the story id.
    const comment = provider.comments[0];
    assert.equal(comment.payload.type, 'friction');
    assert.match(comment.payload.body, /Story: #400/);

    // Fired the webhook exactly once.
    assert.equal(hook.fireCalls.length, 1);
    assert.equal(hook.fireCalls[0].event, 'epic-blocked');
  });

  it('webhook failures do not bubble out of halt()', async () => {
    const provider = recordingProvider();
    const handler = new BlockerHandler({
      provider,
      epicId: 321,
      notificationHook: {
        fire: async () => {
          throw new Error('webhook-boom');
        },
      },
      labelFetcher: async () => ['type::epic', 'agent::executing'],
      pollIntervalMs: 1,
      logger: quietLogger(),
    });
    // Webhook failure must be swallowed; halt() still resumes on the first
    // poll (labelFetcher returns executing from the start).
    const result = await handler.halt({ reason: 'x' });
    assert.equal(result.resumed, true);
  });

  it('honors the abort signal while waiting', async () => {
    const provider = recordingProvider();
    const handler = new BlockerHandler({
      provider,
      epicId: 321,
      notificationHook: { fire: async () => {} },
      labelFetcher: async () => ['type::epic', 'agent::blocked'],
      pollIntervalMs: 50,
      logger: quietLogger(),
    });
    const controller = new AbortController();
    const p = handler.halt({ reason: 'stuck' }, controller.signal);
    setTimeout(() => controller.abort(), 20);
    const res = await p;
    assert.equal(res.resumed, false);
    assert.equal(res.reasonToStop, 'aborted');
  });
});
