import assert from 'node:assert';
import { test } from 'node:test';
import { isCleanManifest } from '../../.agents/scripts/lib/orchestration/retro-heuristics.js';

test('isCleanManifest - all zeros returns true', () => {
  assert.strictEqual(
    isCleanManifest({
      friction: 0,
      parked: 0,
      recuts: 0,
      hotfixes: 0,
      hitl: 0,
    }),
    true,
  );
});

test('isCleanManifest - no arguments returns true (all dimensions default to 0)', () => {
  assert.strictEqual(isCleanManifest(), true);
  assert.strictEqual(isCleanManifest({}), true);
});

test('isCleanManifest - each single non-zero signal returns false', () => {
  const dimensions = ['friction', 'parked', 'recuts', 'hotfixes', 'hitl'];
  for (const dim of dimensions) {
    const counts = { friction: 0, parked: 0, recuts: 0, hotfixes: 0, hitl: 0 };
    counts[dim] = 1;
    assert.strictEqual(
      isCleanManifest(counts),
      false,
      `expected false when ${dim}=1, got true`,
    );
  }
});

test('isCleanManifest - larger non-zero values also return false', () => {
  assert.strictEqual(isCleanManifest({ friction: 12 }), false);
  assert.strictEqual(isCleanManifest({ parked: 3 }), false);
  assert.strictEqual(isCleanManifest({ recuts: 2 }), false);
  assert.strictEqual(isCleanManifest({ hotfixes: 5 }), false);
  assert.strictEqual(isCleanManifest({ hitl: 1 }), false);
});

test('isCleanManifest - missing dimensions are treated as 0', () => {
  assert.strictEqual(isCleanManifest({ friction: 0 }), true);
  assert.strictEqual(isCleanManifest({ friction: 1 }), false);
});

test('isCleanManifest - non-number values are treated as 0 (defensive)', () => {
  assert.strictEqual(
    isCleanManifest({
      friction: undefined,
      parked: null,
      recuts: 'nope',
      hotfixes: NaN,
      hitl: 0,
    }),
    true,
  );
});

test('isCleanManifest - multiple non-zero signals return false', () => {
  assert.strictEqual(
    isCleanManifest({
      friction: 2,
      parked: 1,
      recuts: 0,
      hotfixes: 0,
      hitl: 0,
    }),
    false,
  );
});
