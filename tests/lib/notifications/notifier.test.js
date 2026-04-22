import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Notifier,
  resolveWebhookUrl,
} from '../../../.agents/scripts/lib/notifications/notifier.js';

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

describe('Notifier level gating', () => {
  it('off: emits nothing', async () => {
    const calls = { fetch: 0, comment: 0 };
    const n = new Notifier({
      config: { level: 'off' },
      provider: {
        postComment: async () => {
          calls.comment++;
        },
      },
      fetchImpl: async () => {
        calls.fetch++;
        return { ok: true };
      },
      logger: quietLogger(),
    });
    // Force a webhook URL so we can confirm the OFF gate suppresses all channels.
    n.webhookUrl = 'https://example.test/hook';
    const r = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::done',
    });
    assert.equal(r.fired, false);
    assert.equal(r.reason, 'filtered');
    assert.equal(calls.fetch, 0);
    assert.equal(calls.comment, 0);
  });

  it('minimal: fires only on done/review transitions', async () => {
    const n = new Notifier({
      config: { level: 'minimal' },
      logger: quietLogger(),
    });
    const r1 = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::executing',
    });
    const r2 = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::review',
    });
    const r3 = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::done',
    });
    assert.equal(r1.fired, false);
    assert.equal(r2.fired, true);
    assert.equal(r3.fired, true);
  });

  it('default: fires on state transitions only', async () => {
    const n = new Notifier({
      config: { level: 'default' },
      logger: quietLogger(),
    });
    const r1 = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::executing',
    });
    const r2 = await n.emit({ kind: 'opened', ticket: { id: 1 } });
    assert.equal(r1.fired, true);
    assert.equal(r2.fired, false);
  });

  it('verbose: fires on everything', async () => {
    const n = new Notifier({
      config: { level: 'verbose' },
      logger: quietLogger(),
    });
    for (const kind of ['state-transition', 'opened', 'closed', 'reopened']) {
      const r = await n.emit({
        kind,
        ticket: { id: 1 },
        toState: 'agent::executing',
      });
      assert.equal(r.fired, true, `${kind} should fire at verbose`);
    }
  });
});

describe('Notifier channels', () => {
  it('posts to Epic via provider when configured', async () => {
    const comments = [];
    const n = new Notifier({
      config: {
        level: 'verbose',
        postToEpic: true,
        channels: ['epic-comment'],
      },
      provider: {
        postComment: async (id, payload) => comments.push({ id, payload }),
      },
      logger: quietLogger(),
    });
    await n.emit({
      kind: 'state-transition',
      ticket: { id: 357, type: 'story', epicId: 349 },
      toState: 'agent::executing',
    });
    assert.equal(comments.length, 1);
    assert.equal(comments[0].id, 349);
    assert.match(comments[0].payload.body, /story #357/);
    assert.match(comments[0].payload.body, /agent::executing/);
  });

  it('falls back to ticket id when no epicId provided', async () => {
    const comments = [];
    const n = new Notifier({
      config: {
        level: 'verbose',
        postToEpic: true,
        channels: ['epic-comment'],
      },
      provider: {
        postComment: async (id, payload) => comments.push({ id, payload }),
      },
      logger: quietLogger(),
    });
    await n.emit({
      kind: 'state-transition',
      ticket: { id: 349, type: 'epic' },
      toState: 'agent::executing',
    });
    assert.equal(comments[0].id, 349);
  });

  it('fires webhook with JSON payload', async () => {
    const calls = [];
    const n = new Notifier({
      config: { level: 'verbose', channels: ['webhook'] },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200 };
      },
      logger: quietLogger(),
    });
    n.webhookUrl = 'https://example.test/hook';
    await n.emit({
      kind: 'state-transition',
      ticket: { id: 357 },
      fromState: 'agent::ready',
      toState: 'agent::executing',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.kind, 'state-transition');
    assert.equal(body.fromState, 'agent::ready');
    assert.equal(body.toState, 'agent::executing');
  });

  it('swallows webhook failures (never throws)', async () => {
    const n = new Notifier({
      config: { level: 'verbose', channels: ['webhook'] },
      fetchImpl: async () => {
        throw new Error('network down');
      },
      logger: quietLogger(),
    });
    n.webhookUrl = 'https://example.test/hook';
    const r = await n.emit({
      kind: 'state-transition',
      ticket: { id: 1 },
      toState: 'agent::done',
    });
    assert.equal(r.fired, true);
    assert.equal(r.results.webhook.delivered, false);
  });

  it('skips epic-comment channel when disabled via config', async () => {
    const comments = [];
    const n = new Notifier({
      config: {
        level: 'verbose',
        postToEpic: false,
        channels: ['epic-comment'],
      },
      provider: {
        postComment: async (id, payload) => comments.push({ id, payload }),
      },
      logger: quietLogger(),
    });
    await n.emit({
      kind: 'state-transition',
      ticket: { id: 1, epicId: 349 },
      toState: 'agent::done',
    });
    assert.equal(comments.length, 0);
  });
});

describe('resolveWebhookUrl priority', () => {
  const ORIG = process.env.NOTIFICATION_WEBHOOK_URL;

  it('prefers env var over config and mcp.json', () => {
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://env.example/hook';
    const url = resolveWebhookUrl({ webhookUrl: 'https://cfg.example/hook' });
    assert.equal(url, 'https://env.example/hook');
    process.env.NOTIFICATION_WEBHOOK_URL = ORIG;
  });

  it('falls back to config webhookUrl when env unset', () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    const url = resolveWebhookUrl({ webhookUrl: 'https://cfg.example/hook' });
    assert.equal(url, 'https://cfg.example/hook');
    process.env.NOTIFICATION_WEBHOOK_URL = ORIG;
  });

  it('returns null when nothing is configured', () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    // Point resolver at a cwd without .mcp.json so the last fallback misses too.
    const url = resolveWebhookUrl({}, { cwd: '/nonexistent-path-for-test' });
    assert.equal(url, null);
    process.env.NOTIFICATION_WEBHOOK_URL = ORIG;
  });
});
