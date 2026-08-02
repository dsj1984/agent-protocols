import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AGENT_LABELS } from '../../.agents/scripts/lib/label-constants.js';
import {
  classifyStory,
  planReadySet,
  storiesOverlap,
  storyFootprint,
  storyIdOf,
} from '../../.agents/scripts/lib/wave-runner/ready-set.js';

/**
 * The dispatch set alone. `planReadySet` is the only scheduling entry point
 * (Story #4960 deleted the `selectReadySet` wrapper that had lost its last
 * production caller); cases that assert only on admission read better against
 * this local projection than against `.selected` at every call site.
 */
const dispatchSet = (args) => planReadySet(args).selected;

/**
 * Convenience factory for a Story record. `dependsOn` feeds the explicit
 * dependency-field arm of `buildStoryAdjacency`; `files` feeds the
 * footprint extractor.
 */
function story(
  id,
  { labels = [], state = 'open', dependsOn, files, body } = {},
) {
  const rec = { id, labels, state };
  if (dependsOn !== undefined) rec.dependsOn = dependsOn;
  if (files !== undefined) rec.files = files;
  if (body !== undefined) rec.body = body;
  return rec;
}

const ids = (recs) => recs.map((r) => r.id).sort((a, b) => a - b);

describe('lib/wave-runner/ready-set — storyIdOf', () => {
  it('reads the ticket `id` shape and the GitHub `number` shape', () => {
    assert.equal(storyIdOf({ id: 7 }), 7);
    assert.equal(storyIdOf({ number: 9 }), 9);
    assert.equal(storyIdOf(11), 11);
  });

  it('returns null for absent / non-positive / non-integer ids', () => {
    assert.equal(storyIdOf({}), null);
    assert.equal(storyIdOf({ id: 0 }), null);
    assert.equal(storyIdOf({ id: -3 }), null);
    assert.equal(storyIdOf({ id: 'abc' }), null);
  });
});

describe('lib/wave-runner/ready-set — classifyStory', () => {
  it('classifies done via the agent::done label', () => {
    assert.equal(
      classifyStory(story(1, { labels: [AGENT_LABELS.DONE] })),
      'done',
    );
  });

  it('classifies done via a closed issue even without the label', () => {
    assert.equal(
      classifyStory(story(1, { labels: [], state: 'closed' })),
      'done',
    );
  });

  it('lets done win over a stale executing label', () => {
    assert.equal(
      classifyStory(
        story(1, { labels: [AGENT_LABELS.EXECUTING], state: 'closed' }),
      ),
      'done',
    );
  });

  it('classifies blocked', () => {
    assert.equal(
      classifyStory(story(1, { labels: [AGENT_LABELS.BLOCKED] })),
      'blocked',
    );
  });

  it('classifies executing for both executing and closing labels', () => {
    assert.equal(
      classifyStory(story(1, { labels: [AGENT_LABELS.EXECUTING] })),
      'executing',
    );
    assert.equal(
      classifyStory(story(1, { labels: [AGENT_LABELS.CLOSING] })),
      'executing',
    );
  });

  it('classifies an unlabelled open Story as ready', () => {
    assert.equal(classifyStory(story(1)), 'ready');
  });
});

describe('lib/wave-runner/ready-set — storyFootprint & storiesOverlap', () => {
  it('reads the string-array `files` shape', () => {
    const fp = storyFootprint({ files: ['a.js', 'b.js'] });
    assert.deepEqual([...fp].sort(), ['a.js', 'b.js']);
  });

  it('reads the object-array `{ path }` shape and trims/drops blanks', () => {
    const fp = storyFootprint({
      changes: [{ path: ' lib/x.js ' }, { path: '' }, 'lib/y.js', 42],
    });
    assert.deepEqual([...fp].sort(), ['lib/x.js', 'lib/y.js']);
  });

  it('overlaps when footprints share a path', () => {
    assert.equal(
      storiesOverlap({ files: ['a.js', 'b.js'] }, { files: ['b.js', 'c.js'] }),
      true,
    );
  });

  it('does not overlap on disjoint footprints', () => {
    assert.equal(
      storiesOverlap({ files: ['a.js'] }, { files: ['b.js'] }),
      false,
    );
  });

  it('treats an empty footprint on either side as no overlap', () => {
    assert.equal(storiesOverlap({ files: [] }, { files: ['b.js'] }), false);
    assert.equal(storiesOverlap({ files: ['a.js'] }, {}), false);
  });
});

describe('lib/wave-runner/ready-set — planReadySet dependency gating', () => {
  // Acceptance: Given a graph where Story C depends only on Story A,
  // planReadySet includes C as soon as A is in the done set, even when an
  // unrelated Story B is not in it. (No false barrier.)
  it('selects C (deps only on A) once A is done, while unrelated B is still pending', () => {
    const A = story(1, { labels: [AGENT_LABELS.DONE] });
    const B = story(2); // unrelated, not done, not a dependency of C
    const C = story(3, { dependsOn: [1] });

    const selected = dispatchSet({
      stories: [A, B, C],
      inFlight: 0,
      globalCap: 5,
    });

    // C must be present; A is done (not re-selected); B is independently ready.
    assert.ok(ids(selected).includes(3), 'C should be ready once A is done');
    assert.ok(!ids(selected).includes(1), 'done A is never re-selected');
    // The pending unrelated B must not act as a barrier for C.
    assert.deepEqual(ids(selected), [2, 3]);
  });

  it('withholds a Story until every dependency is in the done set', () => {
    const A = story(1, { labels: [AGENT_LABELS.DONE] });
    const B = story(2); // not done
    const C = story(3, { dependsOn: [1, 2] }); // needs BOTH A and B

    const selected = dispatchSet({
      stories: [A, B, C],
      inFlight: 0,
      globalCap: 5,
    });

    // C still blocked on B; only the independently-ready B is selected.
    assert.deepEqual(ids(selected), [2]);
  });

  it('honours caller-supplied doneIds in addition to live-done records', () => {
    // A is not in the record set at all; the caller asserts it is done.
    const C = story(3, { dependsOn: [1] });
    const selected = dispatchSet({
      stories: [C],
      doneIds: [1],
      inFlight: 0,
      globalCap: 5,
    });
    assert.deepEqual(ids(selected), [3]);
  });

  it('treats an absent (foreign, not-done) dependency as a barrier', () => {
    // C depends on 99, which is neither in the set nor in doneIds.
    const C = story(3, { dependsOn: [99] });
    const selected = dispatchSet({
      stories: [C],
      inFlight: 0,
      globalCap: 5,
    });
    assert.deepEqual(ids(selected), []);
  });

  it('never selects done / blocked / executing Stories', () => {
    const done = story(1, { labels: [AGENT_LABELS.DONE] });
    const blocked = story(2, { labels: [AGENT_LABELS.BLOCKED] });
    const executing = story(3, { labels: [AGENT_LABELS.EXECUTING] });
    const ready = story(4);

    const selected = dispatchSet({
      stories: [done, blocked, executing, ready],
      inFlight: 0,
      globalCap: 10,
    });
    assert.deepEqual(ids(selected), [4]);
  });
});

describe('lib/wave-runner/ready-set — planReadySet dropForeign policy', () => {
  // The default (dropForeign:false) keeps a foreign dependency as a gate —
  // the standalone / operator-DAG contract (see the "absent foreign
  // dependency as a barrier" test above). The Epic path opts into
  // dropForeign:true so a `blocked by #N` whose target is out-of-scope (a
  // foreign id or a typo) is pruned rather than treated as a permanent
  // unsatisfiable gate that would silently strand the dependent.
  it('dropForeign:true prunes a foreign dependency so the dependent becomes schedulable', () => {
    const C = story(3, { dependsOn: [99] }); // 99 is not in scope
    const selected = dispatchSet({
      stories: [C],
      inFlight: 0,
      globalCap: 5,
      dropForeign: true,
    });
    assert.deepEqual(ids(selected), [3]);
  });

  it('dropForeign:true still gates on an IN-scope, not-done dependency', () => {
    // Pruning is limited to foreign edges — a sibling dependency that is in
    // scope and not yet done must still withhold the dependent.
    const A = story(1); // in scope, not done
    const C = story(3, { dependsOn: [1] });
    const selected = dispatchSet({
      stories: [A, C],
      inFlight: 0,
      globalCap: 5,
      dropForeign: true,
    });
    // Only the independently-ready A is selected; C waits on in-scope A.
    assert.deepEqual(ids(selected), [1]);
  });

  it('defaults to dropForeign:false — a foreign dependency stays a barrier', () => {
    const C = story(3, { dependsOn: [99] });
    const selected = dispatchSet({ stories: [C], globalCap: 5 });
    assert.deepEqual(ids(selected), []);
  });
});

describe('lib/wave-runner/ready-set — planReadySet capacity', () => {
  // Acceptance: planReadySet never returns more than (globalCap - inFlight).
  it('never returns more than globalCap - inFlight stories', () => {
    const stories = [story(1), story(2), story(3), story(4), story(5)];
    const selected = dispatchSet({
      stories,
      inFlight: 2,
      globalCap: 4,
    });
    // 4 - 2 = 2 slots; five are ready but only two may go.
    assert.equal(selected.length, 2);
    // Deterministic: lowest ids first.
    assert.deepEqual(ids(selected), [1, 2]);
  });

  it('returns an empty set when inFlight has saturated globalCap', () => {
    const stories = [story(1), story(2)];
    assert.deepEqual(dispatchSet({ stories, inFlight: 3, globalCap: 3 }), []);
    assert.deepEqual(dispatchSet({ stories, inFlight: 5, globalCap: 3 }), []);
  });

  it('returns an empty set for a non-positive or missing globalCap', () => {
    const stories = [story(1)];
    assert.deepEqual(dispatchSet({ stories, globalCap: 0 }), []);
    assert.deepEqual(dispatchSet({ stories }), []);
  });
});

describe('lib/wave-runner/ready-set — planReadySet file-overlap guard', () => {
  // Acceptance: Two ready stories whose file footprints overlap are never
  // both returned in one dispatch set; one is withheld until the other clears.
  it('never returns two overlapping-footprint stories in one set', () => {
    const A = story(1, { files: ['lib/shared.js', 'lib/a.js'] });
    const B = story(2, { files: ['lib/shared.js', 'lib/b.js'] }); // overlaps A
    const C = story(3, { files: ['lib/c.js'] }); // disjoint

    const selected = dispatchSet({
      stories: [A, B, C],
      inFlight: 0,
      globalCap: 10,
    });

    const picked = ids(selected);
    // A (lowest id) is admitted; B is withheld for the overlap; C is disjoint.
    assert.deepEqual(picked, [1, 3]);
    // Assert the invariant directly: no two selected stories overlap.
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        assert.equal(
          storiesOverlap(selected[i], selected[j]),
          false,
          `selected ${selected[i].id} and ${selected[j].id} must not overlap`,
        );
      }
    }
  });

  it('admits the withheld story on a later beat once its peer has cleared', () => {
    const A = story(1, { files: ['lib/shared.js'] });
    const B = story(2, { files: ['lib/shared.js'] });

    // Beat 1: A and B both ready & overlapping → only A goes.
    const beat1 = dispatchSet({
      stories: [A, B],
      inFlight: 0,
      globalCap: 10,
    });
    assert.deepEqual(ids(beat1), [1]);

    // Beat 2: A has closed (done); B is now free of its overlapping peer.
    const Adone = story(1, {
      labels: [AGENT_LABELS.DONE],
      files: ['lib/shared.js'],
    });
    const beat2 = dispatchSet({
      stories: [Adone, B],
      inFlight: 0,
      globalCap: 10,
    });
    assert.deepEqual(ids(beat2), [2]);
  });

  it('does not withhold stories that declare no footprint', () => {
    // Two footprint-less stories never collide → both selected.
    const A = story(1);
    const B = story(2);
    const selected = dispatchSet({
      stories: [A, B],
      inFlight: 0,
      globalCap: 10,
    });
    assert.deepEqual(ids(selected), [1, 2]);
  });
});

describe('lib/wave-runner/ready-set — planReadySet edge cases', () => {
  it('returns an empty set for an empty / missing story list', () => {
    assert.deepEqual(dispatchSet({ stories: [], globalCap: 5 }), []);
    assert.deepEqual(dispatchSet({ globalCap: 5 }), []);
    assert.deepEqual(dispatchSet(), []);
  });
});

describe('storiesOverlap — glob footprints fail safe (Story #4540)', () => {
  const glob = { id: 1, dependsOn: [], files: ['.agents/scripts/lib/**'] };
  const exact = {
    id: 2,
    dependsOn: [],
    files: ['.agents/scripts/lib/story-adjacency.js'],
  };
  const unrelated = { id: 3, dependsOn: [], files: ['docs/README.md'] };

  it('a glob overlaps a path it would match — exact-string comparison missed this', () => {
    // storiesOverlap compares strings, so `lib/**` never equalled
    // `lib/story-adjacency.js` and the guard silently passed two Stories
    // that genuinely race the same file.
    assert.equal(storiesOverlap(glob, exact), true);
  });

  it('a glob overlaps everything — unknown width is not no width', () => {
    assert.equal(storiesOverlap(glob, unrelated), true);
    assert.equal(storiesOverlap(unrelated, glob), true);
  });

  it('exact footprints keep their precise semantics', () => {
    assert.equal(storiesOverlap(exact, unrelated), false);
    assert.equal(
      storiesOverlap(exact, { id: 4, files: [exact.files[0]] }),
      true,
    );
  });

  it('an undeclared footprint is still never withheld', () => {
    // Permissive by necessity: withholding on absence would serialize
    // every run, since most Stories declare nothing.
    assert.equal(storiesOverlap({ id: 5, files: [] }, glob), false);
    assert.equal(storiesOverlap(glob, { id: 5 }), false);
  });

  it('a glob-bearing Story is not co-dispatched with anything', () => {
    const ready = dispatchSet({
      stories: [glob, exact, unrelated],
      doneIds: new Set(),
      inFlight: 0,
      globalCap: 5,
    }).map((s) => s.id);
    assert.deepEqual(ready, [1], 'the glob Story takes the beat alone');
  });
});

// ---------------------------------------------------------------------------
// Story #4875 — the overlap guard de-conflicts on evidence, not declaration
// ---------------------------------------------------------------------------

describe('the widened footprint — a declaration is only a lower bound', () => {
  /** A Story whose only signal is the path its text names. */
  const mentions = (id, body) => story(id, { body });

  it('picks up repo-relative paths named in the title as well as the body', () => {
    const titled = {
      id: 1,
      labels: [],
      state: 'open',
      title: 'Fix .agents/scripts/lib/wave-runner/ready-set.js',
    };
    const declared = story(2, {
      files: ['.agents/scripts/lib/wave-runner/ready-set.js'],
    });
    assert.equal(storiesOverlap(titled, declared), true);
    assert.equal(
      storiesOverlap(
        mentions(3, 'the caller in `bin/mandrel.js`'),
        story(4, { files: ['bin/mandrel.js'] }),
      ),
      true,
      'a backticked path in prose is still a path',
    );
  });

  it('does not mistake prose, bare words, or versions for paths', () => {
    const prose = mentions(
      1,
      'Bump to 2.24.0 and re-run npm test. See the wave runner. 99.9% done.',
    );
    assert.equal(
      storiesOverlap(prose, story(2, { files: ['lib/a.js'] })),
      false,
    );
    assert.equal(storiesOverlap(prose, mentions(3, 'also 2.24.0')), false);
  });

  it('is total — absent / non-string text is simply no evidence', () => {
    const junk = { id: 1, labels: [], state: 'open', body: 42, title: null };
    assert.equal(
      storiesOverlap(junk, story(2, { files: ['lib/a.js'] })),
      false,
    );
  });

  it('widens rather than replaces: the declaration still collides on its own', () => {
    const a = story(1, { files: ['lib/declared.js'], body: 'no paths here' });
    const b = story(2, { files: ['lib/declared.js'], body: 'nor here' });
    assert.equal(storiesOverlap(a, b), true);
    assert.deepEqual([...storyFootprint(a)], ['lib/declared.js']);
  });
});

describe('storiesOverlap — real edits collide even when declarations do not (AC-4, AC-5)', () => {
  it('withholds two Stories whose declared footprints are disjoint but whose text collides', () => {
    const a = story(1, { files: ['lib/a.js'] });
    const b = story(2, {
      files: ['lib/b.js'],
      body: 'The fix also has to change lib/a.js to keep the caller honest.',
    });
    assert.equal(storiesOverlap(a, b), true);
    assert.equal(storiesOverlap(b, a), true, 'the guard is symmetric');
  });

  it('still co-dispatches Stories with no collision in declaration OR evidence', () => {
    const a = story(1, { files: ['lib/a.js'], body: 'touches lib/a.js only' });
    const b = story(2, { files: ['lib/b.js'], body: 'touches lib/b.js only' });
    assert.equal(storiesOverlap(a, b), false);
  });

  it('a glob in the EVIDENCE is not a path — only declared width fails safe', () => {
    // Prose globs are narrative ("everything under .agents/**"), so the
    // scraper never emits one; the declared-glob rule is untouched.
    const a = story(1, { files: ['lib/a.js'] });
    const b = story(2, { files: ['lib/b.js'], body: 'sweeps .agents/**' });
    assert.equal(storiesOverlap(a, b), false);
    assert.equal(storiesOverlap(story(3, { files: ['lib/**'] }), a), true);
  });

  it('a Story with no declaration and no path evidence is never withheld', () => {
    const bare = story(1, { body: 'do the thing' });
    assert.equal(
      storiesOverlap(bare, story(2, { files: ['lib/a.js'] })),
      false,
    );
  });

  it('the scheduler withholds the evidence-colliding Story from the same beat', () => {
    const stories = [
      story(1, { files: ['lib/a.js'] }),
      story(2, {
        files: ['lib/b.js'],
        body: 'the caller in lib/a.js changes shape',
      }),
      story(3, { files: ['lib/c.js'] }),
    ];
    assert.deepEqual(
      ids(dispatchSet({ stories, globalCap: 5 })),
      [1, 3],
      '#2 races #1 on lib/a.js despite declaring only lib/b.js',
    );
  });
});

// ---------------------------------------------------------------------------
// Story #4950 — the overlap guard RESERVES in-flight footprints
// ---------------------------------------------------------------------------

describe('planReadySet — in-flight footprints are reserved, not just counted', () => {
  /** A Story already dispatched on an earlier beat and still implementing. */
  const inFlight = (id, opts) =>
    story(id, { ...opts, labels: [AGENT_LABELS.EXECUTING] });

  it('withholds a candidate whose footprint overlaps an in-flight Story (AC-1)', () => {
    // The cross-beat window: #2 was admitted on an earlier beat and is still
    // implementing. Before #4950 it only shrank the slot count, so #1 was
    // admitted onto a branch racing it for lib/shared.js.
    const held = inFlight(2, { files: ['lib/shared.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [story(1, { files: ['lib/shared.js', 'lib/a.js'] }), held],
      inFlight: 1,
      globalCap: 3,
      inFlightRecords: [held],
    });

    assert.deepEqual(ids(selected), []);
    assert.deepEqual(withheldByInFlight, [{ id: 1, blockedBy: 2 }]);
  });

  it('is not merely the same-beat check: nothing was admitted this beat', () => {
    // `selected` is empty when the reservation fires, so no already-admitted
    // peer could explain the withholding — only the in-flight record can.
    const held = inFlight(9, { files: ['lib/shared.js'] });
    const { selected } = planReadySet({
      stories: [story(1, { files: ['lib/shared.js'] }), held],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(selected, []);
  });

  it('reserves the WIDENED footprint, not just the in-flight declaration', () => {
    // The in-flight Story declared lib/b.js but its own text names lib/a.js —
    // the same lower-bound problem #4875 fixed for the same-beat comparison.
    const held = inFlight(2, {
      files: ['lib/b.js'],
      body: 'The fix also has to change lib/a.js to keep the caller honest.',
    });
    const { withheldByInFlight } = planReadySet({
      stories: [story(1, { files: ['lib/a.js'] }), held],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(withheldByInFlight, [{ id: 1, blockedBy: 2 }]);
  });

  it('admits a candidate whose footprint is disjoint from every in-flight one', () => {
    const held = inFlight(9, { files: ['lib/held.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [story(1, { files: ['lib/a.js'] }), held],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), [1]);
    assert.deepEqual(withheldByInFlight, []);
  });

  it('reports every reservation-withheld Story, each with its blocker (AC-4)', () => {
    const heldA = inFlight(8, { files: ['lib/a.js'] });
    const heldB = inFlight(9, { files: ['lib/b.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [
        story(1, { files: ['lib/a.js'] }),
        story(2, { files: ['lib/b.js'] }),
        story(3, { files: ['lib/c.js'] }),
        heldA,
        heldB,
      ],
      inFlight: 2,
      globalCap: 5,
      inFlightRecords: [heldA, heldB],
    });
    assert.deepEqual(ids(selected), [3]);
    assert.deepEqual(withheldByInFlight, [
      { id: 1, blockedBy: 8 },
      { id: 2, blockedBy: 9 },
    ]);
  });

  it('keeps admission deterministic and ascending-id under reservation (AC-3)', () => {
    const held = inFlight(7, { files: ['lib/b.js'] });
    const stories = [
      story(5, { files: ['lib/e.js'] }),
      story(2, { files: ['lib/b.js'] }), // reserved by #7
      story(4, { files: ['lib/d.js'] }),
      held,
    ];
    // Input order is shuffled; the result is not.
    const first = planReadySet({
      stories,
      inFlight: 1,
      globalCap: 9,
      inFlightRecords: [held],
    });
    const second = planReadySet({
      stories: [...stories].reverse(),
      inFlight: 1,
      globalCap: 9,
      inFlightRecords: [held],
    });
    assert.deepEqual(
      first.selected.map((r) => r.id),
      [4, 5],
      'ascending id, not input order',
    );
    assert.deepEqual(
      first.selected.map((r) => r.id),
      second.selected.map((r) => r.id),
    );
    assert.deepEqual(first.withheldByInFlight, second.withheldByInFlight);
  });

  it('re-admits a withheld Story once its blocker leaves the in-flight set (AC-3)', () => {
    const A = story(1, { files: ['lib/shared.js'] });

    // Beat 1: #9 holds lib/shared.js → #1 is withheld and named.
    const held = inFlight(9, { files: ['lib/shared.js'] });
    const beat1 = planReadySet({
      stories: [A, held],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(beat1.selected), []);
    assert.deepEqual(beat1.withheldByInFlight, [{ id: 1, blockedBy: 9 }]);

    // Beat 2: #9 has landed, so it is no longer in flight. Nothing about #1
    // changed — eligibility was never lost, only deferred.
    const landed = story(9, {
      labels: [AGENT_LABELS.DONE],
      files: ['lib/shared.js'],
    });
    const beat2 = planReadySet({
      stories: [A, landed],
      inFlight: 0,
      globalCap: 5,
      inFlightRecords: [],
    });
    assert.deepEqual(ids(beat2.selected), [1]);
    assert.deepEqual(beat2.withheldByInFlight, []);
  });

  it('never withholds on an empty footprint, on either side (AC-3)', () => {
    // Withholding on absence would serialize every run: most Stories declare
    // nothing, so "unknown" must stay permissive on BOTH sides of the compare.
    const bareHeld = inFlight(9);
    const bareCandidate = planReadySet({
      stories: [story(1), bareHeld],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [bareHeld],
    });
    assert.deepEqual(ids(bareCandidate.selected), [1]);
    assert.deepEqual(bareCandidate.withheldByInFlight, []);

    // A footprint-bearing candidate against a footprint-less in-flight Story.
    const declaredHeld = inFlight(9, { files: ['lib/a.js'] });
    const noFootprint = planReadySet({
      stories: [story(1), declaredHeld],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [declaredHeld],
    });
    assert.deepEqual(ids(noFootprint.selected), [1]);

    // And the mirror: a declared candidate against a bare in-flight Story.
    const bareBlocker = planReadySet({
      stories: [story(1, { files: ['lib/a.js'] }), bareHeld],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [bareHeld],
    });
    assert.deepEqual(ids(bareBlocker.selected), [1]);
  });

  it('does NOT let an in-flight glob footprint reserve anything (Story #4960)', () => {
    // #4950 shipped this as "unknown width fails safe across beats too", and
    // it inverted the throughput goal: an in-flight window spans a whole
    // implementation, so one glob withheld every other Story for minutes to
    // hours. The beat-local fail-safe is unchanged (see the case below); only
    // the cross-beat RESERVATION is exempt.
    const held = inFlight(9, { files: ['.agents/scripts/lib/**'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [
        story(1, { files: ['.agents/scripts/lib/story-adjacency.js'] }),
        story(2, { files: ['docs/README.md'] }),
        held,
      ],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), [1, 2]);
    assert.deepEqual(withheldByInFlight, []);
  });

  it('never lets a Story reserve against itself', () => {
    // Probe mode passes the whole record set, and a defensive caller may list
    // a Story in both arguments. A Story overlaps itself trivially, so a naive
    // comparison would withhold every candidate forever.
    const A = story(1, { files: ['lib/a.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [A],
      inFlight: 0,
      globalCap: 5,
      inFlightRecords: [A],
    });
    assert.deepEqual(ids(selected), [1]);
    assert.deepEqual(withheldByInFlight, []);
  });

  it('is total: absent, non-array, or unidentifiable in-flight records', () => {
    const stories = [story(1, { files: ['lib/a.js'] })];
    for (const inFlightRecords of [undefined, null, 'nope', 42]) {
      const { selected, withheldByInFlight } = planReadySet({
        stories,
        globalCap: 5,
        inFlightRecords,
      });
      assert.deepEqual(ids(selected), [1]);
      assert.deepEqual(withheldByInFlight, []);
    }
    // A record with no usable id cannot be NAMED as a blocker, so it does not
    // withhold — an unexplained empty slot is the failure this report exists
    // to remove.
    const anonymous = planReadySet({
      stories,
      globalCap: 5,
      inFlightRecords: [{ files: ['lib/a.js'] }],
    });
    assert.deepEqual(ids(anonymous.selected), [1]);
  });

  it('reports an in-flight blocker rather than the same-beat peer', () => {
    // #2 races BOTH #1 (admitted this beat) and #9 (in flight). It is withheld
    // either way; naming the longer-lived blocker keeps the report complete.
    const held = inFlight(9, { files: ['lib/shared.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [
        story(1, { files: ['lib/shared.js', 'lib/a.js'] }),
        story(2, { files: ['lib/a.js', 'lib/shared.js'] }),
        held,
      ],
      inFlight: 1,
      globalCap: 5,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), []);
    assert.deepEqual(withheldByInFlight, [
      { id: 1, blockedBy: 9 },
      { id: 2, blockedBy: 9 },
    ]);
  });

  it('reserves nothing when the caller supplies no records (flag-mode parity)', () => {
    // Flag mode holds ids and a count, never records. Behaviour there is the
    // pre-#4950 same-beat-only guard, unchanged.
    const { selected, withheldByInFlight } = planReadySet({
      stories: [story(1, { files: ['lib/shared.js'] })],
      inFlight: 1,
      globalCap: 3,
    });
    assert.deepEqual(ids(selected), [1]);
    assert.deepEqual(withheldByInFlight, []);
  });

  it('still withholds a same-beat peer when no reservation applies', () => {
    const { selected, withheldByInFlight } = planReadySet({
      stories: [
        story(1, { files: ['lib/shared.js'] }),
        story(2, { files: ['lib/shared.js'] }),
      ],
      globalCap: 5,
      inFlightRecords: [],
    });
    assert.deepEqual(ids(selected), [1]);
    assert.deepEqual(
      withheldByInFlight,
      [],
      'a same-beat skip is NOT reported as an in-flight reservation',
    );
  });

  it('reports nothing for a Story never considered because the cap ran out', () => {
    // A Story below the slot line was not withheld by a reservation — it was
    // simply not reached. Reporting it would misattribute the empty slot.
    const held = inFlight(9, { files: ['lib/held.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: [
        story(1, { files: ['lib/a.js'] }),
        story(2, { files: ['lib/held.js'] }),
        held,
      ],
      inFlight: 2,
      globalCap: 3,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), [1], '1 slot left, #1 takes it');
    assert.deepEqual(withheldByInFlight, [], '#2 was never reached');
  });
});

// ---------------------------------------------------------------------------
// Story #4960 — glob/UNKNOWN serializes a BEAT, never a run
// ---------------------------------------------------------------------------

describe('planReadySet — unknown width is beat-local, concrete width reserves', () => {
  const inFlight = (id, opts) =>
    story(id, { ...opts, labels: [AGENT_LABELS.EXECUTING] });

  /** Three eligible Stories with pairwise-disjoint concrete footprints. */
  const eligible = () => [
    story(11, { files: ['lib/a.js'] }),
    story(12, { files: ['lib/b.js'] }),
    story(13, { files: ['lib/c.js'] }),
  ];

  it('a glob in flight no longer withholds the whole run (the #4950 regression)', () => {
    // The reproduced regression: three eligible Stories, one glob-footprint
    // Story in flight, and the beat selected NOTHING — for that blocker's
    // entire implementation window.
    const held = inFlight(10, { files: ['.agents/scripts/**'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: eligible(),
      inFlight: 1,
      globalCap: 4,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), [11, 12, 13]);
    assert.deepEqual(withheldByInFlight, []);
  });

  it('the UNKNOWN sentinel an unparseable body yields reserves nothing either', () => {
    // `resolve-stories.js` substitutes `['**']` for a body it cannot parse.
    // Reserving on that let ONE malformed Story body collapse an N-Story run
    // to fully serial.
    const held = inFlight(10, { files: ['**'] });
    assert.deepEqual(
      ids(
        dispatchSet({
          stories: eligible(),
          inFlight: 1,
          globalCap: 4,
          inFlightRecords: [held],
        }),
      ),
      [11, 12, 13],
    );
  });

  it('a candidate declaring a glob is not withheld by a concrete reservation', () => {
    // The exemption is a property of the glob CLASS, not of which side it sits
    // on: an unknown-width candidate names no file the in-flight Story holds.
    const held = inFlight(10, { files: ['lib/b.js'] });
    assert.deepEqual(
      ids(
        dispatchSet({
          stories: [story(14, { files: ['lib/**'] })],
          inFlight: 1,
          globalCap: 4,
          inFlightRecords: [held],
        }),
      ),
      [14],
    );
  });

  it('a glob in the SAME beat still overlaps everything (fail-safe unchanged)', () => {
    // A beat is a moment, not a window: co-admitting two Stories whose real
    // widths are unknown is exactly the collision the guard exists to stop.
    assert.deepEqual(
      ids(
        dispatchSet({
          stories: [story(9, { files: ['**'] }), ...eligible()],
          globalCap: 4,
        }),
      ),
      [9],
      'the glob Story takes the beat alone',
    );
  });

  it('a concrete overlap still reserves across beats, exactly as #4950 shipped', () => {
    const held = inFlight(10, { files: ['lib/b.js'] });
    const { selected, withheldByInFlight } = planReadySet({
      stories: eligible(),
      inFlight: 1,
      globalCap: 4,
      inFlightRecords: [held],
    });
    assert.deepEqual(ids(selected), [11, 13]);
    assert.deepEqual(withheldByInFlight, [{ id: 12, blockedBy: 10 }]);
  });

  it('a concrete path the candidate only names in PROSE still reserves', () => {
    // The widened footprint (Story #4875) feeds the reservation too — only the
    // glob arm is exempt, not the evidence arm.
    const held = inFlight(10, { files: ['lib/held.js'] });
    const { withheldByInFlight } = planReadySet({
      stories: [
        story(11, {
          files: ['lib/a.js'],
          body: 'the caller in lib/held.js changes shape',
        }),
      ],
      inFlight: 1,
      globalCap: 4,
      inFlightRecords: [held],
    });
    assert.deepEqual(withheldByInFlight, [{ id: 11, blockedBy: 10 }]);
  });
});
