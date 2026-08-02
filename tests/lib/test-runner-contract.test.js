// tests/lib/test-runner-contract.test.js
//
// Story #4936 — the checks that would have caught two silent harness gaps.
//
//   1. Divergent runner flags. `run-tests.js` passed
//      `--experimental-test-module-mocks`; the coverage runner had to be kept
//      in step by hand. A flag that decides whether `t.mock.module` works
//      decides whether a test can execute at all, so a divergence makes a
//      suite pass under `npm test` and fail under `npm run test:coverage` —
//      the *required* CI job — with no source defect anywhere.
//
//   2. Inert preflight hooks. `.npmrc` sets `ignore-scripts=true` as
//      supply-chain defence (CWE-1357). That also suppresses npm's `pre*`
//      lifecycle hooks, so `pretest`, `pretest:quick` and `pretest:integration`
//      never fired for any tier. The preflight is invoked by the runners now,
//      and these tests are what prove it executes rather than merely existing.

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  resolveTestConcurrency,
  runTierPreflight,
  TEST_CONCURRENCY_MAX,
  TEST_CONCURRENCY_MIN,
  TEST_RUNNER_FLAGS,
} from '../../.agents/scripts/lib/test-runner-contract.js';

/** Record every spawn a preflight run issues, returning a fixed status. */
function recordingSpawn(statuses = []) {
  const calls = [];
  let i = 0;
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const status = statuses[i] ?? 0;
    i += 1;
    return typeof status === 'object' ? status : { status };
  };
  return { spawn, calls };
}

describe('TEST_RUNNER_FLAGS — the one flag declaration', () => {
  test('carries the module-mock flag every runner needs', () => {
    assert.ok(TEST_RUNNER_FLAGS.includes('--experimental-test-module-mocks'));
    assert.ok(TEST_RUNNER_FLAGS.includes('--test'));
  });

  test('is frozen, so no runner can mutate the shared set at import time', () => {
    assert.ok(Object.isFrozen(TEST_RUNNER_FLAGS));
  });

  test('derives --test-concurrency from the clamped host resolver', () => {
    const flag = TEST_RUNNER_FLAGS.find((f) =>
      f.startsWith('--test-concurrency='),
    );
    assert.ok(flag, 'TEST_RUNNER_FLAGS must carry --test-concurrency=N');
    assert.equal(Number(flag.split('=')[1]), resolveTestConcurrency());
  });

  test('resolveTestConcurrency clamps to the declared bounds', () => {
    assert.equal(resolveTestConcurrency(0), TEST_CONCURRENCY_MIN);
    assert.equal(resolveTestConcurrency(-4), TEST_CONCURRENCY_MIN);
    assert.equal(
      resolveTestConcurrency(TEST_CONCURRENCY_MAX + 10),
      TEST_CONCURRENCY_MAX,
    );
    const mid = Math.floor((TEST_CONCURRENCY_MIN + TEST_CONCURRENCY_MAX) / 2);
    assert.equal(resolveTestConcurrency(mid), mid);
  });
});

describe('runTierPreflight — the preflight actually executes', () => {
  test('the full tier runs the state probe and the skills validator, in order', () => {
    const { spawn, calls } = recordingSpawn();
    assert.equal(
      runTierPreflight({ tier: 'full', repoRoot: '/repo', spawn }),
      0,
    );
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      [
        path.join('/repo', '.agents/scripts/test-wrapper.js'),
        path.join('/repo', '.agents/scripts/validate-skills.js'),
      ],
    );
    for (const call of calls) {
      assert.equal(call.opts.cwd, '/repo');
      assert.equal(call.opts.stdio, 'inherit');
    }
  });

  test('the quick tier runs its preflight', () => {
    const { spawn, calls } = recordingSpawn();
    assert.equal(
      runTierPreflight({ tier: 'quick', repoRoot: '/repo', spawn }),
      0,
    );
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      [path.join('/repo', '.agents/scripts/test-wrapper.js')],
    );
  });

  test('the integration tier runs its preflight', () => {
    const { spawn, calls } = recordingSpawn();
    assert.equal(
      runTierPreflight({ tier: 'integration', repoRoot: '/repo', spawn }),
      0,
    );
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      [path.join('/repo', '.agents/scripts/test-wrapper.js')],
    );
  });

  test('every declared tier runs at least one preflight script', () => {
    // The regression this guards is the original defect in its purest form:
    // a tier whose preflight silently runs nothing at all.
    for (const tier of ['full', 'quick', 'integration']) {
      const { spawn, calls } = recordingSpawn();
      runTierPreflight({ tier, repoRoot: '/repo', spawn });
      assert.ok(
        calls.length > 0,
        `tier ${tier} executed no preflight script — a preflight that runs ` +
          'nothing is the Story #4936 defect',
      );
    }
  });

  test('spawns the node binary it was given, not a shell string', () => {
    const { spawn, calls } = recordingSpawn();
    runTierPreflight({
      tier: 'quick',
      repoRoot: '/repo',
      spawn,
      execPath: '/usr/bin/node',
    });
    assert.equal(calls[0].cmd, '/usr/bin/node');
    assert.ok(Array.isArray(calls[0].args));
  });

  test('a refused preflight short-circuits and propagates its exit code', () => {
    // test-wrapper.js reserves exit code 2 for "preflight refused". The
    // second script must not run once the first refuses — npm's own
    // `pre<script>` abort semantics, minus the hook that never fires.
    const { spawn, calls } = recordingSpawn([2, 0]);
    assert.equal(
      runTierPreflight({ tier: 'full', repoRoot: '/repo', spawn }),
      2,
    );
    assert.equal(calls.length, 1);
  });

  test('a null status is treated as failure, never as success', () => {
    const { spawn } = recordingSpawn([{ status: null }]);
    assert.equal(
      runTierPreflight({ tier: 'quick', repoRoot: '/repo', spawn }),
      1,
    );
  });

  test('a spawn error propagates rather than reading as a passing preflight', () => {
    const { spawn } = recordingSpawn([{ error: new Error('ENOENT') }]);
    assert.throws(
      () => runTierPreflight({ tier: 'quick', repoRoot: '/repo', spawn }),
      /ENOENT/,
    );
  });

  test('an unknown tier runs nothing and passes', () => {
    const { spawn, calls } = recordingSpawn();
    assert.equal(
      runTierPreflight({ tier: 'nope', repoRoot: '/repo', spawn }),
      0,
    );
    assert.equal(calls.length, 0);
  });
});
