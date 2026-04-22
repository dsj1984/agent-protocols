import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_DONE_LABEL,
  collectOpenStoryIds,
  dispatchWave,
} from '../../../.agents/scripts/lib/orchestration/wave-dispatcher.js';

test('collectOpenStoryIds: includes stories with open tasks', () => {
  const tasks = [
    { id: 1, status: 'agent::executing', body: 'parent: #100' },
    { id: 2, status: AGENT_DONE_LABEL, body: 'parent: #100' },
  ];
  const allById = new Map([[100, { labels: ['type::story'], state: 'open' }]]);
  assert.deepEqual(collectOpenStoryIds(tasks, allById), [100]);
});

test('collectOpenStoryIds: excludes stories where every task is done', () => {
  const tasks = [
    { id: 1, status: AGENT_DONE_LABEL, body: 'parent: #100' },
    { id: 2, status: AGENT_DONE_LABEL, body: 'parent: #100' },
  ];
  const allById = new Map([[100, { labels: ['type::story'], state: 'open' }]]);
  assert.deepEqual(collectOpenStoryIds(tasks, allById), []);
});

test('collectOpenStoryIds: skips cancelled stories by default (reapOnCancel=true)', () => {
  const tasks = [{ id: 1, status: 'agent::executing', body: 'parent: #100' }];
  const allById = new Map([
    // Cancelled story: closed but no agent::done label.
    [100, { labels: ['type::story'], state: 'closed' }],
  ]);
  assert.deepEqual(collectOpenStoryIds(tasks, allById), []);
});

test('collectOpenStoryIds: keeps cancelled stories when reapOnCancel=false', () => {
  const tasks = [{ id: 1, status: 'agent::executing', body: 'parent: #100' }];
  const allById = new Map([
    [100, { labels: ['type::story'], state: 'closed' }],
  ]);
  assert.deepEqual(
    collectOpenStoryIds(tasks, allById, { reapOnCancel: false }),
    [100],
  );
});

test('dispatchWave: returns empty when every eligible task is done or executing', async () => {
  const wave = [
    {
      id: 1,
      status: AGENT_DONE_LABEL,
      dependsOn: [],
      title: 't1',
    },
    { id: 2, status: 'agent::executing', dependsOn: [], title: 't2' },
  ];
  const taskMap = new Map(wave.map((t) => [t.id, t]));
  const result = await dispatchWave(wave, taskMap, { dryRun: true });
  assert.equal(result.empty, true);
  assert.deepEqual(result.dispatched, []);
});

test('dispatchWave: halts when deps are not yet complete', async () => {
  const wave = [
    {
      id: 1,
      status: 'agent::ready',
      dependsOn: [99],
      title: 't1',
    },
  ];
  const taskMap = new Map([
    [1, wave[0]],
    [99, { id: 99, status: 'agent::ready' }],
  ]);
  const result = await dispatchWave(wave, taskMap, { dryRun: true });
  assert.equal(result.shouldHalt, true);
  assert.deepEqual(result.dispatched, []);
});

test('dispatchWave: dry-run dispatches eligible tasks and records dispatchId', async () => {
  const wave = [
    {
      id: 7,
      status: 'agent::ready',
      dependsOn: [],
      title: 't7',
      body: 'parent: #70',
      persona: 'fullstack',
      mode: 'task',
      skills: [],
      focusAreas: [],
    },
  ];
  const taskMap = new Map(wave.map((t) => [t.id, t]));
  const provider = { getTicket: async () => ({ labels: [] }) };
  const ctx = {
    provider,
    adapter: {},
    allTicketsById: new Map([[70, { labels: ['type::story'] }]]),
    epicId: 1,
    epicBranch: 'epic/1',
    dryRun: true,
    orchestration: { hitl: {} },
  };
  const result = await dispatchWave(wave, taskMap, ctx);
  assert.equal(result.shouldHalt, false);
  assert.equal(result.dispatched.length, 1);
  assert.equal(result.dispatched[0].status, 'dispatched');
  assert.match(result.dispatched[0].dispatchId, /^dry-run-/);
});
