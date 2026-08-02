/**
 * tests/scripts/resolve-stories.test.js — Story #4540.
 *
 * `/deliver` takes only Story ids; this resolver discovers the graph from
 * live state. Three of these tests pin defects a pre-mortem caught before
 * implementation — each would have shipped as a silent wedge or an
 * immediate crash:
 *
 *   1. `dag[].files` MUST be plain strings. `extractChangePaths` returns
 *      `{path, isGlob}` objects and `parseDag` rejects non-strings, so
 *      forwarding it verbatim fails every multi-Story run.
 *   2. The native-edge read MUST emit issue NUMBERS. The write path's
 *      helper returns database ids (its POST needs `issue_id`); reusing it
 *      builds an unsatisfiable dependency and wedges the run forever.
 *   3. The read MUST fail loud. A dropped read-side edge silently removes a
 *      dispatch gate — the inverse of the write path, where degrading is safe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildStoriesEnvelope,
  isSatisfiedBlocker,
  nativeBlockedByNumbers,
  parseIds,
  readNativeBlockedBy,
  storiesToDag,
  storyFootprintPaths,
  toStoryRecord,
} from '../../.agents/scripts/lib/orchestration/resolve-stories.js';
import {
  selectReadySet,
  storiesOverlap,
} from '../../.agents/scripts/lib/wave-runner/ready-set.js';
import { runResolveStories } from '../../.agents/scripts/resolve-stories.js';
import { parseDag } from '../../.agents/scripts/stories-wave-tick.js';

const REPO = { owner: 'dsj1984', repo: 'mandrel', issueNumber: 4534 };

/**
 * Stand-in sensitive-path manifest for the dispatchMode shape derivation —
 * injected so no test reads the repo's live `audit-rules.json` (whose
 * operator-editable globs would otherwise decide these assertions).
 */
const RULES = {
  sensitivePaths: {
    security: { filePatterns: ['**/auth/**'] },
  },
};

function storyBody({
  changes = ['.agents/scripts/a.js'],
  blockedBy = null,
} = {}) {
  const lines = [
    '## Goal',
    'Do the thing.',
    '',
    '## Changes',
    ...changes.map(
      (p) => `- {"path":"${p}","assumption":"refactors-existing"}`,
    ),
    '',
    '## Acceptance',
    '- [ ] it works',
    '',
    '## Verify',
    '- npm test (unit)',
  ];
  if (blockedBy) lines.push('', '---', `blocked by #${blockedBy}`);
  return lines.join('\n');
}

function issue(over = {}) {
  return {
    number: 101,
    title: 'A Story',
    body: storyBody(),
    labels: [{ name: 'type::story' }],
    state: 'open',
    ...over,
  };
}

describe('toStoryRecord — an id-scoped fetch errors rather than filtering', () => {
  it('maps a well-formed Story issue', () => {
    const rec = toStoryRecord(issue());
    assert.equal(rec.id, 101);
    assert.equal(rec.state, 'open');
    assert.deepEqual(rec.labels, ['type::story']);
  });

  it('hard-errors on a non-Story instead of silently dropping it', () => {
    // The label-scoped ancestor returned null here, which is right for
    // incidental query noise and wrong when the operator NAMED this id:
    // dropping it yields a partial envelope that under-delivers silently.
    assert.throws(
      () => toStoryRecord(issue({ labels: [] }), 101),
      /#101 is not a Story .*type::story tickets only/s,
    );
  });

  it('hard-errors on a surviving Epic footer, naming the Epic', () => {
    assert.throws(
      () => toStoryRecord(issue({ body: 'Epic: #4200\n\n## Goal\nx' })),
      /Epic: #4200.*Story-only/s,
    );
  });

  it('does not mistake prose mentioning an epic for a footer', () => {
    const rec = toStoryRecord(
      issue({
        body: `${storyBody()}\n\nThis relates to an Epic: #4200 loosely.`,
      }),
    );
    assert.equal(rec.id, 101);
  });
});

describe('isSatisfiedBlocker — what stops gating', () => {
  it('a closed issue is satisfied', () => {
    assert.equal(isSatisfiedBlocker({ state: 'closed', labels: [] }), true);
  });
  it('an open agent::done issue is satisfied', () => {
    assert.equal(
      isSatisfiedBlocker({ state: 'open', labels: [{ name: 'agent::done' }] }),
      true,
    );
  });
  it('an open in-progress issue still gates', () => {
    assert.equal(
      isSatisfiedBlocker({
        state: 'open',
        labels: [{ name: 'agent::executing' }],
      }),
      false,
    );
  });
});

describe('storyFootprintPaths — plain strings, never a crash', () => {
  it('emits plain path strings, not {path,isGlob} objects', () => {
    const paths = storyFootprintPaths(
      storyBody({ changes: ['a/b.js', 'c/d.js'] }),
      1,
    );
    assert.deepEqual(paths, ['a/b.js', 'c/d.js']);
    assert.ok(paths.every((p) => typeof p === 'string'));
  });

  it('never throws on an unparseable body — one bad body must not fail the whole resolution', () => {
    // These are live, human-editable issue bodies. (What it returns on that
    // path is the fail-safe contract asserted further down.)
    const warnings = [];
    assert.doesNotThrow(() =>
      storyFootprintPaths(
        '## Changes\n- a plain string bullet, not the object shape',
        7,
        (m) => warnings.push(m),
      ),
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /#7/);
  });
});

describe('the resolver envelope composes with the scheduler adapter', () => {
  it('parseDag accepts the resolver output verbatim (run-breaker #1)', () => {
    const env = buildStoriesEnvelope({
      stories: [toStoryRecord(issue())],
      injectedRules: RULES,
    });
    assert.ok(env.dag[0].files.every((f) => typeof f === 'string'));
    const { nodes, error } = parseDag(env.dag);
    assert.equal(
      error,
      null,
      'the two CLIs must compose; a {path,isGlob} footprint fails every N>1 run',
    );
    assert.equal(nodes[0].id, 101);
  });
});

describe('nativeBlockedByNumbers — issue numbers, not database ids (run-breaker #2)', () => {
  it('emits the issue number when id and number differ', () => {
    // The live shape observed on #4534 → #4530.
    const data = [
      {
        id: 4902374986,
        number: 4530,
        state: 'closed',
        repository_url: 'https://api.github.com/repos/dsj1984/mandrel',
      },
    ];
    assert.deepEqual(nativeBlockedByNumbers(data, REPO), [4530]);
  });

  it('rejects a cross-repo blocker rather than matching its number locally', () => {
    assert.throws(
      () =>
        nativeBlockedByNumbers(
          [
            {
              id: 1,
              number: 4530,
              repository_url: 'https://api.github.com/repos/other/repo',
            },
          ],
          REPO,
        ),
      /another repository/,
    );
  });

  it('dedupes and tolerates a non-array payload', () => {
    assert.deepEqual(nativeBlockedByNumbers(null, REPO), []);
    assert.deepEqual(
      nativeBlockedByNumbers([{ number: 5 }, { number: 5 }], REPO),
      [5],
    );
  });
});

describe('readNativeBlockedBy — fails loud (run-breaker #3)', () => {
  const parseJson = (r) => JSON.parse(r.stdout);

  it('returns the edges on success', async () => {
    const gh = {
      api: async () => ({ stdout: JSON.stringify([{ id: 9, number: 42 }]) }),
    };
    assert.deepEqual(
      await readNativeBlockedBy({ gh, ...REPO, parseJson }),
      [42],
    );
  });

  it('treats 404 as a legitimate empty result', async () => {
    const gh = {
      api: async () => {
        throw new Error('HTTP 404: Not Found');
      },
    };
    assert.deepEqual(await readNativeBlockedBy({ gh, ...REPO, parseJson }), []);
  });

  it('throws on 403 — a dropped edge would remove a real dispatch gate', async () => {
    // One 403 (dependencies API disabled, or a token missing the scope)
    // would otherwise erase EVERY native edge at once and co-dispatch the
    // whole run against unlanded blockers.
    const gh = {
      api: async () => {
        throw new Error('HTTP 403: Resource not accessible by integration');
      },
    };
    await assert.rejects(
      () => readNativeBlockedBy({ gh, ...REPO, parseJson }),
      /Refusing to continue.*dispatch gate/s,
    );
  });

  it('throws on a 5xx rather than degrading to no edges', async () => {
    const gh = {
      api: async () => {
        throw new Error('HTTP 502: Bad Gateway');
      },
    };
    await assert.rejects(
      () => readNativeBlockedBy({ gh, ...REPO, parseJson }),
      /Could not read native blocked_by/,
    );
  });
});

describe('storiesToDag — body and native edges union into one graph', () => {
  it('unions native edges with body-parsed ones', () => {
    const stories = [
      toStoryRecord(issue({ body: storyBody({ blockedBy: 55 }) })),
    ];
    const dag = storiesToDag(stories, new Map([[101, [66]]]));
    assert.deepEqual(
      dag[0].dependsOn.sort((a, b) => a - b),
      [55, 66],
    );
  });

  it('keeps a foreign edge as a real gate (dropForeign:false)', () => {
    const stories = [
      toStoryRecord(issue({ body: storyBody({ blockedBy: 4530 }) })),
    ];
    const dag = storiesToDag(stories);
    assert.deepEqual(dag[0].dependsOn, [4530]);
  });
});

describe('buildStoriesEnvelope — per-Story dispatchMode (Story #4722)', () => {
  // Story #4736 put a run-topology rule ahead of the shape read: a run
  // resolving ONE Story is inline whatever its shape. Every assertion about
  // the shape axis therefore needs a multi-Story set to reach that axis at
  // all — this filler Story is the second element, never the subject.
  const filler = () =>
    toStoryRecord(
      issue({ number: 99, body: storyBody({ changes: ['src/filler.js'] }) }),
    );

  it('AC-5: a lite-shaped body in a multi-Story set dispatches subagent (#4829)', () => {
    // One refactor + one acceptance criterion, no sensitive path: a
    // lite-shaped body — which USED to come back `inline` here. It cannot:
    // `inline` means the router's own session, and this set has a sibling that
    // may be dispatched on the same beat. The shape still decides ceremony;
    // it no longer decides where the engine runs.
    const env = buildStoriesEnvelope({
      stories: [toStoryRecord(issue({ number: 1 })), filler()],
      injectedRules: RULES,
    });
    assert.equal(env.stories[0].dispatchMode, 'subagent');
  });

  it('AC-4/AC-5: the route::lite label never routes — a full-shaped body dispatches subagent', () => {
    // Full-shaped by EFFORT since Story #4764: two deployables is clearly-epic
    // scope, where a mere file count no longer routes anything.
    const wide = storyBody({
      changes: ['apps/api/src/a.js', 'apps/web/src/b.js'],
    });
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(
          issue({
            number: 1,
            body: wide,
            labels: [{ name: 'type::story' }, { name: 'route::lite' }],
          }),
        ),
        filler(),
      ],
      injectedRules: RULES,
    });
    assert.equal(env.stories[0].dispatchMode, 'subagent');
  });

  it('AC-6: a sensitive-path footprint dispatches subagent even at lite width', () => {
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(
          issue({
            number: 1,
            body: storyBody({ changes: ['src/auth/session.js'] }),
            labels: [{ name: 'type::story' }, { name: 'route::lite' }],
          }),
        ),
        filler(),
      ],
      injectedRules: RULES,
    });
    assert.equal(env.stories[0].dispatchMode, 'subagent');
  });

  it('planning.complexityGate.enabled=false forces subagent dispatch', () => {
    const env = buildStoriesEnvelope({
      stories: [toStoryRecord(issue({ number: 1 })), filler()],
      config: { planning: { complexityGate: { enabled: false } } },
      injectedRules: RULES,
    });
    assert.equal(env.stories[0].dispatchMode, 'subagent');
  });
});

/**
 * Story #4736 — the resolver is where `/deliver` reads the dispatch decision,
 * so this is where the run-topology rule has to be true end to end: a
 * one-Story `--ids` list yields `inline`, and adding a sibling puts the shape
 * axis back in charge.
 */
describe('buildStoriesEnvelope — single-Story runs dispatch inline (Story #4736)', () => {
  // Full-shaped by effort (two deployables), not by file count — Story #4764.
  const wideBody = storyBody({
    changes: ['apps/api/src/a.js', 'apps/web/src/b.js'],
  });

  it('AC-1: a one-Story run is inline even for a full-shaped Story', () => {
    const env = buildStoriesEnvelope({
      stories: [toStoryRecord(issue({ number: 1, body: wideBody }))],
      injectedRules: RULES,
    });
    assert.equal(env.stories.length, 1);
    assert.equal(env.stories[0].dispatchMode, 'inline');
  });

  it('AC-1: the same Story in a two-Story run goes back to sub-agent dispatch', () => {
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(issue({ number: 1, body: wideBody })),
        toStoryRecord(issue({ number: 2, body: wideBody })),
      ],
      injectedRules: RULES,
    });
    assert.deepEqual(
      env.stories.map((s) => s.dispatchMode),
      ['subagent', 'subagent'],
      'concurrent siblings share a checkout — that is what the sub-agent isolates',
    );
  });

  it('counts the resolved set, not the undelivered remainder', () => {
    // A sibling that already landed still counts: the mode a caller reads for
    // a given `--ids` list must not flip mid-run as siblings finish.
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(issue({ number: 1, body: wideBody })),
        toStoryRecord(
          issue({
            number: 2,
            body: wideBody,
            state: 'closed',
            labels: [{ name: 'type::story' }, { name: 'agent::done' }],
          }),
        ),
      ],
      injectedRules: RULES,
    });
    assert.equal(env.stories[0].dispatchMode, 'subagent');
  });
});

/**
 * Story #4829 — the resolver's dispatch modes and the wave tick's ready set
 * are two answers to one run, and they must not contradict each other.
 *
 * Measured twice on 2026-07-29 (`/deliver 4824 4825`, `/deliver 4828 4829
 * 4830`): every Story resolved `inline` while the tick reported the whole set
 * ready under a cap of five. `inline` means the router's own session, so that
 * pair of answers instructs one session to run two — then three — engines over
 * one checkout. This asserts them TOGETHER, from one envelope, because
 * asserting either alone is exactly how the contradiction survived.
 */
describe('buildStoriesEnvelope ↔ ready set — one run, one consistent answer', () => {
  /** A lite-shaped body per Story, with a disjoint footprint so the
   *  overlap guard never masks the result by serialising the beat itself. */
  const liteStory = (number) =>
    toStoryRecord(
      issue({
        number,
        body: storyBody({ changes: [`src/feature-${number}.js`] }),
      }),
    );

  for (const ids of [
    [4824, 4825],
    [4828, 4829, 4830],
  ]) {
    it(`the measured ${ids.length}-Story run: no Story claims the session the tick fans out from`, () => {
      const stories = ids.map(liteStory);
      const env = buildStoriesEnvelope({ stories, injectedRules: RULES });

      // The tick's view of the same run: every Story ready, cap 5 — the
      // reported condition, reproduced rather than assumed.
      const ready = selectReadySet({
        stories: stories.map((s) => ({
          id: s.id,
          dependsOn: [],
          files: [`src/feature-${s.id}.js`],
        })),
        doneIds: new Set(),
        inFlight: 0,
        globalCap: 5,
      }).map((s) => s.id);
      assert.deepEqual(ready, ids, 'the measured ready set must reproduce');

      const inline = env.stories.filter((s) => s.dispatchMode === 'inline');
      assert.deepEqual(
        inline,
        [],
        `${ready.length} Stories are dispatchable on one beat, so none of them may be told to run in the router's single session`,
      );
    });
  }

  it('a one-Story run keeps inline — and its ready set is the one Story', () => {
    const stories = [liteStory(4829)];
    const env = buildStoriesEnvelope({ stories, injectedRules: RULES });
    const ready = selectReadySet({
      stories: [{ id: 4829, dependsOn: [], files: ['src/feature-4829.js'] }],
      doneIds: new Set(),
      inFlight: 0,
      globalCap: 5,
    });
    assert.equal(ready.length, 1);
    assert.equal(
      env.stories[0].dispatchMode,
      'inline',
      'a ready set of one and an inline verdict agree — that is the rule being preserved, not narrowed',
    );
  });
});

describe('buildStoriesEnvelope — done[] is what unlocks cross-run delivery', () => {
  it('reports an in-set landed Story as done', () => {
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(issue({ number: 1, state: 'closed' })),
        toStoryRecord(issue({ number: 2 })),
      ],
      injectedRules: RULES,
    });
    assert.deepEqual(env.done, [1]);
  });

  it('folds a foreign landed blocker into done[] so its dependent becomes ready', () => {
    // The headline capability: #4530 landed in a DIFFERENT plan run. Without
    // this, its dependent is withheld forever — the wedge that made
    // cross-run, over-time delivery structurally impossible.
    const stories = [
      toStoryRecord(
        issue({ number: 4534, body: storyBody({ blockedBy: 4530 }) }),
      ),
    ];
    const env = buildStoriesEnvelope({
      stories,
      foreignDone: [4530],
      injectedRules: RULES,
    });
    assert.deepEqual(env.dag[0].dependsOn, [4530]);
    assert.deepEqual(env.done, [4530]);
  });

  it('sorts stories and done for a stable envelope', () => {
    const env = buildStoriesEnvelope({
      stories: [
        toStoryRecord(issue({ number: 9, state: 'closed' })),
        toStoryRecord(issue({ number: 3, state: 'closed' })),
      ],
      injectedRules: RULES,
    });
    assert.deepEqual(
      env.stories.map((s) => s.id),
      [3, 9],
    );
    assert.deepEqual(env.done, [3, 9]);
  });
});

describe('parseIds', () => {
  it('parses and dedupes a csv', () => {
    assert.deepEqual(parseIds('101, 102,101'), [101, 102]);
  });
  it('rejects a non-numeric id', () => {
    assert.throws(() => parseIds('101,abc'), /positive issue numbers/);
  });
  it('rejects an empty list', () => {
    assert.throws(() => parseIds(''), /--ids is required/);
  });
  it('expands an inclusive dash range, as the operator types it', () => {
    assert.deepEqual(parseIds('4922-4925'), [4922, 4923, 4924, 4925]);
    assert.deepEqual(parseIds('4922 - 4924'), [4922, 4923, 4924]);
  });
  it('dedupes a range against the singles around it', () => {
    assert.deepEqual(parseIds('4920,4922-4924,4923'), [4920, 4922, 4923, 4924]);
  });
  it('rejects a backwards range instead of resolving nothing', () => {
    assert.throws(() => parseIds('4926-4922'), /low-to-high/);
  });
  it('names the caller flag in the error, so --stories does not report --ids', () => {
    assert.throws(() => parseIds('abc', '--stories'), /--stories must be/);
    assert.throws(() => parseIds('', '--stories'), /--stories is required/);
  });
});

describe('storyFootprintPaths — an unreadable footprint fails SAFE, not open', () => {
  it('an unparseable body yields a glob footprint, so the Story is never co-dispatched', () => {
    // Returning [] here would be fail-OPEN: the guard reads an empty
    // footprint as "overlaps nothing" and never withholds, so a Story whose
    // changes we could not read would silently race a genuine conflict.
    // Unknown width is not no width — the same argument that makes a glob
    // overlap everything applies to a body we failed to parse.
    const warnings = [];
    const paths = storyFootprintPaths(
      '## Changes\n- a plain string bullet, not the {path, assumption} shape',
      7,
      (m) => warnings.push(m),
    );
    assert.deepEqual(paths, ['**']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /#7/);
    assert.match(warnings[0], /unknown/i);
  });

  it('the unknown footprint actually withholds the Story from co-dispatch', () => {
    const unreadable =
      '## Changes\n- a plain string bullet, not the object shape';
    const unknown = {
      id: 1,
      dependsOn: [],
      files: storyFootprintPaths(unreadable, 1),
    };
    const other = { id: 2, dependsOn: [], files: ['docs/README.md'] };
    assert.equal(storiesOverlap(unknown, other), true);
    const ready = selectReadySet({
      stories: [unknown, other],
      doneIds: new Set(),
      inFlight: 0,
      globalCap: 5,
    }).map((s) => s.id);
    assert.deepEqual(ready, [1], 'the unreadable Story takes the beat alone');
  });

  it('a Story that genuinely declares NO changes keeps the permissive empty footprint', () => {
    // "Declares nothing" and "we could not read it" are different facts.
    // Withholding on the former would serialize every run.
    const body = [
      '## Goal',
      'g',
      '',
      '## Acceptance',
      '- [ ] a',
      '',
      '## Verify',
      '- npm test (unit)',
    ].join('\n');
    assert.deepEqual(storyFootprintPaths(body, 1), []);
  });
});

describe('runResolveStories — the injectable CLI flow core (Story #4842)', () => {
  const CONFIG = { github: { owner: 'dsj1984', repo: 'mandrel' } };

  function makeProvider(byId) {
    return {
      getTicket: async (id) => byId[id] ?? null,
      // readNativeEdges reaches gh through this seam; an empty payload
      // exercises the native branch without shape assumptions.
      _gh: { api: async () => ({ stdout: '[]' }) },
    };
  }

  function capture() {
    const chunks = [];
    return { write: (s) => chunks.push(s), text: () => chunks.join('') };
  }

  it('writes the compact single-line envelope with a trailing newline', async () => {
    const provider = makeProvider({
      101: issue(),
      102: issue({ number: 102, body: storyBody({ blockedBy: 101 }) }),
    });
    const out = capture();
    const code = await runResolveStories(
      { ids: '101,102', native: false },
      { provider, config: CONFIG, stdout: out },
    );
    assert.equal(code, 0);
    const text = out.text();
    assert.ok(text.endsWith('\n'), 'envelope line is newline-terminated');
    assert.equal(
      text.trimEnd().includes('\n'),
      false,
      'compact mode emits exactly one stdout line',
    );
    const envelope = JSON.parse(text);
    assert.equal(envelope.kind, 'stories');
    assert.deepEqual(
      envelope.stories.map((s) => s.id),
      [101, 102],
    );
    const node = envelope.dag.find((n) => n.id === 102);
    assert.deepEqual(node.dependsOn, [101]);
    assert.deepEqual(envelope.done, []);
  });

  it('pretty-prints the same envelope when asked', async () => {
    const provider = makeProvider({ 101: issue() });
    const out = capture();
    await runResolveStories(
      { ids: '101', native: false, pretty: true },
      { provider, config: CONFIG, stdout: out },
    );
    const text = out.text();
    assert.ok(text.includes('\n  '), 'pretty mode indents');
    assert.equal(JSON.parse(text).kind, 'stories');
  });

  it('a closed foreign blocker lands in done[]', async () => {
    const provider = makeProvider({
      101: issue({ body: storyBody({ blockedBy: 4000 }) }),
      4000: issue({ number: 4000, state: 'closed' }),
    });
    const out = capture();
    await runResolveStories(
      { ids: '101', native: false },
      { provider, config: CONFIG, stdout: out },
    );
    const envelope = JSON.parse(out.text());
    assert.deepEqual(envelope.done, [4000]);
  });

  it('reads native edges through the injected provider gh seam', async () => {
    const provider = makeProvider({ 101: issue() });
    const out = capture();
    await runResolveStories(
      { ids: '101' },
      { provider, config: CONFIG, stdout: out },
    );
    const envelope = JSON.parse(out.text());
    assert.deepEqual(envelope.dag.find((n) => n.id === 101).dependsOn, []);
  });
});
