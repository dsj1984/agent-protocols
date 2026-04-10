import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeChatDependencies,
  computeReachability,
  computeWaves,
  detectCycle,
  topologicalSort,
  transitiveReduction,
} from '../../.agents/scripts/lib/Graph.js';

test('Graph: detects cycles', () => {
  const adj = new Map([
    [1, [2]],
    [2, [3]],
    [3, [1]],
  ]);
  const cycle = detectCycle(adj);
  assert.ok(cycle.includes(1) && cycle.includes(2) && cycle.includes(3));
  assert.equal(cycle.length, 3);
});

test('Graph: transitive reduction removes redundant edges', () => {
  // 1 -> 2, 2 -> 3, 1 -> 3 (redundant)
  const adj = new Map([
    [1, [2, 3]],
    [2, [3]],
    [3, []],
  ]);
  const reduced = transitiveReduction(adj);
  assert.deepEqual(reduced.get(1), [2]);
  assert.deepEqual(reduced.get(2), [3]);
});

test('Graph: transitive reduction handles nodes with 0 or 1 dep', () => {
  const adj = new Map([
    [1, [2]],
    [2, []],
  ]);
  const reduced = transitiveReduction(adj);
  assert.deepEqual(reduced.get(1), [2]);
});

test('Graph: topological sort', () => {
  const adj = new Map([
    [1, [2]],
    [2, []],
  ]);
  const taskMap = new Map([
    [1, { id: 1, title: 'T1' }],
    [2, { id: 2, title: 'T2' }],
  ]);
  const sorted = topologicalSort(adj, taskMap);
  assert.equal(sorted[0].id, 2);
  assert.equal(sorted[1].id, 1);
});

test('Graph: topological sort throws on cycle', () => {
  const adj = new Map([
    [1, [2]],
    [2, [1]],
  ]);
  const taskMap = new Map([
    [1, { id: 1 }],
    [2, { id: 2 }],
  ]);
  assert.throws(() => topologicalSort(adj, taskMap), /detectCycle\(\) first/);
});

test('Graph: reachability', () => {
  const adj = new Map([
    [1, [2]],
    [2, [3]],
    [3, []],
  ]);
  const reachable = computeReachability(adj);
  assert.ok(reachable.get(1).has(3));
  assert.ok(reachable.get(1).has(2));
  assert.ok(!reachable.get(2).has(1));
});

test('Graph: compute waves', () => {
  const adj = new Map([
    [1, [2]],
    [2, []],
    [3, []],
  ]);
  const taskMap = new Map([
    [1, { id: 1 }],
    [2, { id: 2 }],
    [3, { id: 3 }],
  ]);
  const waves = computeWaves(adj, taskMap);
  assert.equal(waves.length, 2);
  assert.equal(waves[0].length, 2); // 2 and 3
  assert.equal(waves[1].length, 1); // 1
});

test('Graph: chat dependencies', () => {
  const sessions = [
    { chatNumber: 1, tasks: [{ id: 1, dependsOn: [] }] },
    { chatNumber: 2, tasks: [{ id: 2, dependsOn: [1] }] },
  ];
  const adj = new Map([
    [1, []],
    [2, [1]],
  ]);
  const chatDeps = computeChatDependencies(sessions, adj);
  assert.deepEqual(chatDeps.get(2), [1]);
});

test('Graph: chat dependencies skips same-session tasks', () => {
  const sessions = [
    {
      chatNumber: 1,
      tasks: [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [1] },
      ],
    },
  ];
  const adj = new Map([
    [1, []],
    [2, [1]],
  ]);
  const chatDeps = computeChatDependencies(sessions, adj);
  assert.deepEqual(chatDeps.get(1), []);
});
