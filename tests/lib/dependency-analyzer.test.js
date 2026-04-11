import assert from 'node:assert/strict';
import test from 'node:test';
import { autoSerializeOverlaps } from '../../.agents/scripts/lib/orchestration/dependency-analyzer.js';
import { buildGraph } from '../../.agents/scripts/lib/Graph.js';

test('dependency-analyzer: autoSerializeOverlaps basic', () => {
  const tasks = [
    { id: 1, focusAreas: ['A'], dependsOn: [], scope: 'file' },
    { id: 2, focusAreas: ['A'], dependsOn: [], scope: 'file' },
  ];
  const { adjacency } = buildGraph(tasks);
  const manifest = { tasks };

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(manifest, adjacency);

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

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(manifest, adjacency);

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

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(manifest, adjacency);

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

  const { finalAdjacency, graphMutated } = autoSerializeOverlaps(manifest, adjacency);

  assert.ok(graphMutated);
  // 1 and 2 overlap on A -> 2 dependsOn 1
  // 1 and 3 don't overlap
  // 2 and 3 overlap on B -> 3 dependsOn 2
  assert.ok(tasks[0].dependsOn.length === 0);
  assert.deepEqual(tasks[0].dependsOn, []);
  assert.deepEqual(tasks[1].dependsOn, [1]);
  assert.deepEqual(tasks[2].dependsOn, [2]);
});
