/**
 * git-utils-maxbuffer.test.js — Story #4948.
 *
 * `runGitSync` / `runGitSpawn` passed no `maxBuffer`, so both inherited the
 * 1 MB child-process default. `git push` relays the whole `pre-push` hook
 * output, which is unbounded by design — this repo's hook emits a full
 * `check-baselines` envelope (measured 2,166,643 bytes), so every Story close
 * died at `phase: push` with `ENOBUFS` once Story #4943 made hooks reachable
 * inside worktrees. Gates had already passed; only the push failed.
 *
 * These tests drive **real child output past the old 1 MB ceiling** rather
 * than asserting the option is present. `assert.match(source, /maxBuffer/)`
 * would pass against a ceiling still below the hook's output, which is the
 * bug. Driving the bytes is what makes them fail against the pre-fix module.
 *
 * The payload is a large blob in a throwaway repo read back with
 * `git cat-file blob` — real git output, no network, no dependence on this
 * repository's own contents (a test keyed to a committed baseline's size
 * would rot the moment that baseline shrank).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gitSpawn, gitSync } from '../../.agents/scripts/lib/git-utils.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

const LEGACY_DEFAULT = 1024 * 1024;
/** Above the 2,166,643-byte pre-push output that regressed close. */
const PAYLOAD_BYTES = 3 * 1024 * 1024;

let repoDir;
let blobSha;

describe('git-utils — stdout ceiling (Story #4948)', () => {
  before(() => {
    repoDir = makeTempDir('mandrel-git-maxbuffer-');
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: repoDir });
    const big = path.join(repoDir, 'big.txt');
    writeFileSync(big, 'x'.repeat(PAYLOAD_BYTES));
    blobSha = execFileSync('git', ['hash-object', '-w', 'big.txt'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('AC: gitSync survives child output larger than the 1 MB default', () => {
    const out = gitSync(repoDir, 'cat-file', 'blob', blobSha);
    assert.ok(
      out.length > LEGACY_DEFAULT,
      `expected >1 MB of stdout, got ${out.length} bytes — payload no longer exercises the ceiling`,
    );
  });

  it('AC: gitSpawn survives child output larger than the 1 MB default', () => {
    const res = gitSpawn(repoDir, 'cat-file', 'blob', blobSha);
    assert.equal(
      res.status,
      0,
      `expected exit 0, got ${res.status} (stderr: ${res.stderr.slice(0, 200)})`,
    );
    assert.ok(
      res.stdout.length > LEGACY_DEFAULT,
      `expected >1 MB of stdout, got ${res.stdout.length} bytes`,
    );
  });

  it('AC: the ceiling clears the pre-push output that regressed close', () => {
    // Hook output only grows as gates are added, so a bound tuned to today's
    // 2,166,643 bytes would re-break on the next gate. Assert headroom, not
    // an exact fit.
    const MEASURED_PREPUSH_BYTES = 2_166_643;
    assert.ok(
      PAYLOAD_BYTES > MEASURED_PREPUSH_BYTES,
      'payload must exceed the output that caused the regression',
    );
    const res = gitSpawn(repoDir, 'cat-file', 'blob', blobSha);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.length >= MEASURED_PREPUSH_BYTES);
  });
});
