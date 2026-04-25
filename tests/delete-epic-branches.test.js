import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  executeDeletion,
  parseDeleteArgs,
  planDeletion,
  renderDeletionLine,
  renderDryRun,
  renderExecutionSummary,
} from '../.agents/scripts/delete-epic-branches.js';

describe('delete-epic-branches.parseDeleteArgs', () => {
  it('returns null epicId when missing or invalid', () => {
    assert.equal(parseDeleteArgs([]).epicId, null);
    assert.equal(parseDeleteArgs(['--epic', 'abc']).epicId, null);
    assert.equal(parseDeleteArgs(['--epic', '0']).epicId, null);
  });
  it('parses --epic, --dry-run, --json flags', () => {
    const out = parseDeleteArgs(['--epic', '777', '--dry-run', '--json']);
    assert.deepEqual(out, { epicId: 777, dryRun: true, json: true });
  });
  it('defaults boolean flags to false', () => {
    assert.deepEqual(parseDeleteArgs(['--epic', '7']), {
      epicId: 7,
      dryRun: false,
      json: false,
    });
  });
});

describe('delete-epic-branches.renderDryRun', () => {
  it('lists branches when present', () => {
    const lines = renderDryRun({
      epicId: 12,
      local: ['epic/12', 'story/epic-12/40'],
      remote: ['epic/12'],
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /Epic #12 — DRY RUN/);
    assert.match(lines[1], /Local   \(2\): epic\/12, story\/epic-12\/40/);
    assert.match(lines[2], /Remote  \(1\): epic\/12/);
  });
  it('renders (none) when both lists are empty', () => {
    const lines = renderDryRun({ epicId: 99, local: [], remote: [] });
    assert.match(lines[1], /\(none\)/);
    assert.match(lines[2], /\(none\)/);
  });
});

describe('delete-epic-branches.renderDeletionLine', () => {
  it('renders an OK local line', () => {
    assert.equal(
      renderDeletionLine({ branch: 'epic/1', ok: true }, 'local'),
      '[delete-epic-branches] ✅ local  epic/1',
    );
  });
  it('renders a failed local line', () => {
    assert.equal(
      renderDeletionLine({ branch: 'epic/2', ok: false }, 'local'),
      '[delete-epic-branches] ❌ local  epic/2',
    );
  });
  it('renders a remote line with already-gone annotation', () => {
    assert.equal(
      renderDeletionLine(
        { branch: 'task/epic-1/3', ok: true, alreadyGone: true },
        'remote',
      ),
      '[delete-epic-branches] ✅ remote task/epic-1/3 (already gone)',
    );
  });
  it('renders a remote failure without annotation', () => {
    assert.equal(
      renderDeletionLine({ branch: 'epic/4', ok: false }, 'remote'),
      '[delete-epic-branches] ❌ remote epic/4',
    );
  });
});

describe('delete-epic-branches.renderExecutionSummary', () => {
  it('reports success counts when ok', () => {
    const out = renderExecutionSummary(7, {
      ok: true,
      local: [1, 2],
      remote: [1],
      failures: [],
    });
    assert.equal(
      out,
      '[delete-epic-branches] ✅ Epic #7 — 2 local + 1 remote branch(es) deleted.',
    );
  });
  it('reports failure count when not ok', () => {
    const out = renderExecutionSummary(7, {
      ok: false,
      local: [],
      remote: [],
      failures: [{}, {}, {}],
    });
    assert.equal(out, '[delete-epic-branches] ❌ 3 deletion(s) failed.');
  });
});

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
