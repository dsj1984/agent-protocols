import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGraph,
  computeReachability,
} from '../../.agents/scripts/lib/Graph.js';
import {
  __test,
  autoSerializeOverlaps,
  computeStoryWaves,
} from '../../.agents/scripts/lib/orchestration/dependency-analyzer.js';

test('dependency-analyzer: autoSerializeOverlaps basic', () => {
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A'], dependsOn: [], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const manifest = { tasks };

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(
    manifest,
    adjacency,
  );

  assert.ok(graphMutated);
  assert.deepEqual(tasks[1].dependsOn, [1]);
  assert.ok(finalAdjacency.get(2).includes(1));
});

test('dependency-analyzer: autoSerializeOverlaps no overlap', () => {
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['B'], dependsOn: [], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const manifest = { tasks };

  const { finalAdjacency: _finalAdjacency, graphMutated } =
    autoSerializeOverlaps(manifest, adjacency);

  assert.ok(!graphMutated);
  assert.deepEqual(tasks[1].dependsOn, []);
});

test('dependency-analyzer: autoSerializeOverlaps avoids duplicates', () => {
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A'], dependsOn: [1], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const manifest = { tasks };

  const { finalAdjacency: _finalAdjacency, graphMutated } =
    autoSerializeOverlaps(manifest, adjacency);

  assert.ok(!graphMutated);
  assert.deepEqual(tasks[1].dependsOn, [1]);
});

test('dependency-analyzer: autoSerializeOverlaps multiple overlaps', () => {
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A', 'B'], dependsOn: [], scope: 'file' },
    { id: 3, focusAreas: ['B'], dependsOn: [], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const manifest = { tasks };

  const { finalAdjacency: _finalAdjacency, graphMutated } =
    autoSerializeOverlaps(manifest, adjacency);

  assert.ok(graphMutated);
  // 1 and 2 overlap on A -> 2 dependsOn 1
  // 1 and 3 don't overlap
  // 2 and 3 overlap on B -> 3 dependsOn 2
  assert.ok(tasks[0].dependsOn.length === 0);
  assert.deepEqual(tasks[0].dependsOn, []);
  assert.deepEqual(tasks[1].dependsOn, [1]);
  assert.deepEqual(tasks[2].dependsOn, [2]);
});

// ---------------------------------------------------------------------------
// Story-level focus-overlap serialization (v5.5.1)
// ---------------------------------------------------------------------------

function storyGroup(storyId, tasks) {
  return { storyId, storyTitle: `Story ${storyId}`, type: 'story', tasks };
}

test('computeStoryWaves: serializes stories with overlapping focus areas', () => {
  // Two stories with no cross-story dependencies but both touching the
  // same directory should land in different waves.
  const groups = new Map([
    [
      100,
      storyGroup(100, [
        { id: 1001, dependsOn: [], focusAreas: ['apps/api/media'] },
      ]),
    ],
    [
      200,
      storyGroup(200, [
        { id: 2001, dependsOn: [], focusAreas: ['apps/api/media'] },
      ]),
    ],
  ]);

  const waves = computeStoryWaves(groups, new Map());
  // Lower id runs first → story 100 is wave 0, story 200 is wave 1
  assert.strictEqual(waves.get(100), 0);
  assert.strictEqual(waves.get(200), 1);
});

test('computeStoryWaves: disjoint focus areas stay in same wave', () => {
  const groups = new Map([
    [100, storyGroup(100, [{ id: 1001, dependsOn: [], focusAreas: ['api'] }])],
    [200, storyGroup(200, [{ id: 2001, dependsOn: [], focusAreas: ['web'] }])],
  ]);

  const waves = computeStoryWaves(groups, new Map());
  assert.strictEqual(waves.get(100), 0);
  assert.strictEqual(waves.get(200), 0);
});

test('computeStoryWaves: stories without focus areas are not serialized', () => {
  // Missing focus data → should not assume overlap (avoids over-serialization).
  const groups = new Map([
    [100, storyGroup(100, [{ id: 1001, dependsOn: [] }])],
    [200, storyGroup(200, [{ id: 2001, dependsOn: [] }])],
  ]);

  const waves = computeStoryWaves(groups, new Map());
  assert.strictEqual(waves.get(100), 0);
  assert.strictEqual(waves.get(200), 0);
});

test('computeStoryWaves: global-scope story serializes after all others', () => {
  // Story 300 has a root-scoped task → treated as global, overlaps every
  // other story and runs in its own wave.
  const groups = new Map([
    [100, storyGroup(100, [{ id: 1001, dependsOn: [], focusAreas: ['api'] }])],
    [200, storyGroup(200, [{ id: 2001, dependsOn: [], focusAreas: ['web'] }])],
    [
      300,
      storyGroup(300, [
        { id: 3001, dependsOn: [], scope: 'root', focusAreas: [] },
      ]),
    ],
  ]);

  const waves = computeStoryWaves(groups, new Map());
  assert.strictEqual(waves.get(100), 0);
  assert.strictEqual(waves.get(200), 0);
  // 300 depends on 100 and 200 via global overlap → wave 1
  assert.strictEqual(waves.get(300), 1);
});

test('computeStoryWaves: existing dependency edge prevents redundant overlap edge', () => {
  // Story 200 already depends on 100 via cross-task dependency. The overlap
  // edge would also point 100 → 200, so should be a no-op.
  const groups = new Map([
    [
      100,
      storyGroup(100, [
        { id: 1001, dependsOn: [], focusAreas: ['apps/api/media'] },
      ]),
    ],
    [
      200,
      storyGroup(200, [
        { id: 2001, dependsOn: [1001], focusAreas: ['apps/api/media'] },
      ]),
    ],
  ]);

  const waves = computeStoryWaves(groups, new Map());
  assert.strictEqual(waves.get(100), 0);
  assert.strictEqual(waves.get(200), 1);
});

test('computeStoryWaves: five-way parallel contention resolves to linear chain', () => {
  // Reproduces the 2026-04-14 incident: five stories planned in parallel all
  // writing to the same focus area. Expected: exactly one per wave, in
  // ascending id order.
  const groups = new Map();
  for (const id of [302, 304, 307, 321, 347]) {
    groups.set(
      id,
      storyGroup(id, [
        {
          id: id * 10 + 1,
          dependsOn: [],
          focusAreas: ['apps/api/src/routes/v1/media'],
        },
      ]),
    );
  }

  const waves = computeStoryWaves(groups, new Map());
  assert.strictEqual(waves.get(302), 0);
  assert.strictEqual(waves.get(304), 1);
  assert.strictEqual(waves.get(307), 2);
  assert.strictEqual(waves.get(321), 3);
  assert.strictEqual(waves.get(347), 4);
});

test('dependency-analyzer: autoSerializeOverlaps reuses a pre-computed reachability matrix', () => {
  // When the caller has already computed reachability, the analyzer should
  // honour it rather than triggering another O(V·(V+E)) traversal. We prove
  // this by passing a sentinel matrix where A→B is already reachable,
  // suppressing the edge that would otherwise be emitted from focus overlap.
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A'], dependsOn: [], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const sentinel = new Map([
    [1, new Set([2])],
    [2, new Set()],
  ]);

  const { graphMutated, reachable } = autoSerializeOverlaps(
    { tasks },
    adjacency,
    { reachable: sentinel },
  );

  assert.equal(graphMutated, false, 'sentinel should suppress new edge');
  assert.equal(tasks[1].dependsOn.length, 0);
  assert.strictEqual(reachable, sentinel, 'reachable is echoed back');
});

test('dependency-analyzer: bucketed overlap matches the naive pairwise result', () => {
  // Sanity-check that the focus-area bucketing in _collectPendingEdges
  // produces the same edges the previous O(n²) pairwise scan would have.
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A', 'B'], dependsOn: [], scope: 'file' },
    { id: 3, focusAreas: ['B', 'C'], dependsOn: [], scope: 'file' },
    { id: 4, focusAreas: ['D'], dependsOn: [], scope: 'file' },
    { id: 5, focusAreas: [], dependsOn: [], scope: 'root' },
  ];
  const { adjacency } = buildGraph(tasks);

  // Expected pairs (lower-index-first):
  //   1↔2 (A), 2↔3 (B), 5↔everyone (scope: root)
  autoSerializeOverlaps({ tasks }, adjacency, {
    reachable: computeReachability(adjacency),
  });

  assert.deepEqual(tasks[1].dependsOn, [1]); // 2 depends on 1
  assert.deepEqual(tasks[2].dependsOn, [2]); // 3 depends on 2
  assert.deepEqual(tasks[3].dependsOn, []); // 4 has no overlap
  // 5 is globally-scoped → paired with 1, 2, 3, 4 (5's own id is higher)
  assert.deepEqual(
    [...tasks[4].dependsOn].sort((a, b) => a - b),
    [1, 2, 3, 4],
  );
});

test('rollUpStoryFocus: unions task focus areas and detects global scope', () => {
  const groups = new Map([
    [
      100,
      storyGroup(100, [
        { id: 1, focusAreas: ['a', 'b'] },
        { id: 2, focusAreas: ['b', 'c'] },
      ]),
    ],
    [200, storyGroup(200, [{ id: 3, scope: 'root', focusAreas: ['x'] }])],
    [300, storyGroup(300, [{ id: 4, focusAreas: ['*'] }])],
  ]);

  const rolled = __test.rollUpStoryFocus(groups);
  assert.deepEqual([...rolled.get(100).areas].sort(), ['a', 'b', 'c']);
  assert.strictEqual(rolled.get(100).global, false);
  assert.strictEqual(rolled.get(200).global, true);
  assert.strictEqual(rolled.get(300).global, true);
});
