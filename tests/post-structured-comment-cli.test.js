import assert from 'node:assert/strict';
import test from 'node:test';

import { runPostStructuredComment } from '../.agents/scripts/post-structured-comment.js';
import { upsertStructuredComment } from '../.agents/scripts/lib/orchestration/ticketing.js';

/**
 * In-memory provider mirroring the surface `upsertStructuredComment` uses:
 * postComment, getTicketComments, deleteComment.
 */
function makeProvider() {
  const comments = [];
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

test('runPostStructuredComment: returns the same envelope the MCP tool emitted', async () => {
  const provider = makeProvider();
  const envelope = await runPostStructuredComment({
    ticketId: 42,
    type: 'progress',
    body: 'halfway done',
    provider,
  });
  assert.deepEqual(envelope, { success: true, ticketId: 42, type: 'progress' });
});

test('runPostStructuredComment: CLI delegates to the same SDK function (state parity)', async () => {
  const cliProvider = makeProvider();
  const sdkProvider = makeProvider();

  await runPostStructuredComment({
    ticketId: 7,
    type: 'friction',
    body: 'blocker foo',
    provider: cliProvider,
  });

  // Direct SDK invocation — should produce the same comment shape.
  await upsertStructuredComment(sdkProvider, 7, 'friction', 'blocker foo');

  // Strip volatile ids before comparison.
  const strip = (cs) => cs.map(({ ticketId, type, body }) => ({ ticketId, type, body }));
  assert.deepEqual(strip(cliProvider.comments), strip(sdkProvider.comments));
});

test('runPostStructuredComment: re-upsert replaces the prior comment (idempotent)', async () => {
  const provider = makeProvider();
  await runPostStructuredComment({
    ticketId: 1,
    type: 'progress',
    body: 'first',
    provider,
  });
  await runPostStructuredComment({
    ticketId: 1,
    type: 'progress',
    body: 'second',
    provider,
  });
  assert.equal(provider.comments.length, 1);
  assert.match(provider.comments[0].body, /second/);
});

test('runPostStructuredComment: rejects unknown structured comment types', async () => {
  const provider = makeProvider();
  await assert.rejects(
    runPostStructuredComment({
      ticketId: 1,
      type: 'not-a-real-type',
      body: 'x',
      provider,
    }),
    /Invalid structured-comment type/,
  );
});
