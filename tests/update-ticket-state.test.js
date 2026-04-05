import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionTicketState,
  toggleTasklistCheckbox,
  postStructuredComment,
  cascadeCompletion,
  setProvider,
  resetProvider
} from '../.agents/scripts/update-ticket-state.js';
import { ITicketingProvider } from '../.agents/scripts/lib/ITicketingProvider.js';

class MockProvider extends ITicketingProvider {
  constructor() {
    super();
    this.updates = [];
    this.comments = [];
    this.tickets = {
      1: { id: 1, labels: ['agent::ready'], body: 'Epic body\n- [ ] #2', state: 'open' },
      2: { id: 2, labels: ['agent::executing'], body: 'Feature body\n- [ ] #3', state: 'open' },
      3: { id: 3, labels: ['agent::done'], body: 'Story body', state: 'open' }
    };
    this.deps = {
      1: { blocks: [], blockedBy: [2] },
      2: { blocks: [1], blockedBy: [3] },
      3: { blocks: [2], blockedBy: [] }
    };
    this.subTickets = {
      1: [this.tickets[2]],
      2: [this.tickets[3]],
      3: []
    }
  }

  async getTicket(id) {
    return this.tickets[id];
  }

  async updateTicket(id, mutations) {
    this.updates.push({ id, mutations });
    
    // Minimal mock update applying changes to local ticket
    if (mutations.labels) {
      const rm = mutations.labels.remove || [];
      const add = mutations.labels.add || [];
      let current = this.tickets[id].labels.filter(l => !rm.includes(l));
      current = [...new Set([...current, ...add])];
      this.tickets[id].labels = current;
    }
    
    if (mutations.body !== undefined) {
      this.tickets[id].body = mutations.body;
    }
  }

  async postComment(id, payload) {
    this.comments.push({ id, payload });
  }

  async getTicketDependencies(id) {
    return this.deps[id];
  }

  async getSubTickets(id) {
    // Return dynamically from this.tickets based on IDs to simulate state changes
    return this.subTickets[id].map(t => this.tickets[t.id]);
  }
}

test('update-ticket-state.js', async (t) => {
  let mock;

  t.beforeEach(() => {
    mock = new MockProvider();
    setProvider(mock);
  });

  t.afterEach(() => {
    resetProvider();
  });

  await t.test('transitionTicketState logic', async () => {
    await transitionTicketState(2, 'agent::review');
    assert.deepEqual(mock.updates[0].mutations.labels.add, ['agent::review']);
    assert.deepEqual(mock.updates[0].mutations.labels.remove, ['agent::ready', 'agent::executing', 'agent::done']);
    assert.ok(mock.tickets[2].labels.includes('agent::review'));
    assert.ok(!mock.tickets[2].labels.includes('agent::executing'));
  });

  await t.test('toggleTasklistCheckbox logic', async () => {
    await toggleTasklistCheckbox(1, 2, true);
    assert.strictEqual(mock.tickets[1].body, 'Epic body\n- [x] #2');

    await toggleTasklistCheckbox(1, 2, false);
    assert.strictEqual(mock.tickets[1].body, 'Epic body\n- [ ] #2');
  });

  await t.test('postStructuredComment logic', async () => {
    await postStructuredComment(1, 'progress', 'Did something');
    assert.strictEqual(mock.comments[0].payload.body, 'Did something');
    assert.strictEqual(mock.comments[0].payload.type, 'progress');
  });

  await t.test('cascadeCompletion recursively transitions parents up the tree', async () => {
    // Manually ensure child 3 is done
    mock.tickets[3].labels = ['agent::done'];
    
    // Should transition 2 to agent::done and then 1 to agent::done
    await cascadeCompletion(3);
    
    // Checks on cascade effects:
    assert.ok(mock.tickets[2].labels.includes('agent::done'), 'Feature (parent) should be marked done');
    assert.strictEqual(mock.tickets[2].body.includes('- [x] #3'), true, 'Checkbox for child in parent should be ticked');
    
    assert.ok(mock.tickets[1].labels.includes('agent::done'), 'Epic (grandparent) should be marked done');
    assert.strictEqual(mock.tickets[1].body.includes('- [x] #2'), true, 'Checkbox for feature in epic should be ticked');
  });
});
