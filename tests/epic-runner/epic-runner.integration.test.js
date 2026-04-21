import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runEpic } from '../../.agents/scripts/lib/orchestration/epic-runner.js';
import { EPIC_RUN_STATE_TYPE } from '../../.agents/scripts/lib/orchestration/epic-runner/checkpointer.js';
import { structuredCommentMarker } from '../../.agents/scripts/lib/orchestration/ticketing.js';

/**
 * Fake provider — minimal surface needed by the runner under test:
 *   - getTicket, getSubTickets
 *   - getTicketComments, postComment, deleteComment (for upsert)
 *   - updateTicket (label flips + sub-issue close)
 */
function buildFakeProvider({ epicId, stories }) {
  let autoId = 1;
  const tickets = new Map();
  const comments = new Map();

  tickets.set(epicId, {
    id: epicId,
    labels: ['type::epic', 'agent::executing'],
  });
  for (const s of stories) {
    tickets.set(s.id, {
      id: s.id,
      labels: ['type::story'],
      dependencies: s.dependencies ?? [],
    });
  }

  return {
    _tickets: tickets,
    _comments: comments,
    async getTicket(id) {
      const t = tickets.get(id);
      if (!t) throw new Error(`no ticket ${id}`);
      return { ...t, labels: [...t.labels] };
    },
    async getSubTickets(parent) {
      if (parent !== epicId) return [];
      return stories.map((s) => ({
        id: s.id,
        number: s.id,
        labels: tickets.get(s.id).labels,
        dependencies: s.dependencies ?? [],
      }));
    },
    async getTicketDependencies() {
      return { blocks: [], blockedBy: [] };
    },
    async getTicketComments(id) {
      return (comments.get(id) ?? []).map((c) => ({ ...c }));
    },
    async postComment(id, payload) {
      const list = comments.get(id) ?? [];
      const c = { id: autoId++, body: payload.body, type: payload.type };
      list.push(c);
      comments.set(id, list);
      return c;
    },
    async deleteComment(commentId) {
      for (const list of comments.values()) {
        const i = list.findIndex((c) => c.id === commentId);
        if (i !== -1) list.splice(i, 1);
      }
    },
    async updateTicket(id, mutations) {
      const t = tickets.get(id);
      if (!t) return;
      if (mutations.labels) {
        const add = mutations.labels.add ?? [];
        const remove = mutations.labels.remove ?? [];
        t.labels = [
          ...new Set([...t.labels.filter((l) => !remove.includes(l)), ...add]),
        ];
      }
    },
  };
}

function quietLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe('EpicRunner integration', () => {
  it('drives a two-wave epic to completion via happy-path spawns', async () => {
    const epicId = 321;
    const stories = [
      { id: 400, dependencies: [] },
      { id: 401, dependencies: [] },
      { id: 402, dependencies: [400] }, // wave 2
    ];
    const provider = buildFakeProvider({ epicId, stories });

    const spawned = [];
    const spawn = async ({ storyId }) => {
      spawned.push(storyId);
      // mark story done so cascade-like flows see it (not used here but
      // mirrors real behavior)
      const t = provider._tickets.get(storyId);
      t.labels = ['type::story', 'agent::done'];
      return { status: 'done' };
    };

    const config = {
      epicRunner: {
        enabled: true,
        concurrencyCap: 2,
        pollIntervalSec: 1,
        storyRetryCount: 0,
        blockerTimeoutHours: 0,
        notificationWebhookUrl: null,
      },
    };

    const result = await runEpic({
      epicId,
      provider,
      config,
      spawn,
      logger: quietLogger(),
    });

    assert.equal(result.state, 'completed');
    assert.equal(result.waveHistory.length, 2);
    assert.deepEqual(
      result.waveHistory.map((w) => w.status),
      ['completed', 'completed'],
    );
    assert.deepEqual([...spawned].sort(), [400, 401, 402]);

    // Final label: agent::review.
    const epic = provider._tickets.get(epicId);
    assert.ok(epic.labels.includes('agent::review'));
    assert.ok(!epic.labels.includes('agent::executing'));

    // Exactly one checkpoint comment survives.
    const marker = structuredCommentMarker(EPIC_RUN_STATE_TYPE);
    const epicComments = provider._comments.get(epicId) ?? [];
    const checkpoints = epicComments.filter((c) => c.body.includes(marker));
    assert.equal(checkpoints.length, 1);
  });

  it('halts on a failed story and flips the epic to agent::blocked', async () => {
    const epicId = 321;
    const stories = [
      { id: 400, dependencies: [] },
      { id: 401, dependencies: [] },
    ];
    const provider = buildFakeProvider({ epicId, stories });

    const spawn = async ({ storyId }) => {
      if (storyId === 401) return { status: 'failed', detail: 'compile error' };
      return { status: 'done' };
    };

    const config = {
      epicRunner: {
        enabled: true,
        concurrencyCap: 2,
        pollIntervalSec: 1,
        storyRetryCount: 0,
        blockerTimeoutHours: 0,
        notificationWebhookUrl: null,
      },
    };

    // Pre-arm the epic to resume immediately by flipping it back to
    // executing before halt enters the wait loop; we simulate the operator
    // intervention by patching the provider's getTicket to return executing
    // on every poll.
    const origGetTicket = provider.getTicket.bind(provider);
    provider.getTicket = async (id) => {
      const t = await origGetTicket(id);
      if (id === epicId) {
        // Operator flipped back — resume.
        t.labels = t.labels.filter((l) => l !== 'agent::blocked');
        if (!t.labels.includes('agent::executing'))
          t.labels.push('agent::executing');
      }
      return t;
    };

    const result = await runEpic({
      epicId,
      provider,
      config,
      spawn,
      logger: quietLogger(),
    });

    // After resume, no more waves remain, so final state is 'completed'.
    assert.equal(result.state, 'completed');
    const halted = result.waveHistory.find((w) => w.status === 'halted');
    assert.ok(halted, 'one wave should record a halt');
  });
});
