import assert from 'node:assert/strict';
import test from 'node:test';
import { ITicketingProvider } from '../../.agents/scripts/lib/ITicketingProvider.js';
import {
  cascadeCompletion,
  postStructuredComment,
  toggleTasklistCheckbox,
  transitionTicketState,
} from '../../.agents/scripts/lib/orchestration/ticketing.js';

class MockProvider extends ITicketingProvider {
  constructor() {
    super();
    this.updates = [];
    this.comments = [];
    this.tickets = {
      1: {
        id: 1,
        labels: ['agent::ready'],
        body: 'Epic body\n- [ ] #2',
        state: 'open',
      },
      2: {
        id: 2,
        labels: ['agent::executing'],
        body: 'Feature body\n- [ ] #3',
        state: 'open',
      },
      3: { id: 3, labels: ['agent::done'], body: 'Story body', state: 'open' },
    };
    this.deps = {
      1: { blocks: [], blockedBy: [2] },
      2: { blocks: [1], blockedBy: [3] },
      3: { blocks: [2], blockedBy: [] },
    };
    this.subTickets = {
      1: [this.tickets[2]],
      2: [this.tickets[3]],
      3: [],
    };
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
      let current = this.tickets[id].labels.filter((l) => !rm.includes(l));
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
    return this.subTickets[id].map((t) => this.tickets[t.id]);
  }
}

test('ticketing.js', async (t) => {
  let mock;

  t.beforeEach(() => {
    mock = new MockProvider();
  });

  await t.test('transitionTicketState logic', async () => {
    await transitionTicketState(mock, 2, 'agent::review');
    assert.deepEqual(mock.updates[0].mutations.labels.add, ['agent::review']);
    assert.deepEqual(mock.updates[0].mutations.labels.remove, [
      'agent::ready',
      'agent::executing',
      'agent::done',
    ]);
    // Non-done states should reopen the issue
    assert.strictEqual(mock.updates[0].mutations.state, 'open');
    assert.strictEqual(mock.updates[0].mutations.state_reason, null);
    assert.ok(mock.tickets[2].labels.includes('agent::review'));
    assert.ok(!mock.tickets[2].labels.includes('agent::executing'));
  });

  await t.test(
    'transitionTicketState closes issue when transitioning to agent::done',
    async () => {
      await transitionTicketState(mock, 2, 'agent::done');
      const mutation = mock.updates[0].mutations;
      assert.deepEqual(mutation.labels.add, ['agent::done']);
      assert.strictEqual(
        mutation.state,
        'closed',
        'Issue should be closed on agent::done',
      );
      assert.strictEqual(
        mutation.state_reason,
        'completed',
        'state_reason should be "completed"',
      );
    },
  );

  await t.test(
    'transitionTicketState fires notifier.emit with state-transition payload',
    async () => {
      // Seed ticket #2 with type label and Epic reference so the notifier
      // payload captures `type`, `fromState`, and `epicId` correctly.
      mock.tickets[2] = {
        ...mock.tickets[2],
        labels: ['agent::executing', 'type::story'],
        body: 'Feature body\n\nEpic: #1\n- [ ] #3',
        title: 'Wire Notifier',
        html_url: 'https://example.test/issues/2',
      };

      const emitted = [];
      const fakeNotifier = {
        emit(event) {
          emitted.push(event);
          return Promise.resolve({ fired: true });
        },
      };

      await transitionTicketState(mock, 2, 'agent::review', {
        notifier: fakeNotifier,
      });

      assert.equal(emitted.length, 1);
      const event = emitted[0];
      assert.equal(event.kind, 'state-transition');
      assert.equal(event.fromState, 'agent::executing');
      assert.equal(event.toState, 'agent::review');
      assert.deepEqual(event.ticket, {
        id: 2,
        title: 'Wire Notifier',
        type: 'story',
        url: 'https://example.test/issues/2',
        epicId: 1,
      });
    },
  );

  await t.test(
    'transitionTicketState without a notifier does not emit',
    async () => {
      // Guard against a regression where an unconditional call on an undefined
      // notifier would throw.
      await transitionTicketState(mock, 2, 'agent::review');
      // No throw, no emit side-effects — the absence of an emit spy here is
      // the assertion by construction.
      assert.ok(mock.tickets[2].labels.includes('agent::review'));
    },
  );

  await t.test(
    'cascadeCompletion forwards notifier to recursive transitions',
    async () => {
      mock.tickets[3].labels = ['agent::done'];
      const kinds = [];
      const fakeNotifier = {
        emit(event) {
          kinds.push(`${event.ticket.id}:${event.toState}`);
          return Promise.resolve({ fired: true });
        },
      };

      await cascadeCompletion(mock, 3, { notifier: fakeNotifier });

      // #2 and #1 should both have been transitioned to agent::done via
      // cascade, each producing one notifier event.
      assert.ok(kinds.includes('2:agent::done'));
      assert.ok(kinds.includes('1:agent::done'));
    },
  );

  await t.test('toggleTasklistCheckbox logic', async () => {
    await toggleTasklistCheckbox(mock, 1, 2, true);
    assert.strictEqual(mock.tickets[1].body, 'Epic body\n- [x] #2');

    await toggleTasklistCheckbox(mock, 1, 2, false);
    assert.strictEqual(mock.tickets[1].body, 'Epic body\n- [ ] #2');
  });

  await t.test('postStructuredComment logic', async () => {
    await postStructuredComment(mock, 1, 'progress', 'Did something');
    assert.strictEqual(mock.comments[0].payload.body, 'Did something');
    assert.strictEqual(mock.comments[0].payload.type, 'progress');
  });

  await t.test(
    'cascadeCompletion isolates per-parent failures and returns them',
    async () => {
      // Child 3 is done; feature 2 has two parents where one fails.
      mock.tickets[3].labels = ['agent::done'];
      // `blocks` in this mock = upward parent list (ticket 3's parents).
      mock.deps[3] = { blocks: [2, 99], blockedBy: [] };
      mock.tickets[99] = {
        id: 99,
        labels: ['agent::executing'],
        body: '',
        state: 'open',
      };
      mock.subTickets[99] = [mock.tickets[3]];
      mock.deps[99] = { blocks: [], blockedBy: [] };

      const origGetSub = mock.getSubTickets.bind(mock);
      mock.getSubTickets = async (id) => {
        if (id === 99) throw new Error('boom');
        return origGetSub(id);
      };

      const result = await cascadeCompletion(mock, 3);

      assert.ok(
        result.cascadedTo.length > 0,
        'successful parents should still cascade',
      );
      assert.equal(
        result.failed.length,
        1,
        'failing parent must be captured, not swallowed',
      );
      assert.equal(result.failed[0].parentId, 99);
      assert.match(result.failed[0].error, /boom/);
    },
  );

  await t.test(
    'cascadeCompletion recursively transitions parents up the tree',
    async () => {
      // Manually ensure child 3 is done
      mock.tickets[3].labels = ['agent::done'];

      // Should transition 2 to agent::done and then 1 to agent::done
      await cascadeCompletion(mock, 3);

      // Checks on cascade effects:
      assert.ok(
        mock.tickets[2].labels.includes('agent::done'),
        'Feature (parent) should be marked done',
      );
      assert.strictEqual(
        mock.tickets[2].body.includes('- [x] #3'),
        true,
        'Checkbox for child in parent should be ticked',
      );

      assert.ok(
        mock.tickets[1].labels.includes('agent::done'),
        'Epic (grandparent) should be marked done',
      );
      assert.strictEqual(
        mock.tickets[1].body.includes('- [x] #2'),
        true,
        'Checkbox for feature in epic should be ticked',
      );
    },
  );
});
