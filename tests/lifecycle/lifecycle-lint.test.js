// tests/lifecycle/lifecycle-lint.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findMergeLockoutViolations,
  findPromiseAllViolations,
} from '../../.agents/scripts/check-lifecycle-lint.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

describe('lifecycle-lint/no-promise-all-lifecycle', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('mandrel-lint-1-');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags Promise.all under the lifecycle dir', () => {
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
    assert.match(violations[0].hint, /append-only/);
    assert.match(violations[0].hint, /sequential/);
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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  '.agents',
  'scripts',
  'check-lifecycle-lint.js',
);

describe('lifecycle-lint/cli', () => {
  // Story #5024: `main()` was the whole uncovered surface of this script — the
  // pure rule finders were tested, the CLI that wires them and picks the exit
  // code never was. A lint whose runner is unexercised can report clean because
  // it never assembled the rule set.
  it('exits 0 against the live tree and names both surviving rules', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /\[lifecycle-lint\] clean/);
    assert.match(result.stdout, /Promise\.all/);
    assert.match(result.stdout, /merge-lockout/);
  });

  it('exits 1 and tags the offending rule when a violation is planted', () => {
    // Plant a Promise.all under the real lifecycle dir, so the CLI's own
    // discovery (not an injected fixture path) is what finds it.
    const planted = path.join(
      REPO_ROOT,
      '.agents',
      'scripts',
      'lib',
      'orchestration',
      'lifecycle',
      'zz-planted-violation.js',
    );
    writeFileSync(planted, 'export const x = Promise.all([]);\n', 'utf8');
    try {
      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, `stdout: ${result.stdout}`);
      assert.match(result.stderr, /no-promise-all-lifecycle/);
      assert.match(result.stderr, /zz-planted-violation\.js/);
    } finally {
      rmSync(planted, { force: true });
    }
  });
});

describe('lifecycle-lint/edge cases', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('mandrel-lint-edge-');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats a missing directory as clean rather than throwing', () => {
    // Load-bearing since Story #5024 deleted lifecycle/listeners/: a scan of a
    // directory that no longer exists must not crash the lint. ENOENT is the
    // only swallowed error — any other readdir failure still propagates.
    const gone = path.join(dir, 'no-such-dir');
    assert.deepEqual(findPromiseAllViolations(gone), []);
    assert.deepEqual(findMergeLockoutViolations(gone), []);
  });

  it('honours the lint-lifecycle-disable opt-out on a merge-lockout line', () => {
    const optedOut = path.join(dir, 'opted-out.js');
    writeFileSync(
      optedOut,
      "const cmd = 'gh pr merge'; // lint-lifecycle-disable\n",
      'utf8',
    );
    assert.deepEqual(findMergeLockoutViolations(dir), []);

    const notOptedOut = path.join(dir, 'plain.js');
    writeFileSync(notOptedOut, "const cmd = 'gh pr merge';\n", 'utf8');
    const violations = findMergeLockoutViolations(dir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, notOptedOut);
  });
});
