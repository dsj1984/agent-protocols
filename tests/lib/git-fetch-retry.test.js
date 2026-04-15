/**
 * gitFetchWithRetry — bounded retry only on known packed-refs lock contention.
 *
 * Two concurrent worktrees can collide on `.git/packed-refs` during `git
 * fetch`. We retry that specific failure mode up to 3 times (250 / 500 /
 * 1000 ms backoff) and surface every other failure immediately.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import {
  __setGitRunners,
  __setSleep,
  gitFetchWithRetry,
} from '../../.agents/scripts/lib/git-utils.js';

// Install a no-op sleep so tests run synchronously. Track requested delays
// so assertions can verify the backoff schedule.
const sleepCalls = [];
__setSleep(async (ms) => {
  sleepCalls.push(ms);
});

// Restore real runners + real sleep after this suite so later tests are clean.
after(() => {
  __setGitRunners(execFileSync, spawnSync);
  __setSleep((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
});

/**
 * Install a scripted spawn mock that returns `results[callIndex]` on each
 * call and records the invocation. Fails the test if more calls happen than
 * results are scripted.
 */
function installScriptedSpawn(results) {
  const calls = [];
  __setGitRunners(
    () => '',
    (_cmd, args) => {
      calls.push(args);
      if (calls.length > results.length) {
        throw new Error(`Unexpected extra git call: ${args.join(' ')}`);
      }
      return results[calls.length - 1];
    },
  );
  return calls;
}

const OK = { status: 0, stdout: '', stderr: '' };
const CONTENTION = {
  status: 128,
  stdout: '',
  stderr: "error: Unable to create '/repo/.git/packed-refs.lock': File exists.",
};
const OTHER_FAILURE = {
  status: 1,
  stdout: '',
  stderr: 'fatal: could not read from remote repository',
};

describe('gitFetchWithRetry', () => {
  it('returns on first success without retrying', async () => {
    sleepCalls.length = 0;
    const calls = installScriptedSpawn([OK]);
    const res = await gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 0);
    assert.equal(res.attempts, 1);
    assert.equal(calls.length, 1);
    assert.equal(sleepCalls.length, 0);
  });

  it('retries packed-refs contention up to 3 times, then succeeds', async () => {
    sleepCalls.length = 0;
    const calls = installScriptedSpawn([CONTENTION, CONTENTION, OK]);
    const res = await gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 0);
    assert.equal(res.attempts, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleepCalls, [250, 500]);
  });

  it('gives up after 4 attempts (3 retries) on persistent contention', async () => {
    sleepCalls.length = 0;
    const calls = installScriptedSpawn([
      CONTENTION,
      CONTENTION,
      CONTENTION,
      CONTENTION,
    ]);
    const res = await gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 128);
    assert.equal(res.attempts, 4);
    assert.equal(calls.length, 4);
    assert.deepEqual(sleepCalls, [250, 500, 1000]);
  });

  it('does NOT retry on unrelated failures', async () => {
    sleepCalls.length = 0;
    const calls = installScriptedSpawn([OTHER_FAILURE]);
    const res = await gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 1);
    assert.equal(res.attempts, 1);
    assert.equal(calls.length, 1, 'must not retry unrelated errors');
    assert.equal(sleepCalls.length, 0);
  });

  it('also retries on "cannot lock ref" signature', async () => {
    sleepCalls.length = 0;
    const cannotLock = {
      status: 128,
      stdout: '',
      stderr: "error: cannot lock ref 'refs/remotes/origin/main'",
    };
    installScriptedSpawn([cannotLock, OK]);
    const res = await gitFetchWithRetry('/repo', 'origin');
    assert.equal(res.status, 0);
    assert.equal(res.attempts, 2);
  });
});
