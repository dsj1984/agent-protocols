/**
 * Story #4860 — the assignee-lease is released by the post-land tail, on a
 * CONFIRMED merge, and nowhere else.
 *
 * The close used to release it immediately after the PR was opened and armed,
 * so a Story's ticket read unassigned for the whole time its PR was open (and
 * forever on the operator-merge path, where nothing downstream re-claimed it).
 * Homing the release in the tail is what makes "assigned until merged" true on
 * BOTH landing surfaces — the in-close merge wait and the standalone
 * `single-story-confirm-merge.js` CLI — since the tail is the only phase both
 * reach.
 *
 * These tests pin the step's contract: it runs, it reports per-step, a no-op
 * release is a success, and a throwing release degrades the report without
 * failing the land.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { runPostLandTail } from '../../../.agents/scripts/lib/orchestration/single-story-close/phases/post-land.js';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';

/**
 * Seams for a tail whose every OTHER step succeeds quietly, so an assertion
 * about `leaseRelease` is never confounded by a neighbour. Each stub exists
 * for the isolation reason the sibling suites document: unstubbed, these
 * steps reach the main checkout's signal stream, its temp tree, or GitHub.
 */
function quietSeams() {
  return {
    emitCloseRecoveredFrictionFn: async () => true,
    emitRecoveredFrictionMarkerFn: async () => true,
    captureStoryFollowUpsFn: async () => ({ ok: true }),
    reassertStatusColumnFn: async () => ({ status: 'synced' }),
    gitSpawnFn: () => ({ status: 0 }),
    planFastForwardFn: () => ({
      runnable: false,
      reason: 'already-up-to-date',
    }),
    executeFastForwardFn: () => ({ applied: true, behind: 0 }),
    acquireLockWithWaitFn: async () => ({
      acquired: true,
      release: () => {},
      ownerId: 't',
    }),
    purgeStoryTempArtifactsFn: async () => ({
      skipped: null,
      purged: [],
      errors: [],
      bytesReclaimed: 0,
    }),
  };
}

let tmpDir;
beforeEach(() => {
  tmpDir = makeTempDir('post-land-lease-');
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Run the tail with the quiet seams plus whatever this test overrides. */
function runTail(overrides = {}) {
  return runPostLandTail({
    storyId: 4860,
    storyBranch: 'story-4860',
    baseBranch: 'main',
    cwd: tmpDir,
    provider: { marker: 'provider' },
    config: { marker: 'config' },
    ...quietSeams(),
    ...overrides,
  });
}

describe('runPostLandTail — lease release (Story #4860)', () => {
  it('releases the lease and reports leaseRelease: true', async () => {
    const calls = [];
    const tail = await runTail({
      releaseStoryLeaseFn: async (args) => {
        calls.push(args);
        return { released: true, owner: 'tester', reason: 'released' };
      },
    });

    assert.equal(tail.leaseRelease, true);
    assert.equal(tail.details.leaseRelease, null);
    assert.equal(calls.length, 1, 'released exactly once');
    // The provider and config are threaded through verbatim — the release
    // resolves its operator identity from config, so a dropped config would
    // silently fail closed on every land.
    assert.deepEqual(calls[0], {
      provider: { marker: 'provider' },
      storyId: 4860,
      config: { marker: 'config' },
    });
  });

  it('treats a no-op release as a success, carrying the reason as detail', async () => {
    // The operator is no longer the recorded owner — a re-run, or the belated
    // manual confirm that backfills an already-`agent::done` Story. An
    // already-unassigned ticket IS the desired end state, so reporting this
    // as a failed step would train readers to ignore the field.
    const tail = await runTail({
      releaseStoryLeaseFn: async () => ({
        released: false,
        owner: null,
        reason: 'not-owner',
      }),
    });

    assert.equal(tail.leaseRelease, true);
    assert.equal(tail.details.leaseRelease, 'not-owner');
  });

  it('degrades to leaseRelease: false when the release throws, without failing the land', async () => {
    const tail = await runTail({
      releaseStoryLeaseFn: async () => {
        throw new Error('assignees PATCH rejected');
      },
    });

    assert.equal(tail.leaseRelease, false);
    assert.match(tail.details.leaseRelease, /assignees PATCH rejected/);
    // The merge already landed: every other step still ran and reported.
    assert.equal(tail.followUps, true);
    assert.equal(tail.statusResync, true);
    assert.equal(tail.baseFastForward, true);
    assert.equal(tail.tempPurge, true);
  });

  it('still releases when an earlier tail step degrades', async () => {
    // The claim must not survive a land just because an unrelated best-effort
    // step failed — that would strand exactly the ticket whose report already
    // looks worst.
    const tail = await runTail({
      reassertStatusColumnFn: async () => {
        throw new Error('projects v2 flaked');
      },
      releaseStoryLeaseFn: async () => ({
        released: true,
        owner: 'tester',
        reason: 'released',
      }),
    });

    assert.equal(tail.statusResync, false);
    assert.equal(tail.leaseRelease, true);
  });
});
