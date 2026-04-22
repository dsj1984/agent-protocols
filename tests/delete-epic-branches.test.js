import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  executeDeletion,
  planDeletion,
} from '../.agents/scripts/delete-epic-branches.js';

describe('delete-epic-branches.planDeletion', () => {
  it('collects local + remote matches from the injected listers', () => {
    const plan = planDeletion({
      epicId: 441,
      localLister: () => ['epic/441', 'story/epic-441/453'],
      remoteLister: () => ['epic/441', 'task/epic-441/500'],
    });
    assert.equal(plan.epicId, 441);
    assert.deepEqual(plan.local, ['epic/441', 'story/epic-441/453']);
    assert.deepEqual(plan.remote, ['epic/441', 'task/epic-441/500']);
  });

  it('tolerates empty match sets', () => {
    const plan = planDeletion({
      epicId: 999,
      localLister: () => [],
      remoteLister: () => [],
    });
    assert.deepEqual(plan.local, []);
    assert.deepEqual(plan.remote, []);
  });
});

describe('delete-epic-branches.executeDeletion', () => {
  it('reports ok when all deletions succeed', () => {
    const plan = { epicId: 1, local: ['a'], remote: ['b'] };
    const result = executeDeletion({
      plan,
      deleteLocal: (b) => ({ branch: b, ok: true }),
      deleteRemote: (b) => ({ branch: b, ok: true, alreadyGone: false }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
  });

  it('aggregates failures and flips ok to false', () => {
    const plan = { epicId: 1, local: ['a', 'b'], remote: ['c'] };
    const result = executeDeletion({
      plan,
      deleteLocal: (b) => ({ branch: b, ok: b !== 'b', stderr: 'nope' }),
      deleteRemote: (b) => ({ branch: b, ok: true, alreadyGone: false }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].branch, 'b');
    assert.equal(result.failures[0].scope, 'local');
  });

  it('treats already-gone remote refs as success', () => {
    const plan = { epicId: 1, local: [], remote: ['orig-only'] };
    const result = executeDeletion({
      plan,
      deleteLocal: () => ({ ok: true }),
      deleteRemote: (b) => ({ branch: b, ok: true, alreadyGone: true }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.remote[0].alreadyGone, true);
  });
});
