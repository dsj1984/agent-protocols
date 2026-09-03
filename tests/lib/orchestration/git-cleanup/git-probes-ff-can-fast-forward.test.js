// tests/lib/orchestration/git-cleanup/git-probes-ff-can-fast-forward.test.js
/**
 * Unit tests for the fast-forward probe bundle's `canFastForward`.
 *
 * This closure decides whether `git-cleanup` and the delivery base-sync may
 * fast-forward the base branch. Getting it wrong in the permissive direction
 * would fast-forward over local commits, so each of its four outcomes is
 * pinned here against an injected spawn (testing-standards § Unit) — no real
 * git process is started.
 *
 * It previously had no test of its own and was covered only incidentally by
 * the suite of an unrelated module that Story #5114 deleted; this file makes
 * that coverage explicit rather than borrowed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeFfProbes } from '../../../../.agents/scripts/lib/orchestration/git-cleanup/phases/git-probes-ff.js';

/**
 * @param {{ status?: number, stdout?: string, stderr?: string }} result
 * @returns {{ probes: object, calls: string[][] }}
 */
function withSpawn(result) {
  const calls = [];
  const spawn = (cwd, ...args) => {
    calls.push([cwd, ...args]);
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return { probes: makeFfProbes(spawn), calls };
}

describe('makeFfProbes — canFastForward', () => {
  it('asks git for the left/right count against <remote>/<base>', () => {
    const { probes, calls } = withSpawn({ stdout: '0\t0' });

    probes.canFastForward('/repo', 'main', 'origin');

    assert.deepEqual(calls[0], [
      '/repo',
      'rev-list',
      '--left-right',
      '--count',
      'main...origin/main',
    ]);
  });

  it('reports a clean fast-forward with the behind count', () => {
    const { probes } = withSpawn({ stdout: '0\t3' });

    assert.deepEqual(probes.canFastForward('/repo', 'main', 'origin'), {
      ok: true,
      behind: 3,
    });
  });

  it('is ok with behind 0 when the branch is already up to date', () => {
    const { probes } = withSpawn({ stdout: '0\t0' });

    assert.deepEqual(probes.canFastForward('/repo', 'main', 'origin'), {
      ok: true,
      behind: 0,
    });
  });

  it('refuses when the local branch is ahead — that is not a fast-forward', () => {
    const { probes } = withSpawn({ stdout: '2\t5' });

    assert.deepEqual(probes.canFastForward('/repo', 'main', 'origin'), {
      ok: false,
      behind: 5,
      reason: 'not-fast-forward',
    });
  });

  it('refuses when rev-list itself fails, rather than assuming zero', () => {
    const { probes } = withSpawn({ status: 128, stderr: 'unknown revision' });

    assert.deepEqual(probes.canFastForward('/repo', 'main', 'origin'), {
      ok: false,
      behind: 0,
      reason: 'rev-list-failed',
    });
  });

  it('treats unparseable counts as zero rather than NaN', () => {
    const { probes } = withSpawn({ stdout: 'not a count' });

    assert.deepEqual(probes.canFastForward('/repo', 'main', 'origin'), {
      ok: true,
      behind: 0,
    });
  });
});

describe('makeFfProbes — the rest of the bundle', () => {
  it('isClean is true only on a zero exit with empty porcelain output', () => {
    assert.equal(withSpawn({ stdout: '' }).probes.isClean('/repo'), true);
    assert.equal(
      withSpawn({ stdout: ' M f.js' }).probes.isClean('/repo'),
      false,
    );
    assert.equal(withSpawn({ status: 1 }).probes.isClean('/repo'), false);
  });

  it('currentBranch returns null off a branch or on failure', () => {
    assert.equal(
      withSpawn({ stdout: 'main\n' }).probes.currentBranch('/repo'),
      'main',
    );
    assert.equal(withSpawn({ status: 1 }).probes.currentBranch('/repo'), null);
    assert.equal(
      withSpawn({ stdout: '  ' }).probes.currentBranch('/repo'),
      null,
    );
  });

  it('fetch, checkout and merge surface stderr on failure', () => {
    const failing = { status: 1, stderr: 'boom' };
    assert.deepEqual(withSpawn(failing).probes.fetch('/r', 'origin', 'main'), {
      ok: false,
      stderr: 'boom',
    });
    assert.deepEqual(withSpawn(failing).probes.checkout('/r', 'main'), {
      ok: false,
      stderr: 'boom',
    });
    assert.deepEqual(withSpawn(failing).probes.merge('/r', 'origin/main'), {
      ok: false,
      stderr: 'boom',
    });
  });

  it('merge is --ff-only, so it can never create a merge commit', () => {
    const { probes, calls } = withSpawn({});
    probes.merge('/repo', 'origin/main');
    assert.deepEqual(calls[0], ['/repo', 'merge', '--ff-only', 'origin/main']);
  });
});
