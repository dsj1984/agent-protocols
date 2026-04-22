import assert from 'node:assert';
import { test } from 'node:test';
import {
  buildTaskGraph,
  sortTasksByDependencies,
} from '../../../.agents/scripts/lib/story-init/task-graph-builder.js';

function mkTask(id, { body = '', title = `t${id}`, labels = ['type::task'] } = {}) {
  return { id, title, labels, body };
}

test('sortTasksByDependencies returns input unchanged for 0/1 tasks', () => {
  assert.deepStrictEqual(sortTasksByDependencies([]), []);
  const one = [mkTask(1)];
  assert.deepStrictEqual(sortTasksByDependencies(one), one);
});

test('sortTasksByDependencies honours blocked-by references between siblings', () => {
  const tasks = [
    mkTask(1, { body: 'blocked by #2' }),
    mkTask(2),
    mkTask(3, { body: 'blocked by #1' }),
  ];
  const sorted = sortTasksByDependencies(tasks);
  const order = sorted.map((t) => t.id);
  assert.ok(order.indexOf(2) < order.indexOf(1));
  assert.ok(order.indexOf(1) < order.indexOf(3));
});

test('sortTasksByDependencies throws on cycles', () => {
  const tasks = [
    mkTask(1, { body: 'blocked by #2' }),
    mkTask(2, { body: 'blocked by #1' }),
  ];
  assert.throws(
    () => sortTasksByDependencies(tasks),
    /Dependency cycle detected/,
  );
});

test('buildTaskGraph warns on empty child task list', async () => {
  const warnings = [];
  const provider = { async getSubTickets() { return []; } };
  const out = await buildTaskGraph({
    provider,
    logger: { warn: (m) => warnings.push(m), progress: () => {} },
    input: { storyId: 123 },
  });
  assert.deepStrictEqual(out.sortedTasks, []);
  assert.ok(warnings.some((w) => w.includes('no child Tasks')));
});

test('buildTaskGraph returns topologically-sorted tasks from the provider', async () => {
  const provider = {
    async getSubTickets(_storyId) {
      return [
        mkTask(1, { body: 'blocked by #2' }),
        mkTask(2),
      ];
    },
  };
  const out = await buildTaskGraph({
    provider,
    input: { storyId: 1 },
  });
  assert.deepStrictEqual(out.sortedTasks.map((t) => t.id), [2, 1]);
});
