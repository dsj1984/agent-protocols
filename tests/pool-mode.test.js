/**
 * pool-mode.test.js — Claim-protocol concurrency tests for #698.
 *
 * Covers the AC-5 / AC-6 scenarios from PRD #669:
 *   (a) N=2 sessions launched simultaneously claim 2 distinct stories,
 *       100% of 50 runs.
 *   (b) Pre-claimed story is skipped on subsequent launch.
 *   (c) `findEligibleStory` returns no-eligible with a visible reason when
 *       the wave is fully claimed/done.
 *   (d) Race-loser releases its label within one iteration.
 *   (e) Pool mode respects the dependency guard.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  claimLabelForSession,
  claimStory,
  findClaimLabels,
  findEligibleStory,
  releaseStory,
} from '../.agents/scripts/lib/pool-mode.js';

const READY = 'agent::ready';
const DONE = 'agent::done';

// ---------------------------------------------------------------------------
// Provider mock — concurrency-safe enough for the simulated races below.
// Mutations are awaited as microtasks so two `claimStory` promises started in
// the same tick interleave their writes deterministically (label add A, label
// add B, comment A, comment B, read-back A sees both labels, etc.).
// ---------------------------------------------------------------------------

function makeProvider({ tickets } = {}) {
  const issueLabels = new Map();
  const comments = new Map();
  let commentSeq = 1;

  for (const t of tickets ?? []) {
    issueLabels.set(t.id, [...(t.labels ?? [])]);
    comments.set(t.id, []);
  }

  return {
    _labels: issueLabels,
    _comments: comments,
    async getTicket(id) {
      return { id, labels: [...(issueLabels.get(id) ?? [])] };
    },
    async updateTicket(id, mutations) {
      const cur = new Set(issueLabels.get(id) ?? []);
      for (const l of mutations?.labels?.remove ?? []) cur.delete(l);
      for (const l of mutations?.labels?.add ?? []) cur.add(l);
      issueLabels.set(id, [...cur]);
    },
    async getTicketComments(id) {
      return [...(comments.get(id) ?? [])];
    },
    async postComment(id, payload) {
      const c = {
        id: commentSeq++,
        body: payload.body,
        type: payload.type,
        created_at: new Date().toISOString(),
      };
      const list = comments.get(id) ?? [];
      list.push(c);
      comments.set(id, list);
      return { commentId: c.id };
    },
    async deleteComment(commentId) {
      for (const [id, list] of comments.entries()) {
        const next = list.filter((c) => c.id !== commentId);
        if (next.length !== list.length) comments.set(id, next);
      }
    },
  };
}

function threeStoryManifest() {
  return {
    epicId: 100,
    storyManifest: [
      {
        storyId: 1,
        storyTitle: 'Story 1',
        earliestWave: 0,
        tasks: [{ taskId: 11, status: READY, dependencies: [] }],
      },
      {
        storyId: 2,
        storyTitle: 'Story 2',
        earliestWave: 0,
        tasks: [{ taskId: 21, status: READY, dependencies: [] }],
      },
      {
        storyId: 3,
        storyTitle: 'Story 3',
        earliestWave: 0,
        tasks: [{ taskId: 31, status: READY, dependencies: [] }],
      },
    ],
  };
}

function freshProvider() {
  return makeProvider({
    tickets: [
      { id: 1, labels: [READY, 'type::story'] },
      { id: 2, labels: [READY, 'type::story'] },
      { id: 3, labels: [READY, 'type::story'] },
    ],
  });
}

// ---------------------------------------------------------------------------
// (a) Two parallel sessions claim 2 distinct stories, 100% of 50 runs.
// ---------------------------------------------------------------------------

describe('pool-mode concurrency — AC5 race scenarios', () => {
  it('two simultaneous sessions claim two distinct stories (50/50 runs)', async () => {
    const RUNS = 50;
    for (let run = 0; run < RUNS; run += 1) {
      const provider = freshProvider();
      const manifest = threeStoryManifest();

      const sessionA = `aaa${String(run).padStart(3, '0')}`;
      const sessionB = `bbb${String(run).padStart(3, '0')}`;

      // Drive both sessions to completion in parallel: each one keeps
      // re-trying after a race-loss until it either claims a story or hits
      // the no-eligible path. This mirrors the loop in pool-claim.js.
      async function runSession(sessionId) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const pick = await findEligibleStory(100, manifest, {
            provider,
            runtime: { sessionId },
          });
          if (pick.reason === 'no-eligible') return null;
          const claim = await claimStory(
            pick.storyId,
            { sessionId },
            {
              provider,
            },
          );
          if (claim.ok) return pick.storyId;
          await releaseStory(pick.storyId, { sessionId }, { provider });
        }
        return null;
      }

      const [a, b] = await Promise.all([
        runSession(sessionA),
        runSession(sessionB),
      ]);

      assert.ok(a != null, `run ${run}: session A failed to claim`);
      assert.ok(b != null, `run ${run}: session B failed to claim`);
      assert.notEqual(a, b, `run ${run}: both sessions claimed story ${a}`);

      // Each claimed story carries exactly one in-progress-by:* label.
      for (const sid of [a, b]) {
        const ticket = await provider.getTicket(sid);
        const claimLabels = findClaimLabels(ticket.labels);
        assert.equal(
          claimLabels.length,
          1,
          `run ${run}: story ${sid} had ${claimLabels.length} claim labels`,
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // (b) Pre-claimed story is skipped on subsequent launch.
  // -------------------------------------------------------------------------

  it('a story already carrying in-progress-by:* is skipped', async () => {
    const provider = makeProvider({
      tickets: [
        { id: 1, labels: [READY, 'type::story', claimLabelForSession('xx1')] },
        { id: 2, labels: [READY, 'type::story'] },
        { id: 3, labels: [READY, 'type::story'] },
      ],
    });
    const manifest = threeStoryManifest();
    const pick = await findEligibleStory(100, manifest, {
      provider,
      runtime: { sessionId: 'newone' },
    });
    assert.equal(pick.storyId, 2, 'should skip pre-claimed story 1');
  });

  // -------------------------------------------------------------------------
  // (c) No-eligible exits with a visible reason.
  // -------------------------------------------------------------------------

  it('no-eligible reason surfaces when the wave is fully claimed', async () => {
    const provider = makeProvider({
      tickets: [
        { id: 1, labels: [READY, claimLabelForSession('a')] },
        { id: 2, labels: [READY, claimLabelForSession('b')] },
        { id: 3, labels: [READY, claimLabelForSession('c')] },
      ],
    });
    const result = await findEligibleStory(100, threeStoryManifest(), {
      provider,
      runtime: { sessionId: 'fresh' },
    });
    assert.equal(result.reason, 'no-eligible');
    assert.equal(result.details.scanned, 3);
    assert.equal(result.details.skipped.length, 3);
    for (const skip of result.details.skipped) {
      assert.equal(skip.reason, 'already-claimed');
    }
  });

  it('no-eligible reason surfaces when the wave is fully done', async () => {
    const manifest = {
      epicId: 100,
      storyManifest: [
        {
          storyId: 1,
          storyTitle: 'Story 1',
          earliestWave: 0,
          tasks: [{ taskId: 11, status: DONE, dependencies: [] }],
        },
      ],
    };
    const provider = makeProvider({
      tickets: [{ id: 1, labels: [DONE, 'type::story'] }],
    });
    const result = await findEligibleStory(100, manifest, {
      provider,
      runtime: { sessionId: 'fresh' },
    });
    assert.equal(result.reason, 'no-eligible');
  });

  // -------------------------------------------------------------------------
  // (d) Race-loser releases its label within one iteration.
  // -------------------------------------------------------------------------

  it('race-loser drops its label after one releaseStory call', async () => {
    const provider = makeProvider({
      tickets: [{ id: 1, labels: [READY, 'type::story'] }],
    });

    // Force a deterministic race: both sessions add their label, both post
    // their comment, both read back the issue with both claim labels.
    const sessA = 'aaa';
    const sessB = 'bbb';
    const [resA, resB] = await Promise.all([
      claimStory(1, { sessionId: sessA }, { provider }),
      claimStory(1, { sessionId: sessB }, { provider }),
    ]);

    // Lexicographic min wins: 'aaa' < 'bbb'.
    assert.equal(resA.raceDetected, true);
    assert.equal(resB.raceDetected, true);
    assert.equal(resA.ok, true);
    assert.equal(resB.ok, false);
    assert.equal(resB.winnerSessionId, 'aaa');

    await releaseStory(1, { sessionId: sessB }, { provider });
    const ticket = await provider.getTicket(1);
    assert.deepEqual(findClaimLabels(ticket.labels), [
      claimLabelForSession('aaa'),
    ]);
  });

  // -------------------------------------------------------------------------
  // (e) Pool mode respects the dependency guard.
  // -------------------------------------------------------------------------

  it('story whose blockers are unmerged is skipped, picking the next ready candidate', async () => {
    const manifest = {
      epicId: 100,
      storyManifest: [
        {
          storyId: 1,
          storyTitle: 'Upstream',
          earliestWave: 0,
          tasks: [{ taskId: 11, status: READY, dependencies: [] }],
        },
        {
          storyId: 2,
          storyTitle: 'Downstream (blocked by 11)',
          earliestWave: 1,
          tasks: [{ taskId: 21, status: READY, dependencies: [11] }],
        },
        {
          storyId: 3,
          storyTitle: 'Independent',
          earliestWave: 1,
          tasks: [{ taskId: 31, status: READY, dependencies: [] }],
        },
      ],
    };
    const provider = makeProvider({
      tickets: [
        { id: 1, labels: [READY, claimLabelForSession('xx1')] }, // already claimed
        { id: 2, labels: [READY, 'type::story'] }, // blocked by 11 (still ready)
        { id: 3, labels: [READY, 'type::story'] },
      ],
    });
    const pick = await findEligibleStory(100, manifest, {
      provider,
      runtime: { sessionId: 'new' },
    });
    assert.equal(
      pick.storyId,
      3,
      'must skip claimed #1 and blocker-pending #2, pick independent #3',
    );
  });
});
