import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { notify } from '../.agents/scripts/notify.js';

describe('notify script', () => {
  let mockProvider;
  let mockOrchestration;
  let fetchCalls;

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
      }
    };

    mockOrchestration = {
      github: {
        operatorHandle: '@test_operator'
      },
      notifications: {
        webhookUrl: 'https://webhook.example.com/action',
        mentionOperator: true
      }
    };
  });

  it('posts a notification comment with operator mention for info', async () => {
    await notify(123, { type: 'notification', message: 'Task complete.' }, { provider: mockProvider, orchestration: mockOrchestration });

    assert.equal(mockProvider.comments.length, 1);
    const comment = mockProvider.comments[0];
    assert.equal(comment.ticketId, 123);
    assert.equal(comment.data.body, '@test_operator Task complete.');
    assert.equal(comment.data.type, 'notification');

    assert.equal(fetchCalls.length, 0); // No webhook for simple info/notification
  });

  it('fires a webhook for action type', async () => {
    await notify(124, { type: 'action', message: 'Review needed.' }, { provider: mockProvider, orchestration: mockOrchestration });

    assert.equal(mockProvider.comments.length, 1);
    const comment = mockProvider.comments[0];
    assert.equal(comment.data.body, '@test_operator Review needed.');
    assert.equal(comment.data.type, 'notification', 'actions post as notification comments');

    assert.equal(fetchCalls.length, 1);
    const webhookCall = fetchCalls[0];
    assert.equal(webhookCall.url, 'https://webhook.example.com/action');
    
    const body = JSON.parse(webhookCall.options.body);
    assert.equal(body.ticketId, 124);
    assert.equal(body.event, 'HITL_ACTION_REQUIRED');
    assert.equal(body.message, 'Review needed.', 'should strip the operator mention from the webhook message if present');
  });

  it('tolerates webhook failures silently', async () => {
    mockOrchestration.notifications.webhookUrl = 'https://webhook.example.com/fail';
    
    // Should not throw
    await notify(125, { type: 'action', message: 'Review needed.' }, { provider: mockProvider, orchestration: mockOrchestration });

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(fetchCalls.length, 1);
  });

  it('skips webhook if url is not configured', async () => {
    mockOrchestration.notifications.webhookUrl = null;
    
    await notify(126, { type: 'action', message: 'Review needed.' }, { provider: mockProvider, orchestration: mockOrchestration });

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(fetchCalls.length, 0);
  });

  it('does not mention operator if mentionOperator is false for action', async () => {
    mockOrchestration.notifications.mentionOperator = false;
    
    await notify(127, { type: 'action', message: 'Review needed.' }, { provider: mockProvider, orchestration: mockOrchestration });

    assert.equal(mockProvider.comments.length, 1);
    assert.equal(mockProvider.comments[0].data.body, 'Review needed.');
  });
});
