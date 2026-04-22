import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createFrictionEmitter } from '../.agents/scripts/lib/orchestration/friction-emitter.js';

/**
 * In-memory provider: captures every upsert body and lets tests drive delete+post.
 * Mirrors the surface `upsertStructuredComment` consumes: `postComment`,
 * `getTicketComments`, `deleteComment`.
 */
function makeProvider() {
  const comments = []; // { id, ticketId, body }
  let nextId = 1;
  return {
    comments,
    async postComment(ticketId, { type, body }) {
      const id = nextId++;
      comments.push({ id, ticketId, type, body });
      return { commentId: id };
    },
    async getTicketComments(ticketId) {
      return comments.filter((c) => c.ticketId === ticketId);
    },
    async deleteComment(id) {
      const idx = comments.findIndex((c) => c.id === id);
      if (idx >= 0) comments.splice(idx, 1);
    },
  };
}

describe('friction-emitter', () => {
  let clock;
  let now;
  beforeEach(() => {
    clock = 1_000_000;
    now = () => clock;
  });

  it('emits on first call for a (ticketId, markerKey) pair', async () => {
    const provider = makeProvider();
    const em = createFrictionEmitter({ provider, now });
    const result = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'reap failed: EACCES',
    });
    assert.equal(result.emitted, true);
    assert.equal(provider.comments.length, 1);
    assert.match(provider.comments[0].body, /reap failed: EACCES/);
  });

  it('suppresses a second emission for the same key within the cooldown window', async () => {
    const provider = makeProvider();
    const em = createFrictionEmitter({ provider, now, cooldownMs: 60_000 });
    await em.emit({ ticketId: 101, markerKey: 'reap-failure', body: 'first' });
    clock += 59_999; // still inside cooldown
    const second = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'second',
    });
    assert.equal(second.emitted, false);
    assert.equal(second.reason, 'cooldown');
    // Comment count unchanged — no upsert fired on the suppressed call.
    assert.equal(provider.comments.length, 1);
  });

  it('re-emits exactly at the cooldown boundary', async () => {
    const provider = makeProvider();
    const em = createFrictionEmitter({ provider, now, cooldownMs: 60_000 });
    await em.emit({ ticketId: 101, markerKey: 'reap-failure', body: 'first' });
    clock += 60_000; // boundary — not strictly less than cooldownMs
    const second = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'second',
    });
    assert.equal(second.emitted, true);
    // Upsert replaces the prior friction comment via marker match.
    assert.equal(provider.comments.length, 1);
    assert.match(provider.comments[0].body, /second/);
  });

  it('isolates cooldown per (ticketId, markerKey) — different keys do not share state', async () => {
    const provider = makeProvider();
    const em = createFrictionEmitter({ provider, now, cooldownMs: 60_000 });
    const a = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'a',
    });
    const b = await em.emit({
      ticketId: 101,
      markerKey: 'poller-fetch-failure',
      body: 'b',
    });
    const c = await em.emit({
      ticketId: 202,
      markerKey: 'reap-failure',
      body: 'c',
    });
    // Each distinct (ticketId, markerKey) pair should bypass the cooldown
    // window, since the helper keys the LRU on both values.
    assert.equal(a.emitted, true);
    assert.equal(b.emitted, true);
    assert.equal(c.emitted, true);
  });

  it('does not record state when the underlying post throws', async () => {
    const provider = makeProvider();
    provider.postComment = async () => {
      throw new Error('network down');
    };
    const em = createFrictionEmitter({
      provider,
      now,
      logger: { warn: () => {}, debug: () => {} },
    });
    const first = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'x',
    });
    assert.equal(first.emitted, false);
    assert.equal(first.reason, 'post-failed');
    // The failed post must not poison the cooldown window — a retry is expected.
    clock += 1_000;
    provider.postComment = async () => ({ commentId: 7 });
    const second = await em.emit({
      ticketId: 101,
      markerKey: 'reap-failure',
      body: 'x',
    });
    assert.equal(second.emitted, true);
  });

  it('validates required arguments', async () => {
    const em = createFrictionEmitter({ provider: makeProvider() });
    await assert.rejects(
      () => em.emit({ ticketId: null, markerKey: 'k', body: 'b' }),
      /positive integer ticketId/,
    );
    await assert.rejects(
      () => em.emit({ ticketId: 1, markerKey: '', body: 'b' }),
      /non-empty markerKey/,
    );
    await assert.rejects(
      () => em.emit({ ticketId: 1, markerKey: 'k', body: '' }),
      /non-empty body/,
    );
  });

  it('evicts the oldest entry when the LRU cap is exceeded', async () => {
    const provider = makeProvider();
    const em = createFrictionEmitter({
      provider,
      now,
      cooldownMs: 60_000,
      lruCap: 2,
    });
    await em.emit({ ticketId: 1, markerKey: 'k', body: '1' });
    clock += 1;
    await em.emit({ ticketId: 2, markerKey: 'k', body: '2' });
    clock += 1;
    await em.emit({ ticketId: 3, markerKey: 'k', body: '3' });
    // ticket 1 is the oldest; the cap=2 eviction drops its record.
    // Re-emitting ticket 1 within the cooldown window now succeeds because
    // the LRU no longer has a timestamp to compare against.
    clock += 1;
    const revisit = await em.emit({ ticketId: 1, markerKey: 'k', body: '1b' });
    assert.equal(revisit.emitted, true);
    // Ticket 3 was the most recent survivor and is still inside cooldown →
    // the expected suppression confirms the non-evicted record is live.
    const suppressed = await em.emit({
      ticketId: 3,
      markerKey: 'k',
      body: '3b',
    });
    assert.equal(suppressed.emitted, false);
    assert.equal(suppressed.reason, 'cooldown');
  });
});
