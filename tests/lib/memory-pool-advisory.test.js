/**
 * tests/lib/memory-pool-advisory.test.js — Story #4919
 *
 * Covers the `/plan` Phase 0 memory-hygiene advisory that replaced the retired
 * memory-freshness scanner: pool resolution (override + cwd-slug), the
 * fail-soft absent path, and each recommend branch.
 *
 * Every case runs against an in-memory `fsImpl` seam and an injected `now` —
 * no child processes, no real home directory, no clock dependence. The
 * advisory spawns nothing by design (the retired scanner's `gh` probes were
 * the reason it could hang), so a test that needed a subprocess would be
 * evidence of a regression.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildMemoryPoolAdvisory,
  ENTRY_COUNT_CEILING,
  resolveMemoryPoolDir,
  STALE_AFTER_DAYS,
  STAMP_FILENAME,
  slugifyProjectPath,
} from '../../.agents/scripts/lib/orchestration/planning/memory-pool-advisory.js';

const HOME = '/home/tester';
const CWD = '/Users/dev/Projects/demo.app';
const POOL = path.join(
  HOME,
  '.claude',
  'projects',
  '-Users-dev-Projects-demo-app',
  'memory',
);
const NOW = '2026-08-02T12:00:00.000Z';

/**
 * Build a minimal node:fs-compatible seam over a `{ path: contents }` map.
 * Directories are the keys of `dirs`; anything else throws ENOENT the way the
 * real `fs` does, so the module's own try/catch paths are exercised rather
 * than bypassed.
 */
function makeFs({ dirs = {}, files = {} } = {}) {
  return {
    statSync(p) {
      if (Object.hasOwn(dirs, p)) return { isDirectory: () => true };
      if (Object.hasOwn(files, p)) return { isDirectory: () => false };
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    readdirSync(p) {
      if (!Object.hasOwn(dirs, p)) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      }
      return dirs[p];
    },
    readFileSync(p) {
      if (!Object.hasOwn(files, p)) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      }
      return files[p];
    },
  };
}

/** A pool of `count` memory entries plus the index, with an optional stamp. */
function poolWith({ count, stamp }) {
  const names = Array.from({ length: count }, (_, i) => `memory-${i}.md`);
  const files = {};
  if (stamp !== undefined) {
    files[path.join(POOL, STAMP_FILENAME)] = stamp;
  }
  return makeFs({ dirs: { [POOL]: ['MEMORY.md', ...names] }, files });
}

const advisory = (opts) =>
  buildMemoryPoolAdvisory({
    cwd: CWD,
    env: {},
    homedir: HOME,
    now: NOW,
    ...opts,
  });

describe('slugifyProjectPath (Story #4919)', () => {
  it('replaces every / and . with - so a checkout maps to its harness project dir', () => {
    assert.equal(
      slugifyProjectPath('/Users/dsj/Development/mandrel'),
      '-Users-dsj-Development-mandrel',
    );
  });

  it('collapses a dotted worktree segment the same way the harness does', () => {
    // Verified against a real ~/.claude/projects entry: the leading `/` and
    // the `.` of `.claude-worktrees` both become `-`, yielding the `--`.
    assert.equal(
      slugifyProjectPath(
        '/Users/dsj/Development/mandrel/.claude-worktrees/adoring-gould-96bdd9',
      ),
      '-Users-dsj-Development-mandrel--claude-worktrees-adoring-gould-96bdd9',
    );
  });
});

describe('resolveMemoryPoolDir (Story #4919)', () => {
  it('lets MANDREL_MEMORY_DIR win outright', () => {
    assert.equal(
      resolveMemoryPoolDir({
        cwd: CWD,
        env: { MANDREL_MEMORY_DIR: '/tmp/pool' },
        homedir: HOME,
      }),
      '/tmp/pool',
    );
  });

  it('falls back to the cwd-slug path under ~/.claude/projects', () => {
    assert.equal(
      resolveMemoryPoolDir({ cwd: CWD, env: {}, homedir: HOME }),
      POOL,
    );
  });

  it('returns null when there is no cwd to slugify', () => {
    assert.equal(
      resolveMemoryPoolDir({ cwd: '', env: {}, homedir: HOME }),
      null,
    );
  });
});

describe('buildMemoryPoolAdvisory — absent pool fails soft (Story #4919)', () => {
  it('reports present:false and recommend:false when the directory does not exist', () => {
    const result = advisory({ fsImpl: makeFs() });
    assert.equal(result.present, false);
    assert.equal(result.recommend, false);
    assert.equal(result.entryCount, 0);
    assert.equal(result.lastConsolidatedAt, null);
    assert.ok(
      result.reasons.length > 0,
      'an absent pool must still explain itself',
    );
  });

  it('fails soft when the pool path is a file rather than a directory', () => {
    const result = advisory({
      fsImpl: makeFs({ files: { [POOL]: 'not a dir' } }),
    });
    assert.equal(result.present, false);
    assert.equal(result.recommend, false);
  });

  it('reads the pool named by MANDREL_MEMORY_DIR, not the cwd-slug path', () => {
    const override = '/tmp/override-pool';
    const fsImpl = makeFs({ dirs: { [override]: ['MEMORY.md', 'a.md'] } });
    const result = buildMemoryPoolAdvisory({
      cwd: CWD,
      env: { MANDREL_MEMORY_DIR: override },
      homedir: HOME,
      now: NOW,
      fsImpl,
    });
    assert.equal(result.present, true);
    assert.equal(result.entryCount, 1);
  });
});

describe('buildMemoryPoolAdvisory — recommend branches (Story #4919)', () => {
  it('recommends when the pool has never been consolidated (no stamp)', () => {
    const result = advisory({ fsImpl: poolWith({ count: 3 }) });
    assert.equal(result.present, true);
    assert.equal(result.entryCount, 3, 'MEMORY.md is the index, not an entry');
    assert.equal(result.lastConsolidatedAt, null);
    assert.equal(result.recommend, true);
    assert.match(result.reasons.join(' '), /never been consolidated/);
  });

  it('recommends when the stamp is older than the staleness threshold', () => {
    const old = new Date(
      Date.parse(NOW) - (STALE_AFTER_DAYS + 5) * 86_400_000,
    ).toISOString();
    const result = advisory({
      fsImpl: poolWith({
        count: 3,
        stamp: JSON.stringify({ lastConsolidatedAt: old }),
      }),
    });
    assert.equal(result.recommend, true);
    assert.equal(result.lastConsolidatedAt, old);
    assert.match(result.reasons.join(' '), /days ago/);
  });

  it('recommends when the entry count is over the ceiling despite a fresh stamp', () => {
    const fresh = new Date(Date.parse(NOW) - 86_400_000).toISOString();
    const result = advisory({
      fsImpl: poolWith({
        count: ENTRY_COUNT_CEILING + 1,
        stamp: JSON.stringify({ lastConsolidatedAt: fresh }),
      }),
    });
    assert.equal(result.recommend, true);
    assert.match(result.reasons.join(' '), /entries \(over the/);
  });

  it('stays quiet when the stamp is fresh and the pool is under the ceiling', () => {
    const fresh = new Date(Date.parse(NOW) - 86_400_000).toISOString();
    const result = advisory({
      fsImpl: poolWith({
        count: 10,
        stamp: JSON.stringify({ lastConsolidatedAt: fresh }),
      }),
    });
    assert.equal(result.present, true);
    assert.equal(result.recommend, false);
  });

  it('treats a malformed stamp as never-consolidated rather than throwing', () => {
    const result = advisory({
      fsImpl: poolWith({ count: 3, stamp: '{ not json' }),
    });
    assert.equal(result.recommend, true);
    assert.equal(result.lastConsolidatedAt, null);
  });

  it('does not recommend consolidating an empty pool', () => {
    const fsImpl = makeFs({ dirs: { [POOL]: ['MEMORY.md'] } });
    const result = advisory({ fsImpl });
    assert.equal(result.present, true);
    assert.equal(result.entryCount, 0);
    assert.equal(result.recommend, false);
  });
});

describe('buildMemoryPoolAdvisory — renders no per-entry verdict (Story #4919)', () => {
  it('exposes only counts and the stamp, never a staleness judgement', () => {
    // The retired scanner's defect was semantic: it marked an entry stale when
    // a cited issue was closed, which is exactly what a delivery retrospective
    // cites. Guard the replacement's shape so that verdict cannot creep back.
    const result = advisory({ fsImpl: poolWith({ count: 5 }) });
    assert.deepEqual(Object.keys(result).sort(), [
      'entryCount',
      'lastConsolidatedAt',
      'present',
      'reasons',
      'recommend',
    ]);
  });
});
