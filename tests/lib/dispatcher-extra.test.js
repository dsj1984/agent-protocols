import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEpicCompletion } from '../../.agents/scripts/lib/orchestration/dispatch-engine.js';
import { MockProvider } from '../fixtures/mock-provider.js';

test('detectEpicCompletion: does nothing if tasks are missing', async () => {
  const provider = new MockProvider();
  let called = false;
  provider.postComment = () => {
    called = true;
  };

  await detectEpicCompletion({
    epicId: 1,
    tasks: [],
    manifest: { summary: {} },
    provider,
    settings: {},
    dryRun: false,
  });
  assert.strictEqual(called, false);
});

test('detectEpicCompletion: posts comment if all tasks are done', async () => {
  const provider = new MockProvider();
  let commentBody = '';
  provider.postComment = async (_id, payload) => {
    commentBody = payload.body;
    return { commentId: 'c1' };
  };

  await detectEpicCompletion({
    epicId: 100,
    tasks: [{ id: 1, status: 'agent::done', title: 'T1' }],
    manifest: { summary: { progressPercent: 100 }, generatedAt: 'now' },
    provider,
    settings: { notificationWebhookUrl: 'http://mock' },
    dryRun: false,
  });

  assert.ok(commentBody.includes('Epic #100 Complete'));
  assert.ok(commentBody.includes('✅ #1: T1'));
});
