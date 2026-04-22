import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { notify, parseNotifyArgs } from '../.agents/scripts/notify.js';

const DEFAULT_WEBHOOK = 'https://webhook.example.com/action';

describe('notify script', () => {
  let mockProvider;
  let mockOrchestration;
  let fetchCalls;
  let defaultOpts;

  beforeEach(() => {
    fetchCalls = [];

    // Mock the global fetch
    global.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes('fail')) {
        throw new Error('Network error');
      }
      return { ok: true };
    };

    mockProvider = {
      comments: [],
      async postComment(ticketId, data) {
        this.comments.push({ ticketId, data });
      },
    };

    mockOrchestration = {
      github: {
        owner: 'acme',
        repo: 'widgets',
        operatorHandle: '@test_operator',
      },
      notifications: {
        mentionOperator: true,
      },
    };

    defaultOpts = {
      provider: mockProvider,
      orchestration: mockOrchestration,
      webhookUrl: DEFAULT_WEBHOOK,
    };
  });

  it('posts a notification comment with operator mention and fires webhook for info', async () => {
    await notify(
      123,
      { type: 'notification', message: 'Task complete.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    const comment = mockProvider.comments[0];
    assert.equal(comment.ticketId, 123);
    assert.equal(comment.data.body, '@test_operator Task complete.');
    assert.equal(comment.data.type, 'notification');

    // Webhook now fires for every notify() call by default (minLevel=progress).
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.repo, 'widgets');
    assert.equal(body.ticketId, 123);
    assert.equal(body.type, 'notification');
    assert.equal(body.event, 'notification');
    assert.equal(body.actionRequired, false);
  });

  it('fires a webhook for action type with HITL event name', async () => {
    await notify(
      124,
      { type: 'action', message: 'Review needed.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    const comment = mockProvider.comments[0];
    assert.equal(comment.data.body, '@test_operator Review needed.');
    assert.equal(
      comment.data.type,
      'notification',
      'actions post as notification comments',
    );

    assert.equal(fetchCalls.length, 1);
    const webhookCall = fetchCalls[0];
    assert.equal(webhookCall.url, 'https://webhook.example.com/action');

    const body = JSON.parse(webhookCall.options.body);
    assert.equal(body.repo, 'widgets');
    assert.equal(body.ticketId, 124);
    assert.equal(body.type, 'action');
    assert.equal(body.event, 'HITL_ACTION_REQUIRED');
    assert.equal(body.actionRequired, true);
    assert.equal(
      body.message,
      'Review needed.',
      'should strip the operator mention from the webhook message if present',
    );
  });

  it('suppresses webhook when type is below webhookMinLevel', async () => {
    mockOrchestration.notifications.webhookMinLevel = 'action';

    await notify(
      200,
      { type: 'progress', message: 'Step 3 done.' },
      defaultOpts,
    );
    await notify(
      200,
      { type: 'notification', message: 'Story merged.' },
      defaultOpts,
    );
    assert.equal(fetchCalls.length, 0, 'lower-level events filtered out');

    await notify(200, { type: 'action', message: 'Approve?' }, defaultOpts);
    assert.equal(fetchCalls.length, 1, 'action events still fire');
  });

  it('honors actionRequired flag regardless of type when filtering', async () => {
    mockOrchestration.notifications.webhookMinLevel = 'action';

    await notify(
      201,
      {
        type: 'notification',
        message: 'Approve deploy?',
        actionRequired: true,
      },
      defaultOpts,
    );

    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.actionRequired, true);
    assert.equal(body.event, 'HITL_ACTION_REQUIRED');
  });

  it('tolerates webhook failures silently', async () => {
    // Should not throw
    await notify(
      125,
      { type: 'action', message: 'Review needed.' },
      {
        ...defaultOpts,
        webhookUrl: 'https://webhook.example.com/fail',
      },
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(fetchCalls.length, 1);
  });

  it('skips webhook if url is not configured', async () => {
    await notify(
      126,
      { type: 'action', message: 'Review needed.' },
      {
        provider: mockProvider,
        orchestration: mockOrchestration,
        webhookUrl: null,
      },
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(fetchCalls.length, 0);
  });

  it('does not mention operator if mentionOperator is false for action', async () => {
    mockOrchestration.notifications.mentionOperator = false;

    await notify(
      127,
      { type: 'action', message: 'Review needed.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(mockProvider.comments[0].data.body, 'Review needed.');
  });

  it('skips GitHub comment if ticketId is 0 or missing', async () => {
    await notify(
      0,
      { type: 'notification', message: 'Sidecar message' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 0);
  });

  it('includes X-Signature-256 header when WEBHOOK_SECRET is provided', async () => {
    const originalSecret = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 'shhh-secret';

    try {
      await notify(
        128,
        { type: 'action', message: 'Secret action' },
        defaultOpts,
      );

      assert.equal(fetchCalls.length, 1);
      const headers = fetchCalls[0].options.headers;
      assert.ok(headers['X-Signature-256']);
      assert.ok(headers['X-Signature-256'].startsWith('sha256='));
    } finally {
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  it('parses explicit --ticket flag for CLI callers', () => {
    const parsed = parseNotifyArgs([
      '--ticket',
      '321',
      'Epic closed.',
      '--action',
    ]);
    assert.deepEqual(parsed, {
      ticketId: 321,
      message: 'Epic closed.',
      isAction: true,
    });
  });

  it('parses legacy numeric ticket id followed by multi-word message', () => {
    const parsed = parseNotifyArgs([
      '321',
      'Planning complete.',
      'Review now.',
    ]);
    assert.deepEqual(parsed, {
      ticketId: 321,
      message: 'Planning complete. Review now.',
      isAction: false,
    });
  });
});
