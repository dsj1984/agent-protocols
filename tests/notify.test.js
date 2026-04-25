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

  it('medium with mentionOperator=true posts mentioned comment + fires [medium] webhook', async () => {
    await notify(
      123,
      { severity: 'medium', message: 'Story merged.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    const comment = mockProvider.comments[0];
    assert.equal(comment.ticketId, 123);
    assert.equal(comment.data.body, '@test_operator Story merged.');
    assert.equal(comment.data.type, 'notification');

    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.deepEqual(Object.keys(body), ['text']);
    assert.equal(body.text, '[medium] widgets#123: Story merged.');
  });

  it('high always @mentions and fires [Action Required] webhook', async () => {
    mockOrchestration.notifications.mentionOperator = false;

    await notify(
      124,
      { severity: 'high', message: '🚨 Action Required: Approve deploy?' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(
      mockProvider.comments[0].data.body,
      '@test_operator 🚨 Action Required: Approve deploy?',
    );
    assert.equal(mockProvider.comments[0].data.type, 'friction');

    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(
      body.text,
      '[Action Required] widgets#124: 🚨 Action Required: Approve deploy?',
    );
  });

  it('low is filtered out of BOTH comment and webhook at default minLevel', async () => {
    // Default minLevel is `medium`. commentMinLevel falls back to minLevel,
    // so a `low` notify suppresses both the comment and the webhook.
    await notify(
      200,
      { severity: 'low', message: 'Step 3 done.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 0, 'low filtered from comments');
    assert.equal(fetchCalls.length, 0, 'low filtered at default minLevel');
  });

  it('low posts a progress comment when commentMinLevel=low', async () => {
    mockOrchestration.notifications.commentMinLevel = 'low';

    await notify(
      200,
      { severity: 'low', message: 'Step 3 done.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(mockProvider.comments[0].data.type, 'progress');
    assert.equal(mockProvider.comments[0].data.body, 'Step 3 done.');
    // Webhook still gated by minLevel (default medium).
    assert.equal(fetchCalls.length, 0);
  });

  it('commentMinLevel=high suppresses medium comment but webhook fires at minLevel=medium', async () => {
    mockOrchestration.notifications.commentMinLevel = 'high';
    mockOrchestration.notifications.minLevel = 'medium';

    await notify(
      201,
      { severity: 'medium', message: 'Story merged.' },
      defaultOpts,
    );

    assert.equal(
      mockProvider.comments.length,
      0,
      'medium below commentMinLevel=high',
    );
    assert.equal(
      fetchCalls.length,
      1,
      'webhook still fires at minLevel=medium',
    );
  });

  it('skipComment opt suppresses comment but webhook still fires when minLevel allows', async () => {
    mockOrchestration.notifications.minLevel = 'low';
    mockOrchestration.notifications.commentMinLevel = 'low';

    await notify(
      210,
      { severity: 'low', message: 'task #N → executing' },
      { ...defaultOpts, skipComment: true },
    );

    assert.equal(mockProvider.comments.length, 0);
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.text, '[low] widgets#210: task #N → executing');
  });

  it('low fires when minLevel is explicitly set to low', async () => {
    mockOrchestration.notifications.minLevel = 'low';

    await notify(
      200,
      { severity: 'low', message: 'Step 3 done.' },
      defaultOpts,
    );

    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.text, '[low] widgets#200: Step 3 done.');
  });

  it('minLevel=high suppresses medium and fires high', async () => {
    mockOrchestration.notifications.minLevel = 'high';

    await notify(
      201,
      { severity: 'medium', message: 'Story merged.' },
      defaultOpts,
    );
    assert.equal(fetchCalls.length, 0);

    await notify(
      201,
      { severity: 'high', message: '🚨 Action Required: Review.' },
      defaultOpts,
    );
    assert.equal(fetchCalls.length, 1);
  });

  it('rejects an invalid severity', async () => {
    await assert.rejects(
      () => notify(1, { severity: 'urgent', message: 'x' }, defaultOpts),
      /Invalid severity/,
    );
  });

  it('tolerates webhook failures silently', async () => {
    await notify(
      125,
      { severity: 'high', message: 'Review needed.' },
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
      { severity: 'high', message: 'Review needed.' },
      {
        provider: mockProvider,
        orchestration: mockOrchestration,
        webhookUrl: null,
      },
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(fetchCalls.length, 0);
  });

  it('skips GitHub comment if ticketId is 0 or missing', async () => {
    await notify(
      0,
      { severity: 'medium', message: 'Sidecar message' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 0);
  });

  it('does not @mention on medium when mentionOperator is false', async () => {
    mockOrchestration.notifications.mentionOperator = false;

    await notify(
      127,
      { severity: 'medium', message: 'Story merged.' },
      defaultOpts,
    );

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(mockProvider.comments[0].data.body, 'Story merged.');
  });

  it('includes X-Signature-256 header when WEBHOOK_SECRET is provided', async () => {
    const originalSecret = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 'shhh-secret';

    try {
      await notify(
        128,
        { severity: 'high', message: 'Secret action' },
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

  it('defaults severity to medium when omitted', async () => {
    await notify(129, { message: 'Default sev.' }, defaultOpts);

    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.text, '[medium] widgets#129: Default sev.');
  });
});

describe('parseNotifyArgs', () => {
  it('parses explicit --ticket flag with default severity', () => {
    const parsed = parseNotifyArgs(['--ticket', '321', 'Epic closed.']);
    assert.deepEqual(parsed, {
      ticketId: 321,
      message: 'Epic closed.',
      severity: 'medium',
    });
  });

  it('parses --severity high', () => {
    const parsed = parseNotifyArgs([
      '--ticket',
      '321',
      'Approve deploy.',
      '--severity',
      'high',
    ]);
    assert.deepEqual(parsed, {
      ticketId: 321,
      message: 'Approve deploy.',
      severity: 'high',
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
      severity: 'medium',
    });
  });
});
