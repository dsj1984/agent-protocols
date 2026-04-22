import assert from 'node:assert';
import { test } from 'node:test';
import { validateBlockers } from '../../../.agents/scripts/lib/story-init/blocker-validator.js';

function makeProvider(tickets) {
  return {
    async getTicket(id) {
      const rec = tickets[id];
      if (rec instanceof Error) throw rec;
      if (!rec) throw new Error(`missing #${id}`);
      return rec;
    },
  };
}

test('returns empty list when body has no blocked-by references', async () => {
  const provider = makeProvider({});
  const out = await validateBlockers({
    provider,
    input: { body: 'no refs here' },
  });
  assert.deepStrictEqual(out.openBlockers, []);
});

test('treats done-labelled dependency as resolved', async () => {
  const provider = makeProvider({
    55: { id: 55, title: 'Dep', labels: ['agent::done'], state: 'open' },
  });
  const out = await validateBlockers({
    provider,
    input: { body: 'blocked by #55' },
  });
  assert.deepStrictEqual(out.openBlockers, []);
});

test('treats closed dependency as resolved', async () => {
  const provider = makeProvider({
    55: { id: 55, title: 'Dep', labels: ['type::task'], state: 'closed' },
  });
  const out = await validateBlockers({
    provider,
    input: { body: 'blocked by #55' },
  });
  assert.deepStrictEqual(out.openBlockers, []);
});

test('flags open dependency with its current agent:: state', async () => {
  const provider = makeProvider({
    55: {
      id: 55,
      title: 'Dep',
      labels: ['type::task', 'agent::executing'],
      state: 'open',
    },
  });
  const out = await validateBlockers({
    provider,
    input: { body: 'blocked by #55' },
  });
  assert.strictEqual(out.openBlockers.length, 1);
  assert.strictEqual(out.openBlockers[0].state, 'agent::executing');
});

test('treats provider fetch failure as a blocking fetchError entry', async () => {
  const provider = makeProvider({ 77: new Error('network down') });
  const out = await validateBlockers({
    provider,
    input: { body: 'blocked by #77' },
  });
  assert.strictEqual(out.openBlockers.length, 1);
  assert.strictEqual(out.openBlockers[0].fetchError, true);
});
