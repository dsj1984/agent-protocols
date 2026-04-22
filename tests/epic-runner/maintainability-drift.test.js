import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createMaintainabilityDriftDetector } from '../../.agents/scripts/lib/orchestration/epic-runner/progress-signals/maintainability-drift.js';

const CWD = path.join(path.sep, 'repo');
const BASELINE_PATH = path.join(
  CWD,
  '.agents/state/maintainability-baseline.json',
);

/**
 * Build a fake fs whose `readFileSync` returns canned content for either the
 * baseline JSON path (via `baseline`) or repo-relative source paths (via
 * `files`). `writeFileSync` captures every write for assertions.
 */
function fakeFs({ baseline = null, files = {} } = {}) {
  const writes = [];
  return {
    writes,
    readFileSync(p) {
      if (baseline && p === BASELINE_PATH) return baseline;
      for (const [rel, contents] of Object.entries(files)) {
        if (p === path.join(CWD, rel)) return contents;
      }
      const err = new Error(`ENOENT: ${p}`);
      err.code = 'ENOENT';
      throw err;
    },
    writeFileSync(p, body) {
      writes.push({ path: p, body });
    },
    mkdirSync() {},
  };
}

describe('maintainability-drift detector', () => {
  it('flags files whose score dropped by >= threshold vs wave-start baseline', async () => {
    const detector = createMaintainabilityDriftDetector({
      cwd: CWD,
      files: ['src/a.js', 'src/b.js'],
      fs: fakeFs({
        baseline: JSON.stringify({
          scores: { 'src/a.js': 80, 'src/b.js': 70 },
        }),
        files: { 'src/a.js': 'a-post', 'src/b.js': 'b-post' },
      }),
      calculate: (src) => (src === 'a-post' ? 50 : 69),
      threshold: 2.0,
    });
    detector.loadBaseline();
    const bullets = await detector.detect();
    assert.deepEqual(bullets, [
      '📉 Maintainability drift: src/a.js -30.00 vs wave-start baseline',
    ]);
  });

  it('returns no bullets before a baseline is captured or loaded', async () => {
    const detector = createMaintainabilityDriftDetector({
      cwd: CWD,
      files: ['src/a.js'],
      fs: fakeFs({ files: { 'src/a.js': 'content' } }),
      calculate: () => 10,
    });
    const bullets = await detector.detect();
    assert.deepEqual(bullets, []);
  });

  it('captureBaseline scores watched files and persists a JSON snapshot', async () => {
    const fs = fakeFs({ files: { 'src/a.js': 'content' } });
    const detector = createMaintainabilityDriftDetector({
      cwd: CWD,
      files: ['src/a.js'],
      fs,
      calculate: () => 73,
    });
    const snap = detector.captureBaseline();
    assert.deepEqual(snap, { 'src/a.js': 73 });
    assert.equal(fs.writes.length, 1);
    assert.equal(fs.writes[0].path, BASELINE_PATH);
    const parsed = JSON.parse(fs.writes[0].body);
    assert.equal(parsed.scores['src/a.js'], 73);
    assert.match(parsed.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('ignores files that fail to read or score at detect time', async () => {
    const detector = createMaintainabilityDriftDetector({
      cwd: CWD,
      files: ['src/a.js', 'src/missing.js'],
      fs: fakeFs({
        baseline: JSON.stringify({
          scores: { 'src/a.js': 90, 'src/missing.js': 90 },
        }),
        files: { 'src/a.js': 'content' }, // missing.js absent
      }),
      // a.js scores 89.5 → drop 0.5, below threshold; missing.js never scores
      calculate: () => 89.5,
      threshold: 2.0,
    });
    detector.loadBaseline();
    const bullets = await detector.detect();
    assert.deepEqual(bullets, []);
  });

  it('does not fire on drops smaller than the threshold', async () => {
    const detector = createMaintainabilityDriftDetector({
      cwd: CWD,
      files: ['src/a.js'],
      fs: fakeFs({
        baseline: JSON.stringify({ scores: { 'src/a.js': 80 } }),
        files: { 'src/a.js': 'content' },
      }),
      calculate: () => 79.5,
      threshold: 2.0,
    });
    detector.loadBaseline();
    const bullets = await detector.detect();
    assert.deepEqual(bullets, []);
  });
});
