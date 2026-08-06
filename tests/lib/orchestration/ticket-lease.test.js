import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acquireLease,
  currentOwner,
  normalizeOperatorHandle,
  releaseLease,
} from '../../../.agents/scripts/lib/orchestration/ticket-lease.js';

// ---------------------------------------------------------------------------
// Fake ticketing provider — records the assignees writes so unit tests can
// assert the side effect without a real GitHub round-trip (testing-standards
// § Unit: mock all I/O).
// ---------------------------------------------------------------------------

/**
 * @param {string[]} initialAssignees
 */
function makeProvider(initialAssignees = []) {
  const state = { assignees: [...initialAssignees] };
  const updateCalls = [];
  return {
    state,
    updateCalls,
    async getTicket(_id) {
      return { id: _id, assignees: [...state.assignees] };
    },
    async updateTicket(id, mutations) {
      updateCalls.push({ id, mutations });
      if (Array.isArray(mutations?.assignees)) {
        state.assignees = [...mutations.assignees];
      }
    },
  };
}

// Fixed clock. Story #5006 deleted the lease's TTL/heartbeat surface, so the
// only remaining use is building the retired-options fixture below (and the
// #4620 race block, kept verbatim as the regression it pins).
const NOW = 1_000_000_000_000;

describe('ticket-lease — normalizeOperatorHandle', () => {
  it('strips a single leading @ and trims whitespace', () => {
    assert.equal(normalizeOperatorHandle('@alice'), 'alice');
    assert.equal(normalizeOperatorHandle('  @bob '), 'bob');
    assert.equal(normalizeOperatorHandle('carol'), 'carol');
  });

  it('returns null for empty / whitespace / non-string input', () => {
    assert.equal(normalizeOperatorHandle(''), null);
    assert.equal(normalizeOperatorHandle('   '), null);
    assert.equal(normalizeOperatorHandle('@'), null);
    assert.equal(normalizeOperatorHandle(undefined), null);
    assert.equal(normalizeOperatorHandle(null), null);
    assert.equal(normalizeOperatorHandle(42), null);
  });
});

describe('ticket-lease — currentOwner', () => {
  it('returns the first assignee or null for an empty/absent list', () => {
    assert.equal(currentOwner(['bob', 'carol']), 'bob');
    assert.equal(currentOwner([]), null);
    assert.equal(currentOwner(undefined), null);
    assert.equal(currentOwner(null), null);
  });
});

describe('ticket-lease — acquireLease', () => {
  // AC1: assigns an unassigned ticket to the operator and returns acquired:true
  it('claims an unassigned ticket and writes the operator to assignees', async () => {
    const provider = makeProvider([]);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.acquired, true);
    assert.equal(result.owner, 'alice');
    assert.equal(result.previousOwner, null);
    assert.equal(result.reason, 'unclaimed');
    // assert the assignees write happened
    assert.equal(provider.updateCalls.length, 1);
    assert.deepEqual(provider.updateCalls[0].mutations, {
      assignees: ['alice'],
    });
    assert.deepEqual(provider.state.assignees, ['alice']);
  });

  it('re-affirms a self-held claim without re-writing assignees', async () => {
    const provider = makeProvider(['alice']);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.acquired, true);
    assert.equal(result.reason, 'already-held');
    assert.equal(provider.updateCalls.length, 0);
  });

  // AC2: returns acquired:false with the foreign owner for any foreign claim
  it('refuses a foreign claim and reports the foreign owner', async () => {
    const provider = makeProvider(['bob']);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.acquired, false);
    assert.equal(result.owner, 'bob');
    assert.equal(result.reason, 'held');
    assert.equal(provider.updateCalls.length, 0);
    assert.deepEqual(provider.state.assignees, ['bob']);
  });

  // Story #5006 — there is no longer a staleness escape hatch. A foreign
  // claim refuses on its own, with no clock, heartbeat or TTL consulted: the
  // ONLY way past it is `--steal`. A caller that still passes the retired
  // options must not get the old reclaim behaviour back by accident.
  it('refuses a foreign claim even when retired TTL/heartbeat options are supplied', async () => {
    const provider = makeProvider(['bob']);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      heartbeatAt: NOW - 10 * 60 * 60 * 1000,
      ttlMs: 5000,
      now: NOW,
      config: { delivery: { lease: { ttlMs: 1 } } },
    });

    assert.equal(result.acquired, false);
    assert.equal(result.reason, 'held');
    assert.equal(provider.updateCalls.length, 0);
    assert.deepEqual(provider.state.assignees, ['bob']);
  });

  // AC4: steal:true transfers ownership from a foreign claim
  it('steals a foreign claim when steal:true is set', async () => {
    const provider = makeProvider(['bob']);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      steal: true,
    });

    assert.equal(result.acquired, true);
    assert.equal(result.owner, 'alice');
    assert.equal(result.previousOwner, 'bob');
    assert.equal(result.reason, 'stolen');
    assert.deepEqual(provider.state.assignees, ['alice']);
  });

  // Story #3513 — `steal:true` only changes the outcome for a foreign claim
  // (it forces the transfer that would otherwise be refused). For every
  // non-foreign starting state it is inert: the same path runs as without
  // the flag, and `reason` is NOT `stolen`.
  it('with steal:true on an unassigned ticket, claims it as unclaimed (not stolen)', async () => {
    const provider = makeProvider([]);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      steal: true,
    });

    assert.equal(result.acquired, true);
    assert.equal(result.owner, 'alice');
    assert.equal(result.previousOwner, null);
    assert.equal(result.reason, 'unclaimed');
    assert.deepEqual(provider.state.assignees, ['alice']);
  });

  it('with steal:true on a self-held claim, re-affirms without re-writing (already-held)', async () => {
    const provider = makeProvider(['alice']);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      steal: true,
    });

    assert.equal(result.acquired, true);
    assert.equal(result.reason, 'already-held');
    // steal must not force a redundant assignee write on a self-held claim
    assert.equal(provider.updateCalls.length, 0);
    assert.deepEqual(provider.state.assignees, ['alice']);
  });

  it('rejects a missing provider', async () => {
    await assert.rejects(
      acquireLease({ ticketId: 1, operator: 'alice' }),
      /provider with getTicket/,
    );
  });

  it('rejects a non-positive ticketId', async () => {
    await assert.rejects(
      acquireLease({
        provider: makeProvider(),
        ticketId: 0,
        operator: 'alice',
      }),
      /ticketId must be a positive integer/,
    );
  });

  it('rejects an empty operator', async () => {
    await assert.rejects(
      acquireLease({ provider: makeProvider(), ticketId: 1, operator: '' }),
      /operator must be a non-empty string/,
    );
  });
});

describe('ticket-lease — acquireLease verify-after-write (lost-race, Story #4620)', () => {
  /**
   * Simulate a simultaneous claim: the ticket reads unassigned before our
   * write, but the post-write verify re-read shows a foreign login that raced
   * in. `reads` is a queue consumed one entry per getTicket call.
   *
   * @param {string[][]} reads  Assignee lists returned by successive getTicket calls.
   */
  function racingProvider(reads) {
    const state = { assignees: [...(reads[0] ?? [])] };
    const updateCalls = [];
    let call = 0;
    return {
      state,
      updateCalls,
      async getTicket() {
        const at = Math.min(call, reads.length - 1);
        call += 1;
        return { assignees: [...reads[at]] };
      },
      async updateTicket(id, mutations) {
        updateCalls.push({ id, mutations });
        if (Array.isArray(mutations?.assignees)) {
          state.assignees = [...mutations.assignees];
        }
      },
    };
  }

  it('confirms the claim when the verify re-read shows only the operator', async () => {
    // read #1 (pre-write): unassigned; read #2 (verify): our own write stuck.
    const provider = racingProvider([[], ['alice']]);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      ttlMs: 5000,
      now: NOW,
    });

    assert.equal(result.acquired, true);
    assert.equal(result.reason, 'unclaimed');
    // one claiming write only — the happy path does not back anything out.
    assert.equal(provider.updateCalls.length, 1);
  });

  it('detects a lost race and backs the operator out when a foreign co-assignee appears', async () => {
    // read #1 (pre-write): unassigned → we PATCH ['alice'];
    // read #2 (verify): ['bob','alice'] — bob raced in and we lost.
    const provider = racingProvider([[], ['bob', 'alice']]);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      ttlMs: 5000,
      now: NOW,
    });

    assert.equal(result.acquired, false);
    assert.equal(result.reason, 'lost-race');
    assert.equal(result.owner, 'bob');
    // Two writes: the claiming PATCH, then the back-off that removes us so the
    // winner is the sole assignee.
    assert.equal(provider.updateCalls.length, 2);
    assert.deepEqual(provider.updateCalls[1].mutations, { assignees: ['bob'] });
  });

  it('reports lost-race when the verify re-read shows the operator fully replaced', async () => {
    // read #2 (verify): ['bob'] only — bob's write clobbered ours entirely.
    const provider = racingProvider([[], ['bob']]);

    const result = await acquireLease({
      provider,
      ticketId: 42,
      operator: 'alice',
      ttlMs: 5000,
      now: NOW,
    });

    assert.equal(result.acquired, false);
    assert.equal(result.reason, 'lost-race');
    assert.equal(result.owner, 'bob');
  });
});

describe('ticket-lease — releaseLease', () => {
  // AC5: clears the assignment when the operator still holds it
  it('clears the assignment when the operator still holds the lease', async () => {
    const provider = makeProvider(['alice']);

    const result = await releaseLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.released, true);
    assert.equal(result.owner, null);
    assert.equal(result.reason, 'released');
    assert.deepEqual(provider.updateCalls[0].mutations, { assignees: [] });
    assert.deepEqual(provider.state.assignees, []);
  });

  // AC5: no-op when the ticket was reassigned away from the operator
  it('is a no-op when the ticket was reassigned to someone else', async () => {
    const provider = makeProvider(['bob']);

    const result = await releaseLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.released, false);
    assert.equal(result.owner, 'bob');
    assert.equal(result.reason, 'not-held');
    assert.equal(provider.updateCalls.length, 0);
    // bob's claim survives the stale release
    assert.deepEqual(provider.state.assignees, ['bob']);
  });

  it('is a no-op on an already-unassigned ticket', async () => {
    const provider = makeProvider([]);

    const result = await releaseLease({
      provider,
      ticketId: 42,
      operator: 'alice',
    });

    assert.equal(result.released, false);
    assert.equal(result.reason, 'not-held');
    assert.equal(provider.updateCalls.length, 0);
  });
});
