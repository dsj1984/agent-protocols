/**
 * Unit tests for the IMPURE half of `phase-drivers.js` — the
 * `execute*Phase` functions and the `runStashPhase` sequencer.
 *
 * Story #4922. The decide* companions have had a suite since #2994, whose
 * header asserted that "the companion impure executeXPhase functions are
 * exercised through the existing integration suites". They were not:
 * `tests/scripts/git-cleanup*.test.js` drives `planCleanup` /
 * `executeCleanup` and the CLI pipeline, never these three sequencers. The
 * claim is why nobody noticed — a file can look covered by assertion alone.
 *
 * Every execute path here is driven through the injected seams the
 * underlying phase modules already expose (`checkoutFn` / `mergeFn` /
 * `deleteLocalFn` / …), so no test in this file spawns git.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  executeBranchPhase,
  executeFastForwardPhase,
  executeStashPhase,
  runStashPhase,
} from '../../../.agents/scripts/lib/orchestration/git-cleanup/phases/phase-drivers.js';
import { makeTempDir } from '../../../.agents/scripts/lib/test-temp.js';

const ok = () => ({ ok: true });

// ---------------------------------------------------------------------
// executeFastForwardPhase
// ---------------------------------------------------------------------

describe('executeFastForwardPhase', () => {
  it('returns the decided result verbatim on the skip action', async () => {
    const result = {
      ok: true,
      applied: false,
      skipped: true,
      reason: 'dirty-tree',
      behind: 0,
    };
    const out = await executeFastForwardPhase({
      kind: 'skip',
      result,
      logMessage: '[git-cleanup] skipped',
    });
    assert.deepEqual(out, result);
  });

  it('returns the decided result verbatim on the dry-run action', async () => {
    const result = {
      ok: true,
      applied: false,
      skipped: true,
      reason: 'dry-run',
      behind: 4,
    };
    const out = await executeFastForwardPhase({ kind: 'dry-run', result });
    assert.deepEqual(out, result);
  });

  it('tolerates a skip/dry-run action carrying no logMessage', async () => {
    const result = { ok: true, applied: false, skipped: true, behind: 0 };
    assert.deepEqual(
      await executeFastForwardPhase({ kind: 'skip', result }),
      result,
    );
  });

  it('performs the fast-forward on the execute action', async () => {
    const merged = [];
    const out = await executeFastForwardPhase({
      kind: 'execute',
      executeArgs: {
        cwd: '/repo',
        baseBranch: 'main',
        plan: { runnable: true, behind: 2, currentBranch: 'main' },
        checkoutFn: () => ok(),
        mergeFn: (_cwd, ref) => {
          merged.push(ref);
          return ok();
        },
        logger: { info() {}, warn() {} },
      },
    });
    assert.deepEqual(merged, ['origin/main']);
    assert.deepEqual(out, {
      ok: true,
      applied: true,
      skipped: false,
      behind: 2,
    });
  });

  it('surfaces a failed merge as ok:false rather than throwing', async () => {
    const out = await executeFastForwardPhase({
      kind: 'execute',
      executeArgs: {
        cwd: '/repo',
        baseBranch: 'main',
        plan: { runnable: true, behind: 1, currentBranch: 'main' },
        checkoutFn: () => ok(),
        mergeFn: () => ({ ok: false, stderr: 'diverged' }),
        logger: { info() {}, warn() {} },
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'merge-failed');
  });

  it('throws on an unsupported action kind', async () => {
    await assert.rejects(
      () => executeFastForwardPhase({ kind: 'prompt-then-execute' }),
      /unsupported action kind 'prompt-then-execute'/,
    );
  });
});

// ---------------------------------------------------------------------
// executeBranchPhase
// ---------------------------------------------------------------------

describe('executeBranchPhase', () => {
  it('returns the decided result verbatim on the dry-run action', async () => {
    const plan = { candidates: [] };
    const result = { plan, result: null };
    const out = await executeBranchPhase({ kind: 'dry-run', plan, result });
    assert.deepEqual(out, result);
  });

  it('returns the decided result verbatim on the no-candidates action', async () => {
    const plan = { candidates: [] };
    const result = { plan, result: null };
    const out = await executeBranchPhase({
      kind: 'no-candidates',
      plan,
      result,
    });
    assert.deepEqual(out, result);
  });

  it('reaps the candidates and returns {plan, result} on execute', async () => {
    const deleted = [];
    const plan = { candidates: [{ branch: 'story-1' }] };
    const out = await executeBranchPhase({
      kind: 'execute',
      plan,
      executeArgs: {
        candidates: plan.candidates,
        cwd: '/repo',
        remote: false,
        removeWorktreeFn: () => ok(),
        deleteLocalFn: (branch) => {
          deleted.push(branch);
          return { deleted: true };
        },
        deleteRemoteFn: () => ok(),
        logger: { info() {}, warn() {}, error() {} },
      },
    });
    assert.deepEqual(deleted, ['story-1']);
    assert.equal(out.plan, plan);
    assert.equal(out.result.ok, true);
    assert.deepEqual(
      out.result.local.map((r) => r.branch),
      ['story-1'],
    );
  });

  it('reports a failed local delete without throwing', async () => {
    const plan = { candidates: [{ branch: 'story-2' }] };
    const out = await executeBranchPhase({
      kind: 'execute',
      plan,
      executeArgs: {
        candidates: plan.candidates,
        cwd: '/repo',
        remote: false,
        removeWorktreeFn: () => ok(),
        deleteLocalFn: () => ({
          deleted: false,
          reason: 'not-merged',
          stderr: 'not fully merged',
        }),
        deleteRemoteFn: () => ok(),
        logger: { info() {}, warn() {}, error() {} },
      },
    });
    assert.equal(out.result.ok, false);
  });

  it('throws on an unsupported action kind', async () => {
    await assert.rejects(
      () => executeBranchPhase({ kind: 'prompt-then-execute' }),
      /unsupported action kind 'prompt-then-execute'/,
    );
  });
});

// ---------------------------------------------------------------------
// executeStashPhase
// ---------------------------------------------------------------------

describe('executeStashPhase', () => {
  it('returns the decided result verbatim on the no-stashes action', async () => {
    const result = { ok: true, actions: [], failures: [] };
    const out = await executeStashPhase({ kind: 'no-stashes', result });
    assert.deepEqual(out, result);
  });

  it('returns the decided result verbatim on the dry-run action', async () => {
    const result = {
      ok: true,
      actions: [{ ref: 'stash@{0}', action: 'keep' }],
      failures: [],
    };
    const out = await executeStashPhase({
      kind: 'dry-run',
      stashes: [{ ref: 'stash@{0}' }],
      result,
    });
    assert.deepEqual(out, result);
  });

  it('keeps every stash when the allowlist is empty', async () => {
    const out = await executeStashPhase({
      kind: 'execute-allowlist',
      executeArgs: {
        cwd: '/repo',
        stashes: [
          { ref: 'stash@{0}', message: 'a' },
          { ref: 'stash@{1}', message: 'b' },
        ],
        allowlist: [],
      },
    });
    assert.equal(out.ok, true);
    assert.deepEqual(
      out.actions.map((a) => a.action),
      ['keep', 'keep'],
    );
    // High index first — git renumbers from the top of the stack.
    assert.deepEqual(
      out.actions.map((a) => a.ref),
      ['stash@{1}', 'stash@{0}'],
    );
  });

  it('drops only the allowlisted refs', async () => {
    // `cwd` points at an empty scratch dir, so the real `git stash drop`
    // the allowlist path reaches fails deterministically — which is the
    // failure branch the phase must surface rather than throw.
    const cwd = makeTempDir('stash-phase-');
    const out = await executeStashPhase({
      kind: 'execute-allowlist',
      executeArgs: {
        cwd,
        stashes: [
          { ref: 'stash@{0}', message: 'keep me' },
          { ref: 'stash@{1}', message: 'drop me' },
        ],
        allowlist: ['stash@{1}'],
      },
    });
    const byRef = Object.fromEntries(out.actions.map((a) => [a.ref, a]));
    assert.equal(byRef['stash@{0}'].action, 'keep');
    assert.equal(byRef['stash@{1}'].action, 'drop');
    assert.equal(byRef['stash@{1}'].dropped, false);
    assert.equal(out.ok, false);
    assert.equal(out.failures.length, 1);
  });

  it('runs the interactive engine without prompting when there are no stashes', async () => {
    const out = await executeStashPhase({
      kind: 'execute-interactive',
      executeArgs: { cwd: '/repo', stashes: [] },
    });
    assert.deepEqual(out, { ok: true, actions: [], failures: [] });
  });

  it('throws on an unsupported action kind', async () => {
    await assert.rejects(
      () => executeStashPhase({ kind: 'prompt-then-decide' }),
      /unsupported action kind 'prompt-then-decide'/,
    );
  });
});

// ---------------------------------------------------------------------
// runStashPhase — the sequencer whose `node:coverage ignore` directive
// Story #4922 removed. `planStashes` degrades to an empty list when
// `git stash list` cannot run, so the no-stash path is drivable against a
// plain scratch directory.
// ---------------------------------------------------------------------

describe('runStashPhase', () => {
  it('short-circuits with an empty result when no stashes exist', async () => {
    const cwd = makeTempDir('stash-run-');
    const out = await runStashPhase({ dryRun: false, yes: true }, cwd);
    assert.deepEqual(out, { ok: true, actions: [], failures: [] });
  });

  it('short-circuits the same way under --dry-run', async () => {
    const cwd = makeTempDir('stash-run-dry-');
    const out = await runStashPhase({ dryRun: true }, cwd);
    assert.deepEqual(out, { ok: true, actions: [], failures: [] });
  });
});
