import assert from 'node:assert';
import { test } from 'node:test';

import { classifyGithubError } from '../.agents/scripts/providers/github/error-classifier.js';

test('classifyGithubError', async (t) => {
  await t.test('feature-disabled for sub-issues unknown-field errors', () => {
    const cases = [
      new Error("Field 'subIssues' doesn't exist on type 'Issue'"),
      new Error('Unknown field "subIssues" on type Issue'),
      new Error('Sub-issues is not available on this repository'),
      new Error('This feature is not enabled for your plan'),
    ];
    for (const err of cases) {
      assert.strictEqual(classifyGithubError(err), 'feature-disabled');
    }
  });

  await t.test('permission for 401 / 403 / forbidden / unauthorized', () => {
    const e401 = Object.assign(new Error('nope'), { status: 401 });
    const e403 = Object.assign(new Error('nope'), { status: 403 });
    assert.strictEqual(classifyGithubError(e401), 'permission');
    assert.strictEqual(classifyGithubError(e403), 'permission');
    assert.strictEqual(
      classifyGithubError(new Error('Resource not accessible: forbidden')),
      'permission',
    );
    assert.strictEqual(
      classifyGithubError(new Error('Unauthorized')),
      'permission',
    );
  });

  await t.test('transient for 429 / 5xx / network errors', () => {
    const e429 = Object.assign(new Error('nope'), { status: 429 });
    const e500 = Object.assign(new Error('nope'), { status: 503 });
    const eReset = Object.assign(new Error('nope'), { code: 'ECONNRESET' });
    assert.strictEqual(classifyGithubError(e429), 'transient');
    assert.strictEqual(classifyGithubError(e500), 'transient');
    assert.strictEqual(classifyGithubError(eReset), 'transient');
    assert.strictEqual(
      classifyGithubError(new Error('fetch failed')),
      'transient',
    );
    assert.strictEqual(
      classifyGithubError(new Error('secondary rate limit exceeded')),
      'transient',
    );
  });

  await t.test('permanent for everything else', () => {
    assert.strictEqual(
      classifyGithubError(new Error('Validation failed')),
      'permanent',
    );
    assert.strictEqual(classifyGithubError(null), 'permanent');
    assert.strictEqual(classifyGithubError(undefined), 'permanent');
  });
});
