/**
 * Story #5112 — `createIssue` must not file a duplicate for a lost response.
 *
 * The failure this pins is invisible to the client: the server commits the
 * create and the connection dies before the response arrives, so the error
 * looks identical to one raised before the create. `withTransientRetry` then
 * re-POSTs and the tracker gains a twin Story. The fix consults the caller's
 * content-keyed lookup before every retry POST.
 *
 * Everything is faked — `gh.api` is a stub, and the lookup is a closure over
 * an in-memory "server". Nothing touches live GitHub.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TicketGateway } from '../tickets.js';

/** Shape `gh.api` returns for a REST call: `{ stdout }` carrying JSON. */
function apiResult(payload) {
  return { stdout: JSON.stringify(payload) };
}

function econnreset() {
  const err = new Error('read ECONNRESET');
  err.code = 'ECONNRESET';
  return err;
}

const ISSUE = {
  number: 4242,
  id: 990001,
  node_id: 'I_kwDO4242',
  html_url: 'https://github.com/o/r/issues/4242',
};

/**
 * Build a gateway over a fake `gh` whose POST records the create on a fake
 * server, then throws — modelling the response that never came back.
 *
 * @param {{ failFirstPost?: boolean }} [opts]
 */
function makeGateway({ failFirstPost = true } = {}) {
  const posts = [];
  const server = { issues: [] };
  const gh = {
    async api({ method, endpoint, body }) {
      if (method === 'POST' && endpoint === '/repos/o/r/issues') {
        posts.push(body);
        // The server commits the create either way — that is the whole point.
        server.issues.push({ ...ISSUE, body: body.body });
        if (failFirstPost && posts.length === 1) throw econnreset();
        return apiResult(ISSUE);
      }
      throw new Error(`unexpected api call: ${method} ${endpoint}`);
    },
  };
  const gateway = new TicketGateway({ gh, owner: 'o', repo: 'r' });
  return { gateway, posts, server };
}

/** The caller's lookup: exactly what `/plan` persist's resume path does. */
function findByMarker(server, marker) {
  return async () =>
    server.issues.find((issue) => issue.body.includes(marker)) ?? null;
}

const MARKER = '<!-- plan-story: deadbeefdeadbeef -->';
const BODY = `## Goal\nSomething\n\n${MARKER}`;

describe('TicketGateway.createIssue — lost-response idempotency (Story #5112)', () => {
  it('files exactly one issue and adopts it when attempt 1 loses its response', async () => {
    const { gateway, posts, server } = makeGateway();

    const result = await gateway.createIssue({
      title: 'A Story',
      body: BODY,
      labels: ['type::story'],
      findExisting: findByMarker(server, MARKER),
    });

    assert.equal(posts.length, 1, 'exactly one POST reached the server');
    assert.equal(server.issues.length, 1, 'exactly one issue exists');
    assert.equal(result.adopted, true);
    assert.equal(result.id, 4242, 'the adopted issue number is returned');
    assert.equal(result.number, 4242);
    assert.equal(result.internalId, 990001);
    assert.equal(result.nodeId, 'I_kwDO4242');
    assert.equal(result.url, ISSUE.html_url);
  });

  it('re-POSTs when the lookup proves attempt 1 never landed', async () => {
    const { gateway, posts } = makeGateway();

    const result = await gateway.createIssue({
      title: 'A Story',
      body: BODY,
      // The create genuinely failed: the probe finds nothing.
      findExisting: async () => null,
    });

    assert.equal(posts.length, 2, 'the retry POST is still allowed to fire');
    assert.equal(result.adopted, false);
    assert.equal(result.id, 4242);
  });

  it('keeps the pre-#5112 retry-only behaviour when no lookup is supplied', async () => {
    const { gateway, posts } = makeGateway();

    const result = await gateway.createIssue({ title: 'A Story', body: BODY });

    assert.equal(posts.length, 2);
    assert.equal(result.adopted, false);
  });

  it('does not consult the lookup on a first attempt that succeeds', async () => {
    const { gateway, posts, server } = makeGateway({ failFirstPost: false });
    let probes = 0;

    const result = await gateway.createIssue({
      title: 'A Story',
      body: BODY,
      findExisting: async () => {
        probes += 1;
        return findByMarker(server, MARKER)();
      },
    });

    assert.equal(posts.length, 1);
    assert.equal(probes, 0, 'no probe on the happy path');
    assert.equal(result.adopted, false);
    assert.equal(result.id, 4242);
  });

  it('surfaces a non-transient failure without probing or retrying', async () => {
    const posts = [];
    const gh = {
      async api() {
        posts.push(1);
        const err = new Error('Validation Failed');
        err.status = 422;
        throw err;
      },
    };
    const gateway = new TicketGateway({ gh, owner: 'o', repo: 'r' });

    await assert.rejects(
      gateway.createIssue({
        title: 'A Story',
        body: BODY,
        findExisting: async () => ISSUE,
      }),
      /Validation Failed/,
    );
    assert.equal(posts.length, 1);
  });
});

describe('TicketGateway.updateTicket — additive assignees (Story #5112)', () => {
  it('uses the additive assignees endpoint and issues no replacing PATCH', async () => {
    const calls = [];
    const gh = {
      async api(args) {
        calls.push(args);
        return apiResult({});
      },
    };
    const gateway = new TicketGateway({ gh, owner: 'o', repo: 'r' });

    await gateway.updateTicket(7, { addAssignees: ['alice'] });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].endpoint, '/repos/o/r/issues/7/assignees');
    assert.deepEqual(calls[0].body, { assignees: ['alice'] });
  });

  it('is a no-op for an empty additive list', async () => {
    const calls = [];
    const gh = {
      async api(args) {
        calls.push(args);
        return apiResult({});
      },
    };
    const gateway = new TicketGateway({ gh, owner: 'o', repo: 'r' });

    await gateway.updateTicket(7, { addAssignees: [] });
    assert.equal(calls.length, 0);
  });

  it('still replaces the assignee list for the steal/release path', async () => {
    const calls = [];
    const gh = {
      async api(args) {
        calls.push(args);
        return apiResult({});
      },
    };
    const gateway = new TicketGateway({ gh, owner: 'o', repo: 'r' });

    await gateway.updateTicket(7, { assignees: ['bob'] });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(calls[0].body, { assignees: ['bob'] });
  });
});
