// tests/lib/orchestration/pr-watch-behind-recovery.test.js
/**
 * BEHIND auto-recovery preservation test
 * — Story #2327, re-pointed by Story #5006, re-homed by Story #5024.
 *
 * The `pr-watch-with-update.js` CLI performs a fast-forward recovery when
 * every required check goes green AND the PR's `mergeStateStatus` is
 * `BEHIND`: it issues one `gh pr update-branch` call to merge the base into
 * the head, then re-polls the freshly-rebased commit's CI cycle. That flow
 * lives in `watchPrToTerminal`, and the decision inside it is now the shared
 * `applyBehindUpdate` (Story #5006) that the close-side merge wait also
 * runs. This file pins the CLI-side call site of that shared helper.
 *
 * (This originally drove the flow through the `Watcher` listener's
 * classification log. Story #5006 deleted the listener — nothing emitted
 * `pr.created` at it — so the assertions read `watchPrToTerminal`'s returned
 * verdict, which is the surface the CLI has always consumed.)
 *
 * Acceptance contract:
 *   - Stubbed gh CLI returns `mergeStateStatus: BEHIND` on the first
 *     view probe and `mergeStateStatus: CLEAN` on the second.
 *   - The stubbed `gh pr update-branch` invocation is recorded exactly
 *     once between the two view probes.
 *   - The verdict reports `updatesApplied: 1` and a terminal, green watch.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { watchPrToTerminal } from '../../../.agents/scripts/lib/orchestration/pr-watch.js';

function quietLogger() {
  return { info: () => {}, warn: () => {}, debug: () => {} };
}

const PR_URL = 'https://github.com/owner/repo/pull/9';

/**
 * Drive `watchPrToTerminal` against a deterministic stub gh CLI. Every gh
 * call is recorded in order so the test can assert the canonical sequence:
 * checks → view (BEHIND) → update-branch → checks → view (CLEAN).
 *
 * @param {string[]} mergeStates Ordered `mergeStateStatus` values the
 *   stubbed `gh pr view` returns; the last one repeats once exhausted.
 */
async function runWatch(mergeStates) {
  const calls = [];
  const checksResponse = {
    status: 0,
    stdout: JSON.stringify([
      { name: 'Validate and Test', state: 'SUCCESS', bucket: 'pass' },
      { name: 'baselines', state: 'SUCCESS', bucket: 'pass' },
    ]),
    stderr: '',
  };
  let viewIdx = 0;
  const verdict = await watchPrToTerminal({
    prUrl: PR_URL,
    cwd: '/tmp',
    pollIntervalMs: 0,
    maxPolls: 10,
    maxUpdates: 3,
    sleepFn: async () => {},
    ghPrChecksFn: () => {
      calls.push({ cmd: 'gh pr checks' });
      return checksResponse;
    },
    ghPrViewFn: () => {
      calls.push({ cmd: 'gh pr view' });
      const state = mergeStates[Math.min(viewIdx++, mergeStates.length - 1)];
      return {
        status: 0,
        stdout: JSON.stringify({ mergeStateStatus: state }),
        stderr: '',
      };
    },
    ghPrUpdateBranchFn: () => {
      calls.push({ cmd: 'gh pr update-branch' });
      return { status: 0, stdout: '', stderr: '' };
    },
    logger: quietLogger(),
  });
  return { calls, verdict };
}

describe('watchPrToTerminal — mergeStateStatus BEHIND auto-recovery', () => {
  it('issues exactly one gh pr update-branch between two view probes when first probe is BEHIND and second is CLEAN', async () => {
    const { calls, verdict } = await runWatch(['BEHIND', 'CLEAN']);

    // Exactly one `gh pr update-branch` invocation, recorded between
    // the two `gh pr view` probes.
    assert.equal(
      calls.filter((c) => c.cmd === 'gh pr update-branch').length,
      1,
      'BEHIND recovery must call gh pr update-branch exactly once',
    );
    assert.equal(
      calls.filter((c) => c.cmd === 'gh pr view').length,
      2,
      'mergeStateStatus must be probed twice (BEHIND then CLEAN)',
    );

    // Ordering invariant: the update-branch call must land between
    // the two view probes. (Legacy parity: first view → BEHIND →
    // update-branch → second view → CLEAN.)
    const cmdOrder = calls.map((c) => c.cmd);
    const firstView = cmdOrder.indexOf('gh pr view');
    const lastView = cmdOrder.lastIndexOf('gh pr view');
    const update = cmdOrder.indexOf('gh pr update-branch');
    assert.ok(
      firstView < update && update < lastView,
      `update-branch must be between the two view probes; observed: ${cmdOrder.join(' → ')}`,
    );

    assert.equal(verdict.requiredChecks.length, 2);
    assert.equal(verdict.terminal, true);
    assert.equal(verdict.green, true);
  });

  it('records updatesApplied=1 on the verdict for the BEHIND→CLEAN recovery path', async () => {
    const { verdict } = await runWatch(['BEHIND', 'CLEAN']);
    assert.equal(
      verdict.updatesApplied,
      1,
      'one update-branch call must be recorded on the verdict',
    );
  });

  it('does NOT call update-branch when mergeStateStatus is already CLEAN on the first probe', async () => {
    const { calls, verdict } = await runWatch(['CLEAN']);
    assert.equal(
      calls.filter((c) => c.cmd === 'gh pr update-branch').length,
      0,
      'update-branch must not fire when mergeStateStatus is CLEAN',
    );
    assert.equal(verdict.updatesApplied, 0);
  });

  it('stops the arm without re-polling when the update-branch call fails', async () => {
    const calls = [];
    const verdict = await watchPrToTerminal({
      prUrl: PR_URL,
      cwd: '/tmp',
      pollIntervalMs: 0,
      maxPolls: 10,
      maxUpdates: 3,
      sleepFn: async () => {},
      ghPrChecksFn: () => {
        calls.push({ cmd: 'gh pr checks' });
        return {
          status: 0,
          stdout: JSON.stringify([
            { name: 'baselines', state: 'SUCCESS', bucket: 'pass' },
          ]),
          stderr: '',
        };
      },
      ghPrViewFn: () => {
        calls.push({ cmd: 'gh pr view' });
        return {
          status: 0,
          stdout: JSON.stringify({ mergeStateStatus: 'BEHIND' }),
          stderr: '',
        };
      },
      ghPrUpdateBranchFn: () => {
        calls.push({ cmd: 'gh pr update-branch' });
        return { status: 1, stdout: '', stderr: 'merge conflict' };
      },
      logger: quietLogger(),
    });

    assert.equal(
      calls.filter((c) => c.cmd === 'gh pr update-branch').length,
      1,
      'a failed update must not be retried inside the same arm',
    );
    // The terminal green outcomes stand: nothing invalidated them, so the
    // arm reports what it last observed rather than re-polling a head that
    // never moved.
    assert.equal(verdict.updatesApplied, 0);
    assert.equal(verdict.terminal, true);
    assert.equal(verdict.green, true);
  });
});
