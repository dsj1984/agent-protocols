import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runEpic } from '../../.agents/scripts/lib/orchestration/epic-runner.js';
import { structuredCommentMarker } from '../../.agents/scripts/lib/orchestration/ticketing.js';
import { buildCtx } from './_build-ctx.js';

/**
 * Wiring test for SpawnSmokeTest → runEpicWithContext.
 *
 * Verifies: when the pre-wave smoke-test fails, the runner halts before any
 * wave is dispatched, flips the Epic to `agent::blocked`, and posts a
 * structured friction comment.
 */

function buildFakeProvider({ epicId, stories }) {
  let autoId = 1;
  const tickets = new Map();
  const comments = new Map();
  const updates = [];

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
    _updates: updates,
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
    async updateTicket(id, patch) {
      updates.push({ id, patch });
      const t = tickets.get(id);
      if (!t) return;
      if (patch.labels) {
        const set = new Set(t.labels);
        for (const r of patch.labels.remove ?? []) set.delete(r);
        for (const a of patch.labels.add ?? []) set.add(a);
        t.labels = [...set];
      }
    },
  };
}

describe('pre-wave spawn smoke-test wiring', () => {
  it('halts the runner and posts a friction comment when the smoke-test fails', async () => {
    const epicId = 9001;
    const stories = [{ id: 9101 }, { id: 9102 }];
    const provider = buildFakeProvider({ epicId, stories });

    let storySpawned = 0;
    const spawn = async () => {
      storySpawned += 1;
      return { status: 'done' };
    };

    const smokeTest = {
      verify: async () => ({
        ok: false,
        detail: 'claude --version exited 127',
        exitCode: 127,
      }),
    };

    const result = await runEpic({
      ctx: buildCtx({
        epicId,
        provider,
        spawn,
        config: {
          epicRunner: {
            enabled: true,
            concurrencyCap: 2,
            pollIntervalSec: 1,
            storyRetryCount: 0,
            blockerTimeoutHours: 0,
          },
        },
      }),
      smokeTest,
    });

    assert.equal(result.state, 'halted');
    assert.equal(result.aborted, 'spawn-smoke-test');
    assert.equal(storySpawned, 0, 'no stories should be spawned');
    assert.equal(result.waveHistory.length, 0);

    const epicLabels = (await provider.getTicket(epicId)).labels;
    assert.ok(
      epicLabels.includes('agent::blocked'),
      `expected agent::blocked, got: ${epicLabels.join(', ')}`,
    );
    assert.ok(!epicLabels.includes('agent::executing'));

    const epicComments = provider._comments.get(epicId) ?? [];
    const marker = structuredCommentMarker('friction');
    const friction = epicComments.find((c) => c.body?.includes(marker));
    assert.ok(friction, 'friction comment should be posted');
    assert.match(friction.body, /spawn smoke-test failed/);
    assert.match(friction.body, /exited 127/);
  });

  it('proceeds normally when the smoke-test passes', async () => {
    const epicId = 9002;
    const stories = [{ id: 9201 }];
    const provider = buildFakeProvider({ epicId, stories });

    let storySpawned = 0;
    const spawn = async () => {
      storySpawned += 1;
      return { status: 'done' };
    };

    const smokeTest = {
      verify: async () => ({
        ok: true,
        detail: 'claude --version exited 0',
        exitCode: 0,
      }),
    };

    const result = await runEpic({
      ctx: buildCtx({
        epicId,
        provider,
        spawn,
        config: {
          epicRunner: {
            enabled: true,
            concurrencyCap: 1,
            pollIntervalSec: 1,
            storyRetryCount: 0,
            blockerTimeoutHours: 0,
          },
        },
      }),
      smokeTest,
    });

    assert.notEqual(result.state, 'halted');
    assert.equal(storySpawned, 1);
  });
});
