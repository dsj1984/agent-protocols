import assert from 'node:assert';
import { test } from 'node:test';
import {
  kindRefreshEnvVar,
  resolveKindRefreshOverrides,
} from '../.agents/scripts/lib/baselines/env-overrides.js';

// Story #4802 generalized the per-kind resolvers into one kind-keyed helper.
// This shim keeps every original bundle-size assertion below byte-identical
// while driving the generic function, so the #151 contract is still pinned.
const resolveBundleSizeEnvOverrides = (env) =>
  resolveKindRefreshOverrides('bundle-size', env);

/**
 * Tests for `resolveBundleSizeEnvOverrides` (Story #151 upstream port,
 * mandrel-platform#151 / PR #156). Mirrors the precedence + malformed-value
 * coverage style of `tests/check-crap-env-overrides.test.js` for the
 * `CRAP_TOLERANCE` resolver — pinning that `BUNDLE_SIZE_REFRESH` is a true
 * one-shot acknowledge flag: no persistence, strict truthy-value parsing,
 * case-insensitive, and a no-op (not a crash) on anything malformed.
 */

test('resolveBundleSizeEnvOverrides — no env var: not acknowledged, no overrides', () => {
  const result = resolveBundleSizeEnvOverrides({});
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveBundleSizeEnvOverrides — undefined env object: not acknowledged', () => {
  const result = resolveBundleSizeEnvOverrides(undefined);
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveBundleSizeEnvOverrides — BUNDLE_SIZE_REFRESH=1 acknowledges', () => {
  const result = resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: '1' });
  assert.strictEqual(result.acknowledged, true);
  assert.strictEqual(result.overrides.length, 1);
  assert.ok(result.overrides[0].includes('BUNDLE_SIZE_REFRESH=1'));
});

test('resolveBundleSizeEnvOverrides — BUNDLE_SIZE_REFRESH=true acknowledges', () => {
  const result = resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 'true' });
  assert.strictEqual(result.acknowledged, true);
  assert.ok(result.overrides[0].includes('BUNDLE_SIZE_REFRESH=true'));
});

test('resolveBundleSizeEnvOverrides — case-insensitive truthy values (TRUE, True)', () => {
  assert.strictEqual(
    resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 'TRUE' }).acknowledged,
    true,
  );
  assert.strictEqual(
    resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 'True' }).acknowledged,
    true,
  );
});

test('resolveBundleSizeEnvOverrides — surrounding whitespace is trimmed before matching', () => {
  const result = resolveBundleSizeEnvOverrides({
    BUNDLE_SIZE_REFRESH: '  1  ',
  });
  assert.strictEqual(result.acknowledged, true);
});

test('resolveBundleSizeEnvOverrides — empty string is treated as unset', () => {
  const result = resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: '' });
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveBundleSizeEnvOverrides — malformed value (e.g. "yes") is a no-op, not acknowledged', () => {
  const result = resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 'yes' });
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveBundleSizeEnvOverrides — "0" and "false" are not acknowledged', () => {
  assert.strictEqual(
    resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: '0' }).acknowledged,
    false,
  );
  assert.strictEqual(
    resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 'false' })
      .acknowledged,
    false,
  );
});

test('resolveBundleSizeEnvOverrides — numeric non-string env values are ignored (defensive)', () => {
  // process.env values are always strings in real life, but the resolver
  // should not throw or misbehave if a test/caller passes a non-string.
  const result = resolveBundleSizeEnvOverrides({ BUNDLE_SIZE_REFRESH: 1 });
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveBundleSizeEnvOverrides — other env vars present do not interfere', () => {
  const result = resolveBundleSizeEnvOverrides({
    CRAP_TOLERANCE: '0.5',
    BUNDLE_SIZE_REFRESH: '1',
    PATH: '/usr/bin',
  });
  assert.strictEqual(result.acknowledged, true);
  assert.strictEqual(result.overrides.length, 1);
});

// --- Kind-generic surface (Story #4802) ------------------------------------

test('kindRefreshEnvVar — upper-snakes the kind, reproducing both legacy names', () => {
  assert.strictEqual(kindRefreshEnvVar('bundle-size'), 'BUNDLE_SIZE_REFRESH');
  assert.strictEqual(
    kindRefreshEnvVar('maintainability'),
    'MAINTAINABILITY_REFRESH',
  );
  assert.strictEqual(kindRefreshEnvVar('coverage'), 'COVERAGE_REFRESH');
  assert.strictEqual(kindRefreshEnvVar('crap'), 'CRAP_REFRESH');
  assert.strictEqual(kindRefreshEnvVar('duplication'), 'DUPLICATION_REFRESH');
});

test('kindRefreshEnvVar — a non-usable kind yields null rather than a bogus var name', () => {
  assert.strictEqual(kindRefreshEnvVar(''), null);
  assert.strictEqual(kindRefreshEnvVar(undefined), null);
  assert.strictEqual(kindRefreshEnvVar(null), null);
  assert.strictEqual(kindRefreshEnvVar(42), null);
});

test('resolveKindRefreshOverrides — COVERAGE_REFRESH=1 acknowledges the coverage kind (the #4802 gap)', () => {
  const result = resolveKindRefreshOverrides('coverage', {
    COVERAGE_REFRESH: '1',
  });
  assert.strictEqual(result.acknowledged, true);
  assert.ok(result.overrides[0].includes('COVERAGE_REFRESH=1'));
});

test('resolveKindRefreshOverrides — crap and duplication gain the same escape', () => {
  assert.strictEqual(
    resolveKindRefreshOverrides('crap', { CRAP_REFRESH: '1' }).acknowledged,
    true,
  );
  assert.strictEqual(
    resolveKindRefreshOverrides('duplication', { DUPLICATION_REFRESH: 'true' })
      .acknowledged,
    true,
  );
});

test('resolveKindRefreshOverrides — a kind is not acknowledged by another kind flag', () => {
  const result = resolveKindRefreshOverrides('coverage', {
    MAINTAINABILITY_REFRESH: '1',
    BUNDLE_SIZE_REFRESH: '1',
  });
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});

test('resolveKindRefreshOverrides — an unusable kind is a no-op, not a throw', () => {
  const result = resolveKindRefreshOverrides(undefined, {
    COVERAGE_REFRESH: '1',
  });
  assert.strictEqual(result.acknowledged, false);
  assert.deepStrictEqual(result.overrides, []);
});
