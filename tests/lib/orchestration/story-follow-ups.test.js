import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  emitBlockRecoveredFriction,
  emitRuntimeFriction,
  RUNTIME_FRICTION_CATEGORIES,
} from '../../../.agents/scripts/lib/observability/runtime-friction.js';
import {
  composeRoutedProposals,
  deriveUnresolvedBlockedEvents,
} from '../../../.agents/scripts/lib/orchestration/retro-proposals.js';
import { runPostLandTail } from '../../../.agents/scripts/lib/orchestration/single-story-close/phases/post-land.js';
import {
  buildFollowUpsCommentBody,
  captureStoryFollowUps,
  gatherRunFrictionSignals,
  gatherStoryFrictionSignals,
  resolveFollowUpRepos,
} from '../../../.agents/scripts/lib/orchestration/story-follow-ups.js';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';

describe('story follow-ups', () => {
  it('resolves repos from github config', () => {
    const repos = resolveFollowUpRepos({
      github: { owner: 'acme', repo: 'app', frameworkRepo: 'acme/mandrel' },
    });
    assert.equal(repos.consumerRepo, 'acme/app');
    assert.equal(repos.frameworkRepo, 'acme/mandrel');
  });

  it('records — but does not file — single-occurrence Story friction', () => {
    // Story #4649: a per-Story window has population 1, so the old
    // story-scope threshold of 1 auto-filed every transient event on a
    // cleanly-shipped Story. It lands in `discarded` now, which the
    // follow-ups comment still renders.
    const proposals = composeRoutedProposals({
      anchorId: 42,
      anchorKind: 'story',
      frameworkRepo: 'a/b',
      consumerRepo: 'c/d',
      signals: [{ category: 'lint-loop', source: 'framework', storyId: 42 }],
    });
    assert.equal(proposals.framework.length, 0);
    assert.equal(proposals.consumer.length, 0);
    // Story #4824 widened DiscardedItem with the descriptive fields a
    // below-threshold roll-up needs to name what it discarded.
    assert.deepEqual(proposals.discarded, [
      {
        category: 'lint-loop',
        occurrences: 1,
        source: 'framework',
        tools: [],
        fingerprint: proposals.discarded[0].fingerprint,
        storyCount: 1,
      },
    ]);
    assert.match(proposals.discarded[0].fingerprint, /^[0-9a-f]{8}$/);
  });

  it('still files a genuinely recurring Story friction category', () => {
    const proposals = composeRoutedProposals({
      anchorId: 42,
      anchorKind: 'story',
      frameworkRepo: 'a/b',
      consumerRepo: 'c/d',
      signals: [
        { category: 'lint-loop', source: 'framework', storyId: 42 },
        { category: 'lint-loop', source: 'framework', storyId: 42 },
      ],
    });
    assert.equal(proposals.framework.length, 1);
    assert.match(proposals.framework[0].title, /Story #42/);
    assert.equal(proposals.discarded.length, 0);
  });

  it('renders a follow-ups comment body', () => {
    const body = buildFollowUpsCommentBody({
      storyId: 9,
      proposals: {
        framework: [],
        consumer: [],
        discarded: [{ category: 'noise', occurrences: 1, source: 'consumer' }],
      },
      graduated: { filed: [] },
    });
    assert.match(body, /follow-ups/);
    assert.match(body, /Story #9/);
    assert.match(body, /noise/);
  });
});

describe('gatherStoryFrictionSignals field preservation (Story #4649)', () => {
  /**
   * The regression this whole Story exists for: both production gathers used
   * to flatten each record to `{ category, source }`, dropping exactly the
   * two fields the composer's recovery-netting keys on. The #4622 fix was
   * therefore unreachable on real data while its unit tests stayed green,
   * because they fed the composer synthetic signals no producer emitted.
   *
   * So this test drives the REAL writer and the REAL gather against a real
   * temp tree — a composer-level assertion could not have caught it.
   */
  let tempRoot;
  let config;

  beforeEach(async () => {
    tempRoot = await makeTempDir('follow-ups-');
    config = { project: { paths: { tempRoot } } };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('preserves storyId and details through the gather', async () => {
    await emitRuntimeFriction({
      storyId: 4649,
      category: RUNTIME_FRICTION_CATEGORIES.STORY_BLOCKED,
      tool: 'test',
      details: { toState: 'agent::blocked' },
      config,
    });

    const signals = await gatherStoryFrictionSignals(4649, config);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].category, 'story-blocked');
    assert.equal(signals[0].storyId, 4649);
    assert.equal(signals[0].details.toState, 'agent::blocked');
  });

  it('nets a self-resolved block out end-to-end, writer through composer', async () => {
    await emitRuntimeFriction({
      storyId: 4650,
      category: RUNTIME_FRICTION_CATEGORIES.STORY_BLOCKED,
      tool: 'test',
      details: { toState: 'agent::blocked' },
      config,
    });
    await emitBlockRecoveredFriction({
      storyId: 4650,
      fromState: 'agent::blocked',
      toState: 'agent::executing',
      config,
    });

    const signals = await gatherStoryFrictionSignals(4650, config);
    assert.equal(signals.length, 2, 'both records are on the stream');

    const proposals = composeRoutedProposals({
      anchorId: 4650,
      anchorKind: 'story',
      frameworkRepo: 'a/b',
      consumerRepo: 'c/d',
      signals,
      unresolvedBlockedEvents: deriveUnresolvedBlockedEvents(signals),
    });
    assert.deepEqual(
      proposals,
      { framework: [], consumer: [], discarded: [] },
      'a Story that blocked and self-resolved files nothing',
    );
  });
});

/**
 * Story #4824 — the recurrence WINDOW, not the threshold.
 *
 * `gatherRunFrictionSignals` used to reduce over the current run's Story ids
 * only. A defect that fires exactly once per Story — which is what a systemic
 * framework defect looks like — therefore scored `occurrences: 1` on every
 * Story and was discarded as a singleton, on every Story, forever. Eighteen
 * consecutive Stories filed nothing.
 *
 * These drive the REAL writer into a real temp tree and the REAL gather back
 * out, because that is the only place the bug lived: a composer-level test
 * fed synthetic multi-Story signals no production gather could produce.
 */
describe('cross-Story recurrence window (Story #4824)', () => {
  let tempRoot;
  let config;

  beforeEach(async () => {
    tempRoot = await makeTempDir('recurrence-window-');
    config = { project: { paths: { tempRoot } } };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  /** Emit the real `tool-degraded` record a lint-runner failure produces. */
  const degrade = (storyId) =>
    emitRuntimeFriction({
      storyId,
      category: RUNTIME_FRICTION_CATEGORIES.TOOL_DEGRADED,
      tool: 'native-review-lint',
      details: {
        surface: 'scoped-lint',
        reason: 'lint runner produced no parseable output',
      },
      config,
    });

  it('AC-4: one occurrence in each of two Stories reaches the threshold', async () => {
    await degrade(8101);
    await degrade(8102);

    // The run under way is Story #8102 alone — exactly the shape that used to
    // discard this defect as a singleton.
    const signals = await gatherRunFrictionSignals([8102], config);
    assert.equal(signals.length, 2, 'the window spans both surviving streams');

    const proposals = composeRoutedProposals({
      anchorId: 8102,
      anchorKind: 'run',
      frameworkRepo: 'dsj1984/mandrel',
      consumerRepo: 'acme/app',
      signals,
      unresolvedBlockedEvents: deriveUnresolvedBlockedEvents(signals),
    });
    assert.equal(proposals.discarded.length, 0, 'no longer discarded');
    assert.equal(proposals.framework.length, 1);
    assert.equal(proposals.framework[0].category, 'tool-degraded');
    assert.equal(proposals.framework[0].occurrences, 2);
  });

  it('AC-5: five streams carrying one fingerprint produce exactly one proposal', async () => {
    for (const sid of [8201, 8202, 8203, 8204, 8205]) await degrade(sid);

    const signals = await gatherRunFrictionSignals([8205], config);
    assert.equal(signals.length, 5);

    const proposals = composeRoutedProposals({
      anchorId: 8205,
      anchorKind: 'run',
      frameworkRepo: 'dsj1984/mandrel',
      consumerRepo: 'acme/app',
      signals,
    });
    assert.equal(
      proposals.framework.length + proposals.consumer.length,
      1,
      'recurrence files one proposal, never one per occurrence',
    );
    assert.equal(proposals.framework[0].occurrences, 5);
  });

  it('counts an event once even though the run Story is also walked', async () => {
    // The gather reads the run's own Story explicitly AND rediscovers it in
    // the temp-tree walk. Without `eventId` de-duplication that inflates a
    // genuine singleton into a fabricated recurrence.
    await degrade(8301);

    const signals = await gatherRunFrictionSignals([8301], config);
    assert.equal(signals.length, 1);

    const proposals = composeRoutedProposals({
      anchorId: 8301,
      anchorKind: 'run',
      frameworkRepo: 'dsj1984/mandrel',
      consumerRepo: 'acme/app',
      signals,
    });
    assert.equal(proposals.framework.length, 0);
    assert.equal(proposals.discarded.length, 1);
    assert.equal(proposals.discarded[0].occurrences, 1);
  });

  it('walks Epic-attached streams as well as standalone ones', async () => {
    await emitRuntimeFriction({
      storyId: 8401,
      epicId: 9001,
      category: RUNTIME_FRICTION_CATEGORIES.TOOL_DEGRADED,
      tool: 'local-lens-review',
      details: { surface: 'lens-materialization', reason: 'ENOENT' },
      config,
    });
    await degrade(8402);

    const signals = await gatherRunFrictionSignals([8402], config);
    assert.equal(signals.length, 2, 'run-<eid>/stories/ is in the window too');
    assert.deepEqual(signals.map((s) => s.storyId).sort(), [8401, 8402]);
  });

  it('returns no signals when the temp tree does not exist', async () => {
    const missing = { project: { paths: { tempRoot: `${tempRoot}/absent` } } };
    assert.deepEqual(await gatherRunFrictionSignals([1, 2], missing), []);
  });

  it('tags a runtime tool-degradation framework end to end (Story #4824)', async () => {
    // The classification limb and the window limb meet here: the record is
    // written by the real writer, so its `source` is whatever
    // `tagSignalSource` decided — which, pre-#4824, was always `consumer`.
    await degrade(8501);
    const signals = await gatherRunFrictionSignals([8501], config);
    assert.equal(signals[0].source, 'framework');
    assert.equal(signals[0].tool, 'native-review-lint');
  });
});

describe('post-land recovery marking end-to-end (Story #4654)', () => {
  let tempRoot;
  let config;

  beforeEach(async () => {
    tempRoot = await makeTempDir('post-land-recover-');
    // Disable auto-filing so the graduator is a no-op (no `gh` calls) and the
    // assertions read the composed proposals, not a live GitHub filing.
    config = {
      project: { paths: { tempRoot } },
      delivery: { feedbackLoop: { retroProposals: false } },
    };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  /** A ticketing provider fake sufficient for `upsertStructuredComment`. */
  function fakeProvider() {
    let nextId = 1;
    return {
      getTicketComments: async () => [],
      postComment: async () => ({ id: nextId++ }),
      deleteComment: async () => {},
    };
  }

  /**
   * Run only the recovery-marker emits of the tail against a real temp tree:
   * every git/GitHub/status/lock step is stubbed so the emits (defaulted to
   * the real functions, threaded `config`) are the only side effect.
   */
  const landTail = (storyId) =>
    runPostLandTail({
      storyId,
      storyBranch: `story-${storyId}`,
      baseBranch: 'main',
      cwd: tempRoot,
      provider: {},
      config,
      captureStoryFollowUpsFn: async () => ({ ok: true }),
      reassertStatusColumnFn: async () => ({ status: 'synced' }),
      gitSpawnFn: () => ({ status: 1 }),
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
    });

  const seed = (storyId, category) =>
    emitRuntimeFriction({
      storyId,
      category,
      tool: 'test',
      details: { reason: 'boom' },
      config,
    });

  it('AC-1: a Story that blocked then landed files no story-blocked follow-up', async () => {
    await seed(5501, RUNTIME_FRICTION_CATEGORIES.STORY_BLOCKED);
    await landTail(5501);

    const result = await captureStoryFollowUps({
      storyId: 5501,
      provider: fakeProvider(),
      config,
    });
    assert.equal(result.ok, true);
    const filed = [...result.proposals.framework, ...result.proposals.consumer];
    assert.ok(
      !filed.some((i) => i.category === 'story-blocked'),
      'no story-blocked proposal survives the recovery marker',
    );
    assert.equal(result.graduated.filed.length, 0);
  });

  it('AC-2: the marker is conditional — a Story that never blocked gains no story-blocked row', async () => {
    await landTail(5502);
    const rows = await gatherStoryFrictionSignals(5502, config);
    assert.deepEqual(rows, [], 'no spurious marker suppresses a clean bucket');
  });

  it('AC-5: three merge-wait-exhausted records that then land file no follow-up', async () => {
    await seed(5503, RUNTIME_FRICTION_CATEGORIES.MERGE_WAIT_EXHAUSTED);
    await seed(5503, RUNTIME_FRICTION_CATEGORIES.MERGE_WAIT_EXHAUSTED);
    await seed(5503, RUNTIME_FRICTION_CATEGORIES.MERGE_WAIT_EXHAUSTED);
    await landTail(5503);

    const result = await captureStoryFollowUps({
      storyId: 5503,
      provider: fakeProvider(),
      config,
    });
    assert.equal(result.ok, true);
    const filed = [...result.proposals.framework, ...result.proposals.consumer];
    assert.ok(
      !filed.some((i) => i.category === 'merge-wait-exhausted'),
      'genuine exhaustion clears the ≥2 threshold but is netted by the marker',
    );
    assert.equal(result.graduated.filed.length, 0);
  });
});

describe('unresolved-block derivation (Story #4649)', () => {
  const BLOCKED = 'story-blocked';
  const blk = (storyId, details) => ({
    category: BLOCKED,
    source: 'framework',
    storyId,
    details: details ?? { toState: 'agent::blocked' },
  });
  const recovered = (storyId) => blk(storyId, { recovered: true });

  it('emits an event for a Story still parked at agent::blocked', () => {
    assert.deepEqual(deriveUnresolvedBlockedEvents([blk(7)]), [
      { ticketId: 7, source: 'framework', category: BLOCKED },
    ]);
  });

  it('emits nothing for a Story whose block self-resolved', () => {
    assert.deepEqual(deriveUnresolvedBlockedEvents([blk(7), recovered(7)]), []);
  });

  it('forces a parked Story actionable at a single occurrence', () => {
    // The whole point of the derivation: this is what the retired
    // story-scope threshold carve-out was standing in for.
    const signals = [blk(7)];
    const proposals = composeRoutedProposals({
      anchorId: 7,
      anchorKind: 'story',
      frameworkRepo: 'a/b',
      consumerRepo: 'c/d',
      signals,
      unresolvedBlockedEvents: deriveUnresolvedBlockedEvents(signals),
    });
    assert.equal(proposals.framework.length, 1);
    assert.equal(proposals.framework[0].category, BLOCKED);
    assert.equal(proposals.discarded.length, 0);
  });

  it('files nothing for a Story that blocked and self-resolved', () => {
    const signals = [blk(7), recovered(7)];
    const proposals = composeRoutedProposals({
      anchorId: 7,
      anchorKind: 'story',
      frameworkRepo: 'a/b',
      consumerRepo: 'c/d',
      signals,
      unresolvedBlockedEvents: deriveUnresolvedBlockedEvents(signals),
    });
    assert.deepEqual(proposals, {
      framework: [],
      consumer: [],
      discarded: [],
    });
  });

  it('ignores non-block categories and unusable story ids', () => {
    assert.deepEqual(
      deriveUnresolvedBlockedEvents([
        { category: 'close-failed', source: 'framework', storyId: 7 },
        { category: BLOCKED, source: 'framework', storyId: 0 },
        { category: BLOCKED, source: 'framework' },
        null,
      ]),
      [],
    );
  });

  it('returns [] for a non-array input', () => {
    assert.deepEqual(deriveUnresolvedBlockedEvents(undefined), []);
  });
});

describe('empty roll-up assertion (Story #4578)', () => {
  const empty = {
    proposals: { framework: [], consumer: [], discarded: [] },
    graduated: { filed: [] },
  };

  it('stays quiet and truthful for a genuinely clean single-Story run', () => {
    const body = buildFollowUpsCommentBody({ storyId: 9, ...empty });
    assert.match(body, /No friction signals — nothing to follow up/);
    assert.doesNotMatch(body, /telemetry/i);
    assert.doesNotMatch(body, /claim/i);
  });

  it('defaults to the quiet reading when storyCount is omitted', () => {
    // captureStoryFollowUps (per-Story close) passes no storyCount.
    const body = buildFollowUpsCommentBody({ storyId: 9, ...empty });
    assert.match(body, /nothing to follow up/);
  });

  it('flags an empty roll-up over an N>1 run as a claim, not a success', () => {
    const body = buildFollowUpsCommentBody({
      storyId: 9,
      ...empty,
      storyCount: 7,
    });
    // The count is named — "0 across 7" is the claim worth flagging.
    assert.match(body, /0 friction signals across 7 Stories/);
    assert.match(body, /not a clean bill of health/);
    assert.match(body, /telemetry never fired/);
    // and it must NOT still read as the reassuring line.
    assert.doesNotMatch(body, /nothing to follow up/);
  });

  it('exposes emptyRollupSuspect in the machine-readable block', () => {
    const flagged = buildFollowUpsCommentBody({
      storyId: 9,
      ...empty,
      storyCount: 7,
    });
    assert.match(flagged, /"emptyRollupSuspect": true/);
    assert.match(flagged, /"storyCount": 7/);

    const clean = buildFollowUpsCommentBody({ storyId: 9, ...empty });
    assert.match(clean, /"emptyRollupSuspect": false/);
  });

  it('does not flag an N>1 run that actually produced signals', () => {
    const body = buildFollowUpsCommentBody({
      storyId: 9,
      proposals: {
        framework: [],
        consumer: [],
        discarded: [{ category: 'noise', occurrences: 1, source: 'consumer' }],
      },
      graduated: { filed: [] },
      storyCount: 7,
    });
    assert.doesNotMatch(body, /telemetry may not|not a clean bill of health/);
    assert.match(body, /"emptyRollupSuspect": false/);
  });
});
