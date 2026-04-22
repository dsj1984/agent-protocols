import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createStalledWorktreeDetector } from '../../.agents/scripts/lib/orchestration/epic-runner/progress-signals/stalled-worktree.js';

const CWD = path.join(path.sep, 'repo');
const wt = (id) => path.join(CWD, '.worktrees', `story-${id}`);

function fakeFs(presentPaths) {
  const set = new Set(presentPaths);
  return {
    existsSync(p) {
      return set.has(p);
    },
  };
}

describe('stalled-worktree detector', () => {
  it('flags done rows whose worktree directory still exists', async () => {
    const detect = createStalledWorktreeDetector({
      cwd: CWD,
      fs: fakeFs([wt(42)]),
    });
    const bullets = await detect([
      { id: 42, state: 'done' },
      { id: 43, state: 'done' },
    ]);
    assert.deepEqual(bullets, [
      '⚠️ Worktree residue: #42 marked done but .worktrees/story-42/ still present',
    ]);
  });

  it('ignores non-done rows even when the directory is present', async () => {
    const detect = createStalledWorktreeDetector({
      cwd: CWD,
      fs: fakeFs([wt(42)]),
    });
    const bullets = await detect([
      { id: 42, state: 'in-flight' },
      { id: 43, state: 'blocked' },
      { id: 44, state: 'queued' },
    ]);
    assert.deepEqual(bullets, []);
  });

  it('returns an empty array when all worktrees have been reaped', async () => {
    const detect = createStalledWorktreeDetector({
      cwd: CWD,
      fs: fakeFs([]),
    });
    const bullets = await detect([
      { id: 42, state: 'done' },
      { id: 43, state: 'done' },
    ]);
    assert.deepEqual(bullets, []);
  });

  it('handles empty row lists without touching fs', async () => {
    let calls = 0;
    const detect = createStalledWorktreeDetector({
      cwd: CWD,
      fs: {
        existsSync() {
          calls++;
          return true;
        },
      },
    });
    const bullets = await detect([]);
    assert.deepEqual(bullets, []);
    assert.equal(calls, 0);
  });
});
