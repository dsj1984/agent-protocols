import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STATE_LABELS } from '../../.agents/scripts/lib/orchestration/ticketing.js';
import {
  batchTransitionTickets,
  fetchChildTasks,
  resolveStoryHierarchy,
} from '../../.agents/scripts/lib/story-lifecycle.js';

describe('story-lifecycle', () => {
  describe('resolveStoryHierarchy', () => {
    it('extracts both Epic and parent references', () => {
      const body =
        'Some story description\n\n---\nparent: #42\nEpic: #7\n\nblocked by #5';
      assert.deepEqual(resolveStoryHierarchy(body), {
        epicId: 7,
        featureId: 42,
      });
    });

    it('returns null for missing references', () => {
      assert.deepEqual(resolveStoryHierarchy('no refs here'), {
        epicId: null,
        featureId: null,
      });
    });

    it('handles undefined/null body gracefully', () => {
      assert.deepEqual(resolveStoryHierarchy(undefined), {
        epicId: null,
        featureId: null,
      });
      assert.deepEqual(resolveStoryHierarchy(null), {
        epicId: null,
        featureId: null,
      });
    });

    it('is case-insensitive for "Epic:" and "parent:"', () => {
      assert.deepEqual(resolveStoryHierarchy('EPIC: #1\nPARENT: #2'), {
        epicId: 1,
        featureId: 2,
      });
    });
  });

  describe('fetchChildTasks', () => {
    it('filters getSubTickets to type::task only', async () => {
      const provider = {
        getSubTickets: async (id) => {
          assert.equal(id, 100);
          return [
            { id: 1, labels: ['type::task'] },
            { id: 2, labels: ['type::story'] },
            { id: 3, labels: ['type::task', 'agent::done'] },
            { id: 4, labels: ['type::feature'] },
          ];
        },
      };
      const tasks = await fetchChildTasks(provider, 100);
      assert.deepEqual(
        tasks.map((t) => t.id),
        [1, 3],
      );
    });
  });

  describe('batchTransitionTickets', () => {
    function makeProvider(calls) {
      return {
        updateTicket: async (id, patch) => {
          calls.push({ id, patch });
        },
      };
    }

    it('transitions eligible tickets in parallel', async () => {
      const calls = [];
      const provider = makeProvider(calls);
      const tickets = [
        { id: 1, labels: ['type::task'] },
        { id: 2, labels: ['type::task'] },
      ];
      const result = await batchTransitionTickets(
        provider,
        tickets,
        STATE_LABELS.EXECUTING,
      );
      assert.deepEqual(result.transitioned.sort(), [1, 2]);
      assert.deepEqual(result.skipped, []);
      assert.deepEqual(result.failed, []);
      assert.equal(calls.length, 2);
    });

    it('skips tickets already at the target state', async () => {
      const calls = [];
      const provider = makeProvider(calls);
      const tickets = [
        { id: 1, labels: [STATE_LABELS.EXECUTING] },
        { id: 2, labels: ['type::task'] },
      ];
      const result = await batchTransitionTickets(
        provider,
        tickets,
        STATE_LABELS.EXECUTING,
      );
      assert.deepEqual(result.transitioned, [2]);
      assert.deepEqual(result.skipped, [1]);
    });

    it('skips done tickets when transitioning to a non-done target', async () => {
      const calls = [];
      const provider = makeProvider(calls);
      const tickets = [
        { id: 1, labels: [STATE_LABELS.DONE] },
        { id: 2, labels: ['type::task'] },
      ];
      const result = await batchTransitionTickets(
        provider,
        tickets,
        STATE_LABELS.EXECUTING,
      );
      assert.deepEqual(result.transitioned, [2]);
      assert.deepEqual(result.skipped, [1]);
    });

    it('records failures without aborting the batch', async () => {
      let count = 0;
      const provider = {
        updateTicket: async (id) => {
          count += 1;
          if (id === 2) throw new Error('api down');
        },
      };
      const tickets = [
        { id: 1, labels: ['type::task'] },
        { id: 2, labels: ['type::task'] },
        { id: 3, labels: ['type::task'] },
      ];
      const result = await batchTransitionTickets(
        provider,
        tickets,
        STATE_LABELS.EXECUTING,
        {
          onError: () => {
            /* suppress default stderr */
          },
        },
      );
      assert.deepEqual(result.transitioned.sort(), [1, 3]);
      assert.deepEqual(result.failed, [2]);
      assert.equal(count, 3);
    });

    it('invokes progress callback on transitions and skips', async () => {
      const events = [];
      const provider = { updateTicket: async () => {} };
      const tickets = [
        { id: 1, labels: ['type::task'] },
        { id: 2, labels: [STATE_LABELS.EXECUTING] },
      ];
      await batchTransitionTickets(provider, tickets, STATE_LABELS.EXECUTING, {
        progress: (phase, msg) => events.push([phase, msg]),
      });
      assert.ok(events.some(([p, m]) => p === 'TICKETS' && m.includes('#1')));
      assert.ok(events.some(([_p, m]) => m.includes('#2')));
    });
  });
});
