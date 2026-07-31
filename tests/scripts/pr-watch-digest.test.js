/**
 * pr-watch-digest.test.js — Story #4539, extended by Story #4865.
 *
 * The red-path CI digest was Epic-scoped by filename and bailed out
 * (`return null`) whenever no story id was supplied. The v2 Story delivery
 * path has no Epic and invoked the watch with `--pr` alone, so a red check
 * wrote no digest at all — while the module header advertised one. These
 * tests pin the Story-scoped keying and the no-scope bail-out.
 *
 * Story #4865 moved the digest into `lib/orchestration/ci-rerun-guard.js`
 * (the module that also owns the head-SHA discriminator) and gave it the
 * two fields the no-rerun guard adjudicates on: the PR head SHA and the
 * failing check-run identity (run id + run link).
 */

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  resolveDigestScope,
  writeCiDigest,
} from '../../.agents/scripts/lib/orchestration/ci-rerun-guard.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

const FAILURES = [
  { name: 'test', outcome: 'failure' },
  { name: 'lint', outcome: 'failure' },
];

function withTempRoot(fn) {
  const dir = makeTempDir('mandrel-digest-');
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolveDigestScope', () => {
  it('keys on the Story id — the only scope the v2 delivery path has', () => {
    assert.deepEqual(resolveDigestScope({ storyId: 4539 }), {
      kind: 'story',
      id: 4539,
    });
  });

  it('returns null with no scope at all — nothing to key a filename on', () => {
    assert.equal(resolveDigestScope({}), null);
    assert.equal(resolveDigestScope({ storyId: '' }), null);
    assert.equal(resolveDigestScope({ storyId: 'nope' }), null);
  });
});

describe('writeCiDigest', () => {
  it('writes a Story-keyed digest naming the failing check, run id, and log tail', () => {
    withTempRoot((tempRoot) => {
      const out = writeCiDigest({
        storyId: 4539,
        prNumber: 12,
        headSha: 'abc123',
        failures: FAILURES,
        tempRoot,
        cwd: tempRoot,
        prRef: '12',
        checkRunFn: () => ({
          runId: '987654',
          url: 'https://github.com/o/r/actions/runs/987654',
        }),
        logTailFn: () => 'AssertionError: boom',
      });

      assert.ok(out, 'a Story-scoped red path writes a digest');
      assert.equal(path.basename(out.jsonPath), 'story-4539-ci-digest.json');
      assert.equal(path.basename(out.mdPath), 'story-4539-ci-digest.md');

      const digest = JSON.parse(readFileSync(out.jsonPath, 'utf8'));
      assert.equal(digest.storyId, 4539);
      assert.equal(digest.epicId, undefined, 'no Epic key on a Story digest');
      assert.equal(digest.failingCheck, 'test');
      assert.equal(digest.runId, '987654');
      assert.deepEqual(digest.allFailures, FAILURES);

      const md = readFileSync(out.mdPath, 'utf8');
      assert.match(md, /# CI failure digest — Story #4539 \(PR #12\)/);
      assert.match(md, /AssertionError: boom/);
      assert.match(md, /`lint`=failure/, 'secondary failures are listed');
    });
  });

  it('records the head SHA and the failing check-run identity (AC-1)', () => {
    withTempRoot((tempRoot) => {
      const out = writeCiDigest({
        storyId: 4865,
        prNumber: 77,
        headSha: 'deadbeefcafe',
        failures: [{ name: 'baselines', outcome: 'failure' }],
        tempRoot,
        cwd: tempRoot,
        prRef: '77',
        checkRunFn: () => ({
          runId: '5150',
          url: 'https://github.com/o/r/actions/runs/5150',
        }),
        logTailFn: () => 'crap: methodsAbove20 regressed',
      });

      const digest = JSON.parse(readFileSync(out.jsonPath, 'utf8'));
      assert.equal(digest.headSha, 'deadbeefcafe');
      assert.equal(digest.runUrl, 'https://github.com/o/r/actions/runs/5150');
      assert.deepEqual(digest.failingCheckRun, {
        name: 'baselines',
        outcome: 'failure',
        runId: '5150',
        url: 'https://github.com/o/r/actions/runs/5150',
      });
      assert.equal(digest.classification, 'baseline');

      const md = readFileSync(out.mdPath, 'utf8');
      assert.match(md, /\*\*Head SHA:\*\* deadbeefcafe/);
      assert.match(md, /\*\*Run link:\*\* https/);
    });
  });

  it('carries an unresolved earlier red forward instead of overwriting it away', () => {
    withTempRoot((tempRoot) => {
      const common = {
        storyId: 4865,
        prNumber: 77,
        tempRoot,
        cwd: tempRoot,
        prRef: '77',
        logTailFn: () => '',
      };
      writeCiDigest({
        ...common,
        headSha: 'sha-one',
        failures: [{ name: 'test', outcome: 'failure' }],
        checkRunFn: () => ({ runId: '1', url: 'u/1' }),
      });
      const out = writeCiDigest({
        ...common,
        headSha: 'sha-two',
        failures: [{ name: 'lint', outcome: 'failure' }],
        checkRunFn: () => ({ runId: '2', url: 'u/2' }),
      });

      const digest = JSON.parse(readFileSync(out.jsonPath, 'utf8'));
      assert.equal(digest.headSha, 'sha-two');
      assert.equal(digest.priorReds.length, 1);
      assert.equal(digest.priorReds[0].headSha, 'sha-one');
      assert.equal(digest.priorReds[0].failingCheck, 'test');
      assert.match(readFileSync(out.mdPath, 'utf8'), /Unresolved earlier red/);
    });
  });

  it('does not duplicate history when the SAME head reds twice', () => {
    withTempRoot((tempRoot) => {
      const common = {
        storyId: 4865,
        prNumber: 77,
        headSha: 'same-sha',
        tempRoot,
        cwd: tempRoot,
        prRef: '77',
        failures: [{ name: 'test', outcome: 'failure' }],
        checkRunFn: () => ({ runId: '1', url: 'u/1' }),
        logTailFn: () => '',
      };
      writeCiDigest(common);
      const out = writeCiDigest(common);
      const digest = JSON.parse(readFileSync(out.jsonPath, 'utf8'));
      assert.deepEqual(digest.priorReds, []);
    });
  });

  it('returns null when neither scope is supplied, rather than writing an unkeyed file', () => {
    withTempRoot((tempRoot) => {
      const out = writeCiDigest({
        prNumber: 12,
        failures: FAILURES,
        tempRoot,
        cwd: tempRoot,
        prRef: '12',
        checkRunFn: () => ({ runId: '1', url: null }),
        logTailFn: () => '',
      });
      assert.equal(out, null);
    });
  });
});
