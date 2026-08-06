/**
 * tests/lib/orchestration/behind-recovery.test.js — Story #5006.
 *
 * The one bounded BEHIND → `gh pr update-branch` decision, shared by the
 * CI-watch loop (`watchPrToTerminal`) and the close-side merge wait
 * (`single-story-close/phases/confirm-merge.js#maybeUpdateBehindPr`). Each
 * call site's wiring is pinned in its own suite —
 * `lifecycle/activation/watcher-behind-recovery.test.js` and
 * `single-store-close-confirm-merge.test.js` respectively; this file pins the
 * decision itself.
 *
 * The two properties that matter, because the two copies this replaced
 * disagreed on both:
 *
 *   1. **not-BEHIND is checked before the budget**, so an exhausted budget is
 *      announced only for a PR that actually wanted an update.
 *   2. **`attempted` and `updated` are distinct.** The merge wait consumes
 *      `attempted` (a failed update still burned the tick); the watch loop
 *      consumes `updated` (only a landed fast-forward may invalidate a
 *      terminal check outcome and re-poll).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyBehindUpdate } from '../../../.agents/scripts/lib/orchestration/behind-recovery.js';

/** Records every callback the helper fires, in order. */
function recorder() {
  const events = [];
  return {
    events,
    onBudgetSpent: (a) => events.push({ cb: 'budget-spent', ...a }),
    onUpdated: (a) => events.push({ cb: 'updated', ...a }),
    onUpdateFailed: (detail) => events.push({ cb: 'update-failed', detail }),
  };
}

describe('applyBehindUpdate — the BEHIND guard', () => {
  it('is a no-op for a PR that is not BEHIND', async () => {
    const cb = recorder();
    let called = 0;
    const out = await applyBehindUpdate({
      mergeStateStatus: 'CLEAN',
      updatesUsed: 0,
      maxUpdates: 3,
      updateBranch: async () => {
        called += 1;
      },
      ...cb,
    });
    assert.deepEqual(out, {
      attempted: false,
      updated: false,
      outcome: 'not-behind',
    });
    assert.equal(called, 0);
    assert.deepEqual(cb.events, []);
  });

  it('treats an unknown / degraded merge state as not-BEHIND (never writes)', async () => {
    for (const state of [undefined, null, '', 'UNKNOWN', 'behind']) {
      let called = 0;
      const out = await applyBehindUpdate({
        mergeStateStatus: state,
        updatesUsed: 0,
        maxUpdates: 3,
        updateBranch: async () => {
          called += 1;
        },
      });
      assert.equal(out.outcome, 'not-behind', `state=${String(state)}`);
      assert.equal(called, 0, `state=${String(state)} must not write`);
    }
  });

  it('checks BEHIND before the budget — a spent budget is silent on a CLEAN PR', async () => {
    const cb = recorder();
    const out = await applyBehindUpdate({
      mergeStateStatus: 'CLEAN',
      updatesUsed: 3,
      maxUpdates: 3,
      updateBranch: async () => {},
      ...cb,
    });
    assert.equal(out.outcome, 'not-behind');
    assert.deepEqual(
      cb.events,
      [],
      'a PR that never wanted an update must not be told the budget is spent',
    );
  });
});

describe('applyBehindUpdate — the update budget', () => {
  it('refuses (and announces) once the budget is spent', async () => {
    const cb = recorder();
    let called = 0;
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 3,
      maxUpdates: 3,
      updateBranch: async () => {
        called += 1;
      },
      ...cb,
    });
    assert.deepEqual(out, {
      attempted: false,
      updated: false,
      outcome: 'budget-spent',
    });
    assert.equal(called, 0);
    assert.deepEqual(cb.events, [{ cb: 'budget-spent', maxUpdates: 3 }]);
  });

  it('defaults to a zero budget when none is supplied', async () => {
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updateBranch: async () => {
        throw new Error('must not run');
      },
    });
    assert.equal(out.outcome, 'budget-spent');
  });
});

describe('applyBehindUpdate — the update itself', () => {
  it('reports updated when the invoker resolves', async () => {
    const cb = recorder();
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 1,
      maxUpdates: 3,
      updateBranch: async () => undefined,
      ...cb,
    });
    assert.deepEqual(out, {
      attempted: true,
      updated: true,
      outcome: 'updated',
    });
    assert.deepEqual(cb.events, [
      { cb: 'updated', updatesUsed: 1, maxUpdates: 3 },
    ]);
  });

  it('reports update-failed (attempted, not updated) when the invoker throws — the merge-wait facade shape', async () => {
    const cb = recorder();
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 0,
      maxUpdates: 3,
      updateBranch: async () => {
        throw new Error('gh pr update-branch 7 did not return within 30000ms');
      },
      ...cb,
    });
    assert.deepEqual(out, {
      attempted: true,
      updated: false,
      outcome: 'update-failed',
    });
    assert.equal(cb.events.length, 1);
    assert.equal(cb.events[0].cb, 'update-failed');
    assert.match(cb.events[0].detail, /did not return within 30000ms/);
  });

  it('reports update-failed when the invoker resolves { ok: false } — the spawn-port shape', async () => {
    const cb = recorder();
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 0,
      maxUpdates: 3,
      updateBranch: async () => ({ ok: false, detail: 'status=1: conflict' }),
      ...cb,
    });
    assert.equal(out.outcome, 'update-failed');
    assert.equal(out.attempted, true);
    assert.equal(out.updated, false);
    assert.equal(cb.events[0].detail, 'status=1: conflict');
  });

  it('accepts an explicit { ok: true } settlement as success', async () => {
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 0,
      maxUpdates: 1,
      updateBranch: async () => ({ ok: true }),
    });
    assert.equal(out.outcome, 'updated');
  });

  it('runs without any callbacks supplied', async () => {
    const out = await applyBehindUpdate({
      mergeStateStatus: 'BEHIND',
      updatesUsed: 0,
      maxUpdates: 1,
      updateBranch: async () => ({ ok: false }),
    });
    assert.equal(out.outcome, 'update-failed');
  });
});
