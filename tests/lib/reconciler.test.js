import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileClosedTasks } from '../../.agents/scripts/lib/orchestration/reconciler.js';
import { MockProvider } from '../fixtures/mock-provider.js';

test('reconcileClosedTasks: does nothing if no tasks match', async () => {
  const provider = new MockProvider();
  let called = false;
  provider.updateTicket = () => {
    called = true;
  };

  await reconcileClosedTasks(
    [{ id: 1, status: 'agent::ready', labels: [] }],
    provider,
    false,
  );
  assert.strictEqual(called, false);
});

test('reconcileClosedTasks: updates ticket if status is agent::done but labels are missing', async () => {
  const provider = new MockProvider();
  let updatedId = null;
  let labelAdded = '';

  provider.updateTicket = async (id, payload) => {
    updatedId = id;
    labelAdded = payload.labels.add[0];
    return { id };
  };

  const tasks = [
    {
      id: 123,
      status: 'agent::done',
      labels: ['type::task'], // missing agent::done
    },
  ];

  await reconcileClosedTasks(tasks, provider, false);

  assert.strictEqual(updatedId, 123);
  assert.strictEqual(labelAdded, 'agent::done');
});
