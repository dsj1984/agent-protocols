import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRiskHighGate } from '../../../.agents/scripts/lib/orchestration/risk-gate-handler.js';

test('handleRiskHighGate: never posts a HITL comment (runtime gate retired)', async () => {
  const calls = [];
  const provider = {
    postComment: async (...args) => calls.push(args),
  };

  const dryRun = await handleRiskHighGate(
    { id: 42, title: 'risky' },
    provider,
    true,
  );
  const live = await handleRiskHighGate(
    { id: 99, title: 'risky' },
    provider,
    false,
  );

  assert.equal(calls.length, 0, 'no provider comments in either mode');
  assert.equal(dryRun, null);
  assert.equal(live, null);
});
