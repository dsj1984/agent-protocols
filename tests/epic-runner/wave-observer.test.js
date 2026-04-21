import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WaveObserver,
  waveEndMarker,
  waveStartMarker,
} from '../../.agents/scripts/lib/orchestration/epic-runner/wave-observer.js';

function fakeProvider() {
  const comments = new Map(); // ticketId → [{id, body}]
  let autoId = 1;
  return {
    comments,
    async getTicketComments(id) {
      return comments.get(id) ?? [];
    },
    async postComment(id, payload) {
      const list = comments.get(id) ?? [];
      const c = { id: autoId++, body: payload.body };
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
  };
}

describe('WaveObserver', () => {
  it('emits wave-start and wave-end with wave-indexed markers', async () => {
    const provider = fakeProvider();
    const obs = new WaveObserver({ provider, epicId: 321 });

    await obs.waveStart({
      index: 0,
      totalWaves: 2,
      stories: [{ id: 400, title: 'first' }, { id: 401 }],
    });
    await obs.waveEnd({
      index: 0,
      totalWaves: 2,
      startedAt: new Date(Date.now() - 5_000).toISOString(),
      stories: [
        { storyId: 400, status: 'done' },
        { storyId: 401, status: 'failed', detail: 'boom' },
      ],
    });

    const bodies = (provider.comments.get(321) ?? []).map((c) => c.body);
    assert.ok(
      bodies.some((b) => b.includes(waveStartMarker(0))),
      'wave-start comment present',
    );
    assert.ok(
      bodies.some((b) => b.includes(waveEndMarker(0))),
      'wave-end comment present',
    );
    const endBody = bodies.find((b) => b.includes(waveEndMarker(0)));
    assert.match(endBody, /Wave 1\/2 halted/);
    assert.match(endBody, /"durationMs"/);
  });

  it('re-running a wave boundary upserts rather than duplicating', async () => {
    const provider = fakeProvider();
    const obs = new WaveObserver({ provider, epicId: 321 });
    await obs.waveStart({ index: 0, totalWaves: 1, stories: [{ id: 400 }] });
    await obs.waveStart({ index: 0, totalWaves: 1, stories: [{ id: 400 }] });

    const starts = (provider.comments.get(321) ?? []).filter((c) =>
      c.body.includes(waveStartMarker(0)),
    );
    assert.equal(starts.length, 1);
  });

  it('different waves get distinct markers', async () => {
    const provider = fakeProvider();
    const obs = new WaveObserver({ provider, epicId: 321 });
    await obs.waveStart({ index: 0, totalWaves: 2, stories: [{ id: 1 }] });
    await obs.waveStart({ index: 1, totalWaves: 2, stories: [{ id: 2 }] });

    const comments = provider.comments.get(321) ?? [];
    assert.equal(comments.length, 2, 'two distinct wave-start comments');
    assert.notEqual(waveStartMarker(0), waveStartMarker(1));
  });
});
