/**
 * Story #5205 — the post-land tail rolls the closing Story's container Epic
 * up from its children, and reports the outcome as its own per-step boolean.
 *
 * This is the seam that makes the rollup hold at N=1: the run epilogue that
 * used to own the Epic close never fires for a one-Story run, so a container
 * whose last open child was a single Story stayed open forever.
 *
 * These tests pin the step's contract — it runs with the Story id and the
 * resolved config, a closure is announced, a per-Epic failure degrades the
 * report without failing the land, and a throw is absorbed like every other
 * tail step's.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { runPostLandTail } from '../../../.agents/scripts/lib/orchestration/single-story-close/phases/post-land.js';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';

/** Seams that let every OTHER tail step succeed quietly. */
function quietSeams() {
  return {
    emitCloseRecoveredFrictionFn: async () => true,
    emitRecoveredFrictionMarkerFn: async () => true,
    captureStoryFollowUpsFn: async () => ({ ok: true }),
    reassertStatusColumnFn: async () => ({ status: 'synced' }),
    reapPlanRunLabelsForStoryFn: async () => ({ deleted: [], failed: [] }),
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
    releaseStoryLeaseFn: async () => ({
      released: true,
      owner: 'tester',
      reason: 'released',
    }),
  };
}

let tmpDir;
beforeEach(() => {
  tmpDir = makeTempDir('post-land-epic-');
  fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Run the tail with the quiet seams plus this test's overrides. */
function runTail(overrides = {}, progress) {
  return runPostLandTail({
    storyId: 5205,
    storyBranch: 'story-5205',
    baseBranch: 'main',
    cwd: tmpDir,
    provider: { marker: 'provider' },
    config: { marker: 'config' },
    progress,
    ...quietSeams(),
    ...overrides,
  });
}

describe('runPostLandTail — the Epic rollup step (Story #5205)', () => {
  it('rolls up with the closing Story id and the resolved config', async () => {
    const seen = [];
    const tail = await runTail({
      rollUpEpicForStoryFn: async (args) => {
        seen.push(args);
        return { epics: [], closed: [], pending: [], reason: null };
      },
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].storyId, 5205);
    assert.deepEqual(seen[0].provider, { marker: 'provider' });
    assert.deepEqual(seen[0].config, { marker: 'config' });
    assert.equal(tail.epicRollup, true);
    assert.equal(tail.details.epicRollup, null);
  });

  it('announces each container it closed', async () => {
    const lines = [];
    const tail = await runTail(
      {
        rollUpEpicForStoryFn: async () => ({
          epics: [{ epicId: 90, column: 'Done', closed: true, detail: null }],
          closed: [90],
          pending: [],
          reason: null,
        }),
      },
      (_tag, msg) => lines.push(msg),
    );

    assert.equal(tail.epicRollup, true);
    assert.ok(
      lines.some((l) => l.includes('Closed container Epic #90')),
      'the operator is told which container closed',
    );
  });

  it('degrades to epicRollup: false on a per-Epic failure, without failing the land', async () => {
    const tail = await runTail({
      rollUpEpicForStoryFn: async () => ({
        epics: [
          { epicId: 90, column: null, closed: false, detail: '422 refused' },
          { epicId: 91, column: 'Done', closed: true, detail: null },
        ],
        closed: [91],
        pending: [90],
        reason: null,
      }),
    });

    assert.equal(tail.epicRollup, false);
    assert.match(tail.details.epicRollup, /#90: 422 refused/);
    assert.equal(tail.leaseRelease, true, 'the land is unaffected');
  });

  it('absorbs a throwing rollup like every other tail step', async () => {
    const tail = await runTail({
      rollUpEpicForStoryFn: async () => {
        throw new Error('network down');
      },
    });

    assert.equal(tail.epicRollup, false);
    assert.match(tail.details.epicRollup, /network down/);
    assert.equal(tail.followUps, true, 'neighbouring steps still report');
  });

  it('reports true for a Story under no container', async () => {
    const tail = await runTail({
      rollUpEpicForStoryFn: async () => ({
        epics: [],
        closed: [],
        pending: [],
        reason: 'no-container-epic',
      }),
    });

    assert.equal(
      tail.epicRollup,
      true,
      'nothing to roll up IS the correct outcome',
    );
  });
});
