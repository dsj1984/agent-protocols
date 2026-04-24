import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  Notifier,
  resolveWebhookUrl,
} from '../../../.agents/scripts/lib/notifications/notifier.js';

function quietLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

// Belt-and-braces: the Notifier constructor calls resolveWebhookUrl(), which
// reads process.env.NOTIFICATION_WEBHOOK_URL and .mcp.json at cwd. The dev
// environment typically has both populated, which would cause tests that
// don't stub fetchImpl to POST to the real webhook. Every Notifier
// construction in this file either (a) restricts channels to skip webhook,
// (b) overrides n.webhookUrl to a test URL and provides a mock fetchImpl,
// or (c) passes SAFE_CWD so the .mcp.json fallback misses. The env var is
// also cleared for the duration of the file.
const SAFE_CWD = '/nonexistent-notifier-test-cwd';
const ORIG_WEBHOOK_ENV = process.env.NOTIFICATION_WEBHOOK_URL;

before(() => {
  delete process.env.NOTIFICATION_WEBHOOK_URL;
});

after(() => {
  if (ORIG_WEBHOOK_ENV === undefined) {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
  } else {
    process.env.NOTIFICATION_WEBHOOK_URL = ORIG_WEBHOOK_ENV;
  }
});

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
      fetchImpl: async () => ({ ok: true }),
      cwd: SAFE_CWD,
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
      fetchImpl: async () => ({ ok: true }),
      cwd: SAFE_CWD,
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
      fetchImpl: async () => ({ ok: true }),
      cwd: SAFE_CWD,
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
    assert.deepEqual(Object.keys(body), ['text']);
    assert.match(body.text, /ticket #357/);
    assert.match(body.text, /agent::ready/);
    assert.match(body.text, /agent::executing/);
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

  // Restore via a test hook so an assertion failure can't leak the env var
  // into sibling tests. `process.env.X = undefined` casts to the string
  // "undefined", so restore via delete-or-set depending on original state.
  function restoreEnv() {
    if (ORIG === undefined) {
      delete process.env.NOTIFICATION_WEBHOOK_URL;
    } else {
      process.env.NOTIFICATION_WEBHOOK_URL = ORIG;
    }
  }

  afterEach(restoreEnv);

  it('prefers env var over mcp.json', () => {
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://env.example/hook';
    const url = resolveWebhookUrl();
    assert.equal(url, 'https://env.example/hook');
  });

  it('returns null when nothing is configured', () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    // Point resolver at a cwd without .mcp.json so the last fallback misses too.
    const url = resolveWebhookUrl({ cwd: '/nonexistent-path-for-test' });
    assert.equal(url, null);
  });
});
