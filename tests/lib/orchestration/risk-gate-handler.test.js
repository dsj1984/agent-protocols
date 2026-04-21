import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRiskHighGate } from '../../../.agents/scripts/lib/orchestration/risk-gate-handler.js';

test('handleRiskHighGate: dry-run skips provider.postComment', async () => {
  const calls = [];
  const provider = {
    postComment: async (...args) => calls.push(args),
  };
  const result = await handleRiskHighGate(
    { id: 42, title: 'risky' },
    provider,
    true,
  );
  assert.equal(calls.length, 0);
  assert.equal(result.taskId, 42);
  assert.match(result.reason, /risk::high/);
});

test('handleRiskHighGate: live mode posts approval comment mentioning task id', async () => {
  const calls = [];
  const provider = {
    postComment: async (id, opts) => calls.push({ id, opts }),
  };
  const result = await handleRiskHighGate(
    { id: 99, title: 'risky' },
    provider,
    false,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 99);
  assert.match(calls[0].opts.body, /\/approve 99/);
  assert.equal(result.taskId, 99);
});
