import assert from 'node:assert';
import { test } from 'node:test';

import { resolveTaggingPlan } from '../.agents/scripts/sprint-close.js';

test('resolveTaggingPlan', async (t) => {
  await t.test('pre-bumped state → skip-bump-tag', () => {
    const plan = resolveTaggingPlan({
      currentVersion: '5.15.2',
      targetVersion: '5.15.2',
      tagExists: false,
      epicReleaseTarget: '5.15.2',
    });
    assert.strictEqual(plan.action, 'skip-bump-tag');
    assert.match(plan.detail, /already at 5\.15\.2/);
    assert.match(plan.detail, /tag v5\.15\.2 missing/);
  });

  await t.test('already-released → abort', () => {
    const plan = resolveTaggingPlan({
      currentVersion: '5.15.2',
      targetVersion: '5.15.2',
      tagExists: true,
      epicReleaseTarget: '5.15.2',
    });
    assert.strictEqual(plan.action, 'abort');
    assert.match(plan.detail, /already released/);
  });

  await t.test('tag-collision (version differs, tag exists) → abort', () => {
    const plan = resolveTaggingPlan({
      currentVersion: '5.15.1',
      targetVersion: '5.15.2',
      tagExists: true,
      epicReleaseTarget: '5.15.2',
    });
    assert.strictEqual(plan.action, 'abort');
    assert.match(plan.detail, /tag v5\.15\.2 already exists/);
    assert.match(plan.detail, /current version is 5\.15\.1/);
  });

  await t.test('normal path → bump', () => {
    const plan = resolveTaggingPlan({
      currentVersion: '5.15.1',
      targetVersion: '5.15.2',
      tagExists: false,
      epicReleaseTarget: '5.15.2',
    });
    assert.strictEqual(plan.action, 'bump');
    assert.match(plan.detail, /5\.15\.1 → 5\.15\.2/);
  });
});
