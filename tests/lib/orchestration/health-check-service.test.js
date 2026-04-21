import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSprintHealthIssue } from '../../../.agents/scripts/lib/orchestration/health-check-service.js';

test('ensureSprintHealthIssue: no-op in dry-run', async () => {
  let created = false;
  const provider = {
    createTicket: async () => {
      created = true;
      return { id: 0 };
    },
  };
  await ensureSprintHealthIssue(1, { title: 't' }, [], provider, true);
  assert.equal(created, false);
});

test('ensureSprintHealthIssue: no-op when health issue already present', async () => {
  let created = false;
  const provider = {
    createTicket: async () => {
      created = true;
      return { id: 0 };
    },
  };
  const allTickets = [
    { title: '📉 Sprint Health: Something', labels: ['type::health'] },
  ];
  await ensureSprintHealthIssue(1, { title: 't' }, allTickets, provider, false);
  assert.equal(created, false);
});

test('ensureSprintHealthIssue: creates when absent', async () => {
  const calls = [];
  const provider = {
    createTicket: async (...args) => {
      calls.push(args);
      return { id: 500 };
    },
  };
  await ensureSprintHealthIssue(42, { title: 'Demo' }, [], provider, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 42);
  assert.match(calls[0][1].title, /Sprint Health: Demo/);
  assert.deepEqual(calls[0][1].labels, ['type::health']);
});

test('ensureSprintHealthIssue: swallows provider.createTicket failure', async () => {
  const provider = {
    createTicket: async () => {
      throw new Error('api down');
    },
  };
  await assert.doesNotReject(() =>
    ensureSprintHealthIssue(1, { title: 't' }, [], provider, false),
  );
});
