import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FULL_TIER_GLOBS } from '../../.agents/scripts/lib/test-tiers.js';
import { buildCoverageTestArgs } from '../../.agents/scripts/run-coverage.js';
import {
  resolveTestConcurrency,
  TEST_CONCURRENCY_MAX,
  TEST_CONCURRENCY_MIN,
  TEST_RUNNER_FLAGS,
} from '../../.agents/scripts/run-tests.js';

// ---------------------------------------------------------------------------
// buildCoverageTestArgs — host-aware --test-concurrency (Story #4254): the
// coverage suite spawn must reuse the shared, clamped concurrency value from
// run-tests.js rather than the historical literal `--test-concurrency=8`.
// ---------------------------------------------------------------------------

test('buildCoverageTestArgs carries the shared runner flags, not a literal 8', () => {
  const args = buildCoverageTestArgs();

  // Single source of truth: every shared runner flag is present, in order.
  for (const flag of TEST_RUNNER_FLAGS) {
    assert.ok(
      args.includes(flag),
      `coverage argv must include shared runner flag ${flag}`,
    );
  }

  // The concurrency flag is derived from the host, not pinned to 8.
  const flag = args.find((a) => a.startsWith('--test-concurrency='));
  assert.ok(flag, 'coverage argv must carry --test-concurrency=N');
  assert.notEqual(
    flag,
    '--test-concurrency=8',
    'coverage argv must not pin the historical literal 8',
  );
});

test('buildCoverageTestArgs concurrency equals the shared resolver output and is clamped', () => {
  const args = buildCoverageTestArgs();
  const flag = args.find((a) => a.startsWith('--test-concurrency='));
  const value = Number(flag.split('=')[1]);

  // Derived value matches resolveTestConcurrency() — the SSOT used by
  // run-tests.js — proving the coverage path shares the same resolver.
  assert.equal(value, resolveTestConcurrency());

  // Clamp is preserved: never below MIN, never above MAX (no raw
  // availableParallelism() that could over-subscribe constrained CI).
  assert.ok(
    value >= TEST_CONCURRENCY_MIN && value <= TEST_CONCURRENCY_MAX,
    `--test-concurrency=${value} is outside [${TEST_CONCURRENCY_MIN},${TEST_CONCURRENCY_MAX}]`,
  );
});

test('buildCoverageTestArgs honours an injected clamped runner-flag set', () => {
  // Inject a flag set whose concurrency sits at the upper bound to prove the
  // builder reflects the resolver's clamp rather than hardcoding a value.
  const injected = [
    '--experimental-test-module-mocks',
    '--test',
    `--test-concurrency=${resolveTestConcurrency(TEST_CONCURRENCY_MAX + 99)}`,
  ];
  const args = buildCoverageTestArgs({ runnerFlags: injected });
  assert.ok(args.includes(`--test-concurrency=${TEST_CONCURRENCY_MAX}`));
  assert.ok(!args.includes('--test-concurrency=8'));
});

// ---------------------------------------------------------------------------
// Story #4922 — the coverage runner must target the SAME file set the full
// tier runs. It previously restated `tests/**/*.test.js` as its own literal,
// so the colocated `__tests__` suites under lib/ and .agents/scripts/ ran
// under `npm test` but were absent from every coverage and CRAP reading.
// ---------------------------------------------------------------------------

test('buildCoverageTestArgs targets every full-tier glob after the runner flags', () => {
  const args = buildCoverageTestArgs();
  assert.ok(args.includes('--test'));

  // The trailing positionals are exactly FULL_TIER_GLOBS, in order.
  assert.deepEqual(args.slice(-FULL_TIER_GLOBS.length), [...FULL_TIER_GLOBS]);

  // Every runner flag still precedes the first positional.
  const firstGlobIdx = args.indexOf(FULL_TIER_GLOBS[0]);
  assert.equal(firstGlobIdx, args.length - FULL_TIER_GLOBS.length);
});

test('buildCoverageTestArgs restates no glob literal of its own', () => {
  // Injecting a sentinel glob set proves the builder has no hardcoded
  // fallback target: nothing but the injected globs reaches the argv tail.
  const args = buildCoverageTestArgs({ testGlobs: ['sentinel/**/*.test.js'] });
  assert.equal(args.at(-1), 'sentinel/**/*.test.js');
  assert.ok(
    !args.some((a) => a.includes('tests/**')),
    'coverage argv must not carry a hardcoded tests/** literal',
  );
});

test('buildCoverageTestArgs covers the colocated __tests__ roots', () => {
  const args = buildCoverageTestArgs();
  assert.ok(
    args.some((a) => a.startsWith('lib/') && a.includes('__tests__')),
    'coverage argv must reach the colocated lib/ __tests__ suites',
  );
  assert.ok(
    args.some(
      (a) => a.startsWith('.agents/scripts/') && a.includes('__tests__'),
    ),
    'coverage argv must reach the colocated .agents/scripts/ __tests__ suites',
  );
});
