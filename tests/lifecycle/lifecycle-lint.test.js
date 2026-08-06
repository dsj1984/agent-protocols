// tests/lifecycle/lifecycle-lint.test.js
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { findPromiseAllViolations } from '../../.agents/scripts/check-lifecycle-lint.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

describe('lifecycle-lint/no-promise-all-lifecycle', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('mandrel-lint-1-');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags Promise.all over listeners under the lifecycle dir', () => {
    const file = path.join(dir, 'bad.js');
    writeFileSync(
      file,
      `
async function emit(event, payload) {
  const listeners = [a, b, c];
  await Promise.all(listeners.map((l) => l(event, payload)));
}
`,
      'utf8',
    );
    const violations = findPromiseAllViolations(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, file);
    assert.match(violations[0].hint, /sequentially/);
  });

  it('does not flag files without Promise.all', () => {
    writeFileSync(
      path.join(dir, 'good.js'),
      'async function emit() { for (const l of listeners) await l(); }\n',
      'utf8',
    );
    const violations = findPromiseAllViolations(dir);
    assert.deepEqual(violations, []);
  });

  it('respects lint-lifecycle-disable inline opt-out', () => {
    writeFileSync(
      path.join(dir, 'opted-out.js'),
      'await Promise.all([]); // lint-lifecycle-disable -- justified bulk emit\n',
      'utf8',
    );
    const violations = findPromiseAllViolations(dir);
    assert.deepEqual(violations, []);
  });

  it('recurses into nested directories', () => {
    const nested = path.join(dir, 'listeners', 'deep');
    mkdirSync(nested, { recursive: true });
    const file = path.join(nested, 'bad.js');
    writeFileSync(file, 'Promise.all([])\n', 'utf8');
    const violations = findPromiseAllViolations(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, file);
  });
});
