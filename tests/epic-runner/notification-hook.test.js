import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NotificationHook } from '../../.agents/scripts/lib/orchestration/epic-runner/notification-hook.js';

function quietLogger() {
  return { warn: () => {}, error: () => {} };
}

describe('NotificationHook', () => {
  it('no-ops when no webhookUrl is configured', async () => {
    const hook = new NotificationHook({
      webhookUrl: null,
      logger: quietLogger(),
    });
    const res = await hook.fire({ text: 'x' });
    assert.deepEqual(res, { delivered: false, reason: 'no-url' });
  });

  it('posts {text} JSON with optional HMAC signature', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    const hook = new NotificationHook({
      webhookUrl: 'https://example.test/hook',
      secret: 'shh',
      fetchImpl,
      logger: quietLogger(),
    });
    const res = await hook.fire({ text: 'wave 1 complete' });
    assert.equal(res.delivered, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { text: 'wave 1 complete' });
    assert.ok(calls[0].init.headers['x-webhook-signature']);
  });

  it('swallows fetch errors and never throws', async () => {
    const hook = new NotificationHook({
      webhookUrl: 'https://example.test/hook',
      fetchImpl: async () => {
        throw new Error('network down');
      },
      logger: quietLogger(),
    });
    const res = await hook.fire({ text: 'blocked' });
    assert.equal(res.delivered, false);
    assert.equal(res.reason, 'error');
  });

  it('reports non-2xx status as undelivered without throwing', async () => {
    const hook = new NotificationHook({
      webhookUrl: 'https://example.test/hook',
      fetchImpl: async () => ({ ok: false, status: 503 }),
      logger: quietLogger(),
    });
    const res = await hook.fire({ text: 'x' });
    assert.equal(res.delivered, false);
    assert.equal(res.reason, 'status-503');
  });
});
