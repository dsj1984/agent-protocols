import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanupPhaseTempFiles,
  PHASE_TEMP_PATHS,
  resolvePhaseTempPaths,
} from '../.agents/scripts/lib/plan-phase-cleanup.js';

describe('plan-phase-cleanup.resolvePhaseTempPaths', () => {
  it('interpolates the epic id into every spec-phase path', () => {
    const paths = resolvePhaseTempPaths('spec', 441, '/repo');
    assert.equal(paths.length, PHASE_TEMP_PATHS.spec.length);
    assert.ok(paths.every((p) => p.includes('441')));
    assert.ok(paths.some((p) => p.endsWith('prd-epic-441.md')));
  });

  it('interpolates the epic id into every decompose-phase path', () => {
    const paths = resolvePhaseTempPaths('decompose', 7, '/repo');
    assert.equal(paths.length, PHASE_TEMP_PATHS.decompose.length);
    assert.ok(paths.some((p) => p.endsWith('tickets-epic-7.json')));
  });

  it('throws on an unknown phase', () => {
    assert.throws(
      () => resolvePhaseTempPaths('nonsense', 1, '/repo'),
      /Unknown phase/,
    );
  });
});

describe('plan-phase-cleanup.cleanupPhaseTempFiles', () => {
  it('classifies outcomes into deleted / missing / failed', async () => {
    const unlinked = [];
    const fakeUnlink = async (p) => {
      unlinked.push(p);
      if (p.endsWith('prd-epic-1.md')) return; // success
      if (p.endsWith('techspec-epic-1.md')) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      throw new Error('disk on fire');
    };
    const logger = { warn: () => {} };
    const result = await cleanupPhaseTempFiles({
      phase: 'spec',
      epicId: 1,
      repoRoot: '/repo',
      unlink: fakeUnlink,
      logger,
    });
    assert.equal(result.deleted.length, 1);
    assert.equal(result.missing.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(unlinked.length, PHASE_TEMP_PATHS.spec.length);
  });

  it('returns empty buckets when no files match', async () => {
    const result = await cleanupPhaseTempFiles({
      phase: 'decompose',
      epicId: 99,
      repoRoot: '/repo',
      unlink: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    assert.equal(result.deleted.length, 0);
    assert.equal(result.missing.length, PHASE_TEMP_PATHS.decompose.length);
    assert.equal(result.failed.length, 0);
  });
});
