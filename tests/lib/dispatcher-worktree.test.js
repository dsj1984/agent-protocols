/**
 * Dispatcher worktree-isolation wiring tests.
 *
 * Covers:
 *   - collectOpenStoryIds: gc input is restricted to stories whose tasks
 *     are not all done, so reaping cannot delete a live story's worktree.
 *   - ManualDispatchAdapter: when `cwd` is present in the dispatch payload,
 *     a `cd "<path>"` instruction is printed for the operator.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ManualDispatchAdapter } from '../../.agents/scripts/adapters/manual.js';
import { collectOpenStoryIds } from '../../.agents/scripts/lib/orchestration/dispatch-engine.js';

// ---------------------------------------------------------------------------
// collectOpenStoryIds
// ---------------------------------------------------------------------------

describe('collectOpenStoryIds — gc safety', () => {
  function story(id, extra = {}) {
    return { id, labels: ['type::story'], body: '', state: 'open', ...extra };
  }
  function task(id, parentStoryId, status) {
    return {
      id,
      status,
      body: `parent: #${parentStoryId}`,
    };
  }

  it('returns IDs of stories that still have non-done tasks', () => {
    const allTicketsById = new Map([
      [100, story(100)],
      [200, story(200)],
    ]);
    const tasks = [
      task(1, 100, 'agent::executing'),
      task(2, 200, 'agent::done'),
    ];
    const result = collectOpenStoryIds(tasks, allTicketsById);
    assert.deepEqual(result.sort(), [100]);
  });

  it('omits stories whose tasks are all done — those worktrees are reapable', () => {
    const allTicketsById = new Map([[100, story(100)]]);
    const tasks = [task(1, 100, 'agent::done'), task(2, 100, 'agent::done')];
    assert.deepEqual(collectOpenStoryIds(tasks, allTicketsById), []);
  });

  it('ignores tasks whose parent is not a story (e.g. orphan tasks)', () => {
    const allTicketsById = new Map([
      [500, { id: 500, labels: ['type::feature'], body: '' }],
    ]);
    const tasks = [task(1, 500, 'agent::ready')];
    assert.deepEqual(collectOpenStoryIds(tasks, allTicketsById), []);
  });

  it('deduplicates story IDs across many tasks', () => {
    const allTicketsById = new Map([[100, story(100)]]);
    const tasks = [
      task(1, 100, 'agent::ready'),
      task(2, 100, 'agent::executing'),
      task(3, 100, 'agent::ready'),
    ];
    assert.deepEqual(collectOpenStoryIds(tasks, allTicketsById), [100]);
  });

  it('treats cancelled stories as non-open when reapOnCancel=true', () => {
    const allTicketsById = new Map([
      [100, story(100, { state: 'closed', labels: ['type::story'] })],
    ]);
    const tasks = [task(1, 100, 'agent::executing')];
    assert.deepEqual(
      collectOpenStoryIds(tasks, allTicketsById, { reapOnCancel: true }),
      [],
    );
  });

  it('keeps cancelled stories open when reapOnCancel=false', () => {
    const allTicketsById = new Map([
      [100, story(100, { state: 'closed', labels: ['type::story'] })],
    ]);
    const tasks = [task(1, 100, 'agent::executing')];
    assert.deepEqual(
      collectOpenStoryIds(tasks, allTicketsById, { reapOnCancel: false }),
      [100],
    );
  });
});

// ---------------------------------------------------------------------------
// ManualDispatchAdapter — surfaces cwd to operator
// ---------------------------------------------------------------------------

describe('ManualDispatchAdapter — cwd dispatch instruction', () => {
  function makeDispatch(extra = {}) {
    return {
      taskId: 42,
      epicId: 1,
      branch: 'story-7',
      epicBranch: 'epic/1',
      prompt: '<<prompt>>',
      persona: 'engineer',
      model: 'sonnet',
      mode: 'fast',
      skills: [],
      focusAreas: [],
      metadata: {},
      ...extra,
    };
  }

  function captureStdout(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      return { result: fn(), output: () => lines.join('\n') };
    } finally {
      console.log = original;
    }
  }

  it('surfaces cwd in the dispatch log when set', async () => {
    const adapter = new ManualDispatchAdapter(null);
    const cwd = '/repo/.worktrees/story-7';
    const { result, output } = captureStdout(() =>
      adapter.dispatchTask(makeDispatch({ cwd })),
    );
    await result;
    const text = output();
    assert.match(text, /cwd=\/repo\/\.worktrees\/story-7/);
  });

  it('omits cwd from the dispatch log when absent (single-tree mode)', async () => {
    const adapter = new ManualDispatchAdapter(null);
    const { result, output } = captureStdout(() =>
      adapter.dispatchTask(makeDispatch()),
    );
    await result;
    const text = output();
    assert.doesNotMatch(text, /cwd=/);
  });
});
