// tests/baselines/git-base.integration.test.js
//
// Real-git acceptance leg for `readBaseFromGit`.
//
// This file is tagged `test:integration` (via the `*.integration.test.js`
// glob in INTEGRATION_INCLUDE) so the fixture-setup cost does not tax the
// quick-feedback loop. The unit-level mock tests live in git-base.test.js.
//
// The fixture is provided by tests/fixtures/git-fixture.js — one shared
// helper optimizable in one place (`git init -q -b main`, inline `-c`
// config flags, `commit.gpgsign=false`).

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import {
  __cacheSize,
  __resetForTests,
  readBaseFromGit,
} from '../../.agents/scripts/lib/baselines/git-base.js';
import { makeGitRepo } from '../fixtures/git-fixture.js';

describe('readBaseFromGit — real git repo (integration)', () => {
  afterEach(() => {
    __resetForTests();
  });

  it('reads from a real temp git repo (acceptance: exits 0 on fixture)', () => {
    const dir = makeGitRepo();
    try {
      __resetForTests(); // restore real spawnSync
      const got = readBaseFromGit('HEAD', 'baseline.json', { cwd: dir });
      assert.ok(got !== null, 'HEAD:baseline.json should exist');
      assert.match(got, /"floor":\s*40/);
      // Second call exercises the real-spawn → cache transition.
      const sizeBefore = __cacheSize();
      const got2 = readBaseFromGit('HEAD', 'baseline.json', { cwd: dir });
      assert.equal(got2, got);
      assert.equal(
        __cacheSize(),
        sizeBefore,
        'second read must not grow cache',
      );

      // Missing file at HEAD → null.
      const missing = readBaseFromGit('HEAD', 'no-such-file.json', {
        cwd: dir,
      });
      assert.equal(missing, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Story #4914 / AC-9 — the leg that would have caught the defect
  // originally. Every mock in the unit suite reports whatever shape it is
  // told to; only a real `git show` through a real pipe exercises the
  // spawnSync stdout ceiling. Pre-fix this read died with
  // `status: null / SIGTERM / ENOBUFS` at ~1,064,960 bytes.
  it('reads a baseline larger than the 1 MB spawnSync default in full', () => {
    // Comfortably past the 1 MB default, and JSON so the shape matches a
    // real baseline envelope rather than an opaque blob.
    const rows = Array.from({ length: 26000 }, (_, i) => ({
      path: `src/generated/module-${String(i).padStart(6, '0')}.js`,
      mi: 80,
    }));
    const fileContent = JSON.stringify({ kernelVersion: '0.1.0', rows });
    assert.ok(
      fileContent.length > 1024 * 1024,
      `fixture must exceed the 1 MB default to be a witness; got ${fileContent.length}`,
    );

    const dir = makeGitRepo({
      prefix: 'git-fixture-oversize-',
      fileName: 'big-baseline.json',
      fileContent,
    });
    try {
      __resetForTests(); // restore real spawnSync
      const got = readBaseFromGit('HEAD', 'big-baseline.json', { cwd: dir });
      assert.ok(got !== null, 'oversize baseline must not read as absent');
      assert.equal(
        got.length,
        fileContent.length,
        'the full byte length must come back — a truncated read is the defect',
      );
      assert.equal(JSON.parse(got).rows.length, rows.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
