/**
 * tests/lib/orchestration/merge-poll.test.js
 *
 * Unit coverage for the close path's check-rollup derivation.
 *
 * `failingChecksBlockMerge` is the required-vs-optional discriminator the
 * rollup itself cannot provide. The bug it exists to prevent: the #4543
 * merge fail-fast treated ANY red check as terminal, so a red optional check
 * (or a CANCELLED superseded workflow run) flipped the Story to
 * `agent::blocked` while GitHub native auto-merge — which gates only on
 * REQUIRED checks — landed the PR anyway, leaving a merged-but-blocked strand
 * only an operator could unpick.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  advisoryCheckFailedBlocksArm,
  decideMergeWaitFailFast,
  deriveChecksStatus,
  deriveRedHeadRuns,
  deriveRequiredRunEvidence,
  failingChecksBlockMerge,
  formatAdvisoryGateReason,
  requiredCheckFailedBlocksMerge,
  selectBlockingRedRuns,
} from '../../../.agents/scripts/lib/orchestration/merge-poll.js';

describe('deriveChecksStatus', () => {
  it('reports failure for a red check regardless of whether it is required', () => {
    assert.equal(
      deriveChecksStatus([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ]),
      'failure',
    );
  });

  it('counts a CANCELLED (e.g. superseded) run as a failure', () => {
    assert.equal(
      deriveChecksStatus([{ status: 'COMPLETED', conclusion: 'CANCELLED' }]),
      'failure',
    );
  });

  it('reports still-running while any check is incomplete', () => {
    assert.equal(
      deriveChecksStatus([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'IN_PROGRESS' },
      ]),
      'still-running',
    );
  });

  it('reports success when every check completed green', () => {
    assert.equal(
      deriveChecksStatus([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]),
      'success',
    );
  });

  it('reports unknown for an empty or non-array rollup (checks-less repo)', () => {
    assert.equal(deriveChecksStatus([]), 'unknown');
    assert.equal(deriveChecksStatus(undefined), 'unknown');
  });
});

describe('failingChecksBlockMerge', () => {
  it('is true for a red check GitHub reports as BLOCKED (a required check)', () => {
    assert.equal(
      failingChecksBlockMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'BLOCKED',
      }),
      true,
    );
  });

  it('is false for a red check on an UNSTABLE PR — mergeable with non-passing checks', () => {
    // The live bug: auto-merge lands this PR. Failing fast on it strands the
    // Story agent::blocked on a merged PR.
    assert.equal(
      failingChecksBlockMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'UNSTABLE',
      }),
      false,
    );
  });

  it('is false when the merge state is unknown or absent (degrade to waiting)', () => {
    assert.equal(failingChecksBlockMerge({ checksStatus: 'failure' }), false);
    assert.equal(
      failingChecksBlockMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'UNKNOWN',
      }),
      false,
    );
  });

  it('is false for a CLEAN or BEHIND PR carrying a red check', () => {
    for (const mergeStateStatus of ['CLEAN', 'BEHIND']) {
      assert.equal(
        failingChecksBlockMerge({ checksStatus: 'failure', mergeStateStatus }),
        false,
        `${mergeStateStatus} must not read as a required-check block`,
      );
    }
  });

  it('is false whenever the checks are not red, whatever the merge state', () => {
    for (const checksStatus of [
      'success',
      'pending',
      'still-running',
      'unknown',
      undefined,
    ]) {
      assert.equal(
        failingChecksBlockMerge({ checksStatus, mergeStateStatus: 'BLOCKED' }),
        false,
        `checksStatus=${checksStatus} is not a red check`,
      );
    }
  });

  it('is false for a missing probe', () => {
    assert.equal(failingChecksBlockMerge(undefined), false);
    assert.equal(failingChecksBlockMerge(null), false);
  });

  it('accepts a lowercase merge state (defensive against gh projection drift)', () => {
    assert.equal(
      failingChecksBlockMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'blocked',
      }),
      true,
    );
  });
});

describe('deriveRequiredRunEvidence (Story #4695)', () => {
  it('reports requiredRunFailed only for a genuine FAILURE/ERROR, not superseded noise', () => {
    // A cancelled superseded run and a timed-out run are the rollup noise the
    // aggregate `deriveChecksStatus` miscounts as failure — they are NOT a red
    // required check.
    assert.deepEqual(
      deriveRequiredRunEvidence([
        { status: 'COMPLETED', conclusion: 'CANCELLED' },
        { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
      ]),
      { requiredRunFailed: false, requiredRunInFlight: false },
    );
    assert.deepEqual(
      deriveRequiredRunEvidence([
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ]),
      { requiredRunFailed: true, requiredRunInFlight: false },
    );
    assert.deepEqual(
      deriveRequiredRunEvidence([{ status: 'COMPLETED', conclusion: 'ERROR' }]),
      { requiredRunFailed: true, requiredRunInFlight: false },
    );
  });

  it('reports requiredRunInFlight for a QUEUED / IN_PROGRESS CheckRun', () => {
    assert.deepEqual(
      deriveRequiredRunEvidence([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'QUEUED' },
      ]),
      { requiredRunFailed: false, requiredRunInFlight: true },
    );
    assert.deepEqual(deriveRequiredRunEvidence([{ status: 'IN_PROGRESS' }]), {
      requiredRunFailed: false,
      requiredRunInFlight: true,
    });
  });

  it('pins the false-positive shape: a cancelled run beside a still-queued required run', () => {
    // Exactly the measured false positive — the aggregate reads `failure`, but
    // the head still has a run in flight and nothing genuinely failed.
    assert.deepEqual(
      deriveRequiredRunEvidence([
        { status: 'COMPLETED', conclusion: 'CANCELLED' },
        { status: 'QUEUED' },
      ]),
      { requiredRunFailed: false, requiredRunInFlight: true },
    );
  });

  it('handles legacy StatusContext entries via their state field', () => {
    assert.deepEqual(deriveRequiredRunEvidence([{ state: 'PENDING' }]), {
      requiredRunFailed: false,
      requiredRunInFlight: true,
    });
    assert.deepEqual(deriveRequiredRunEvidence([{ state: 'FAILURE' }]), {
      requiredRunFailed: true,
      requiredRunInFlight: false,
    });
    assert.deepEqual(deriveRequiredRunEvidence([{ state: 'EXPECTED' }]), {
      requiredRunFailed: false,
      requiredRunInFlight: true,
    });
  });

  it('returns null for an empty or non-array rollup (evidence unavailable)', () => {
    assert.equal(deriveRequiredRunEvidence([]), null);
    assert.equal(deriveRequiredRunEvidence(undefined), null);
    assert.equal(deriveRequiredRunEvidence(null), null);
  });
});

describe('requiredCheckFailedBlocksMerge (Story #4695)', () => {
  const genuinelyRed = {
    checksStatus: 'failure',
    mergeStateStatus: 'BLOCKED',
    requiredRunEvidence: {
      requiredRunFailed: true,
      requiredRunInFlight: false,
    },
  };

  it('is true only when a required run failed with none in flight', () => {
    assert.equal(requiredCheckFailedBlocksMerge(genuinelyRed), true);
  });

  it('is false when a required run is still in flight (the false positive)', () => {
    assert.equal(
      requiredCheckFailedBlocksMerge({
        ...genuinelyRed,
        requiredRunEvidence: {
          requiredRunFailed: false,
          requiredRunInFlight: true,
        },
      }),
      false,
    );
    // Even a genuine failure alongside an in-flight run keeps polling — the
    // change never converts a real failure into a wait beyond one poll.
    assert.equal(
      requiredCheckFailedBlocksMerge({
        ...genuinelyRed,
        requiredRunEvidence: {
          requiredRunFailed: true,
          requiredRunInFlight: true,
        },
      }),
      false,
    );
  });

  it('is false when the evidence is unavailable (older gh / API error)', () => {
    // The consecutive-probe fallback owns this path — a single evidence-free
    // failing snapshot must never fail-fast through this predicate.
    assert.equal(
      requiredCheckFailedBlocksMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'BLOCKED',
      }),
      false,
    );
    assert.equal(
      requiredCheckFailedBlocksMerge({
        checksStatus: 'failure',
        mergeStateStatus: 'BLOCKED',
        requiredRunEvidence: null,
      }),
      false,
    );
  });

  it('is false when the raw rollup gate does not hold (UNSTABLE / not red)', () => {
    assert.equal(
      requiredCheckFailedBlocksMerge({
        ...genuinelyRed,
        mergeStateStatus: 'UNSTABLE',
      }),
      false,
    );
    assert.equal(
      requiredCheckFailedBlocksMerge({
        checksStatus: 'success',
        mergeStateStatus: 'BLOCKED',
        requiredRunEvidence: {
          requiredRunFailed: true,
          requiredRunInFlight: false,
        },
      }),
      false,
    );
  });

  it('is false for a missing probe', () => {
    assert.equal(requiredCheckFailedBlocksMerge(undefined), false);
    assert.equal(requiredCheckFailedBlocksMerge(null), false);
  });

  it('declines the verdict when a required review is missing (Story #4710)', () => {
    // The rollup cannot prove the red run is REQUIRED, and REVIEW_REQUIRED
    // already explains the BLOCKED merge state — classification must fall
    // through to the human-required branch, not claim checks-failed.
    assert.equal(
      requiredCheckFailedBlocksMerge({
        ...genuinelyRed,
        reviewDecision: 'REVIEW_REQUIRED',
      }),
      false,
    );
    // Any other review decision leaves the verdict intact.
    assert.equal(
      requiredCheckFailedBlocksMerge({
        ...genuinelyRed,
        reviewDecision: 'APPROVED',
      }),
      true,
    );
  });
});

describe('decideMergeWaitFailFast (Story #4710)', () => {
  const redBlockedProbe = {
    state: 'OPEN',
    checksStatus: 'failure',
    mergeStateStatus: 'BLOCKED',
  };

  it('fails fast on per-run evidence of a genuinely red run with none in flight', () => {
    const decision = decideMergeWaitFailFast({
      probe: {
        ...redBlockedProbe,
        requiredRunEvidence: {
          requiredRunFailed: true,
          requiredRunInFlight: false,
        },
      },
      consecutiveRequiredFailSnapshots: 0,
    });
    assert.equal(decision.failFast, true);
    assert.equal(decision.evidencePath, 'per-run');
    assert.equal(decision.prProbe.evidencePath, 'per-run');
    assert.equal(decision.consecutiveRequiredFailSnapshots, 0);
  });

  it('keeps polling while a required run is still in flight (evidence-bearing)', () => {
    const decision = decideMergeWaitFailFast({
      probe: {
        ...redBlockedProbe,
        requiredRunEvidence: {
          requiredRunFailed: false,
          requiredRunInFlight: true,
        },
      },
      consecutiveRequiredFailSnapshots: 1,
    });
    assert.equal(decision.failFast, false);
    assert.equal(
      decision.consecutiveRequiredFailSnapshots,
      0,
      'an evidence-bearing probe resets the evidence-free counter',
    );
  });

  it('without evidence, requires two consecutive failing probes before fail-fast', () => {
    const first = decideMergeWaitFailFast({
      probe: redBlockedProbe,
      consecutiveRequiredFailSnapshots: 0,
    });
    assert.equal(first.failFast, false);
    assert.equal(first.consecutiveRequiredFailSnapshots, 1);

    const second = decideMergeWaitFailFast({
      probe: redBlockedProbe,
      consecutiveRequiredFailSnapshots: first.consecutiveRequiredFailSnapshots,
    });
    assert.equal(second.failFast, true);
    assert.equal(second.evidencePath, 'consecutive-probe');
    // The synthesized evidence routes both paths through the SAME classifier
    // gate downstream.
    assert.deepEqual(second.prProbe.requiredRunEvidence, {
      requiredRunFailed: true,
      requiredRunInFlight: false,
    });
    assert.equal(second.prProbe.evidencePath, 'consecutive-probe');
  });

  it('resets the counter on any non-failing probe', () => {
    const decision = decideMergeWaitFailFast({
      probe: { state: 'OPEN', checksStatus: 'still-running' },
      consecutiveRequiredFailSnapshots: 1,
    });
    assert.equal(decision.failFast, false);
    assert.equal(decision.consecutiveRequiredFailSnapshots, 0);
  });

  it('never fail-fasts while a required review is missing — either path', () => {
    // Per-run path.
    const perRun = decideMergeWaitFailFast({
      probe: {
        ...redBlockedProbe,
        reviewDecision: 'REVIEW_REQUIRED',
        requiredRunEvidence: {
          requiredRunFailed: true,
          requiredRunInFlight: false,
        },
      },
      consecutiveRequiredFailSnapshots: 0,
    });
    assert.equal(perRun.failFast, false);
    // Consecutive-probe path: even the second evidence-free failing probe
    // must not claim checks-failed while REVIEW_REQUIRED explains the block.
    const consecutive = decideMergeWaitFailFast({
      probe: { ...redBlockedProbe, reviewDecision: 'REVIEW_REQUIRED' },
      consecutiveRequiredFailSnapshots: 1,
    });
    assert.equal(consecutive.failFast, false);
  });
});

// ---------------------------------------------------------------------------
// Story #5096 — the ADVISORY counterpart of `requiredCheckFailedBlocksMerge`.
//
// GitHub native auto-merge waits on REQUIRED contexts only, so a red
// NON-required gate is merged straight past. `mergeStateStatus` is the
// discriminator: BLOCKED means the red run gates the merge (already covered
// above); UNSTABLE means "mergeable with non-passing commit status" — the red
// run is advisory and only mandrel can stop the landing.
// ---------------------------------------------------------------------------

describe('deriveRedHeadRuns', () => {
  it('names each genuinely red run, from CheckRun name or StatusContext context', () => {
    assert.deepEqual(
      deriveRedHeadRuns([
        { name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
        {
          name: 'Bundle-size ratchet',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
        },
        { context: 'legacy/lint', state: 'ERROR' },
      ]),
      [
        { name: 'Bundle-size ratchet', conclusion: 'FAILURE' },
        { name: 'legacy/lint', conclusion: 'ERROR' },
      ],
    );
  });

  it('excludes the superseded / sibling-invalidated conclusions (the #4695 trap)', () => {
    assert.deepEqual(
      deriveRedHeadRuns([
        { name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' },
        { name: 'b', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
        { name: 'c', status: 'COMPLETED', conclusion: 'SKIPPED' },
      ]),
      [],
    );
  });

  it('returns [] for an absent or empty rollup', () => {
    assert.deepEqual(deriveRedHeadRuns(undefined), []);
    assert.deepEqual(deriveRedHeadRuns([]), []);
  });

  it('keeps an unnamed red run, with a null name', () => {
    assert.deepEqual(
      deriveRedHeadRuns([{ status: 'COMPLETED', conclusion: 'FAILURE' }]),
      [{ name: null, conclusion: 'FAILURE' }],
    );
  });
});

describe('selectBlockingRedRuns', () => {
  const red = [
    { name: 'Bundle-size ratchet', conclusion: 'FAILURE' },
    { name: 'coverage', conclusion: 'FAILURE' },
  ];

  it('drops exactly the allowlisted runs', () => {
    assert.deepEqual(selectBlockingRedRuns(red, ['coverage']), [
      { name: 'Bundle-size ratchet', conclusion: 'FAILURE' },
    ]);
  });

  it('returns none when every red run is allowlisted', () => {
    assert.deepEqual(
      selectBlockingRedRuns(red, ['coverage', 'Bundle-size ratchet']),
      [],
    );
  });

  it('matches exactly — a partial or differently-cased name does not exempt', () => {
    assert.equal(selectBlockingRedRuns(red, ['coverage-report']).length, 2);
    assert.equal(selectBlockingRedRuns(red, ['COVERAGE']).length, 2);
  });

  it('never exempts an unnamed run', () => {
    assert.deepEqual(
      selectBlockingRedRuns([{ name: null, conclusion: 'FAILURE' }], ['x']),
      [{ name: null, conclusion: 'FAILURE' }],
    );
  });
});

describe('advisoryCheckFailedBlocksArm', () => {
  const redRuns = [{ name: 'Bundle-size ratchet', conclusion: 'FAILURE' }];

  it('blocks a genuinely red run under UNSTABLE', () => {
    assert.equal(
      advisoryCheckFailedBlocksArm({
        mergeStateStatus: 'UNSTABLE',
        redHeadRuns: redRuns,
      }),
      true,
    );
  });

  it('does NOT fire under BLOCKED — that is the required-check case', () => {
    assert.equal(
      advisoryCheckFailedBlocksArm({
        mergeStateStatus: 'BLOCKED',
        redHeadRuns: redRuns,
      }),
      false,
    );
  });

  it('fails OPEN on UNKNOWN, CLEAN, BEHIND, or an absent merge state', () => {
    for (const mergeStateStatus of ['UNKNOWN', 'CLEAN', 'BEHIND', undefined]) {
      assert.equal(
        advisoryCheckFailedBlocksArm({
          mergeStateStatus,
          redHeadRuns: redRuns,
        }),
        false,
        `expected no block for mergeStateStatus=${mergeStateStatus}`,
      );
    }
    assert.equal(advisoryCheckFailedBlocksArm(undefined), false);
  });

  it('does not fire when the only red runs are superseded noise', () => {
    assert.equal(
      advisoryCheckFailedBlocksArm({
        mergeStateStatus: 'UNSTABLE',
        redHeadRuns: deriveRedHeadRuns([
          { name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' },
        ]),
      }),
      false,
    );
  });

  it('does not fire when every red run is allowlisted', () => {
    assert.equal(
      advisoryCheckFailedBlocksArm(
        { mergeStateStatus: 'UNSTABLE', redHeadRuns: redRuns },
        ['Bundle-size ratchet'],
      ),
      false,
    );
  });

  it('is mutually exclusive with requiredCheckFailedBlocksMerge', () => {
    // BLOCKED + evidenced red required run: the required predicate owns it.
    const requiredCase = {
      checksStatus: 'failure',
      mergeStateStatus: 'BLOCKED',
      requiredRunEvidence: {
        requiredRunFailed: true,
        requiredRunInFlight: false,
      },
      redHeadRuns: redRuns,
    };
    assert.equal(requiredCheckFailedBlocksMerge(requiredCase), true);
    assert.equal(advisoryCheckFailedBlocksArm(requiredCase), false);

    // UNSTABLE: GitHub is not gating, so only the advisory predicate fires.
    const advisoryCase = { ...requiredCase, mergeStateStatus: 'UNSTABLE' };
    assert.equal(requiredCheckFailedBlocksMerge(advisoryCase), false);
    assert.equal(advisoryCheckFailedBlocksArm(advisoryCase), true);
  });
});

describe('formatAdvisoryGateReason', () => {
  it('names each offending job and its conclusion', () => {
    const reason = formatAdvisoryGateReason([
      { name: 'Bundle-size ratchet', conclusion: 'FAILURE' },
    ]);
    assert.match(reason, /Bundle-size ratchet → FAILURE/);
    assert.match(reason, /UNSTABLE/);
    assert.match(reason, /advisoryAllowlist/);
  });

  it('degrades without throwing on an empty or malformed list', () => {
    assert.match(formatAdvisoryGateReason([]), /none named/);
    assert.match(formatAdvisoryGateReason(undefined), /none named/);
    assert.match(formatAdvisoryGateReason([{}]), /\(unnamed run\) → FAILURE/);
  });
});
