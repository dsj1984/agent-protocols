import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';

import {
  RECOVERY_STATES,
  detectPriorState,
} from '../.agents/scripts/lib/orchestration/sprint-story-close-recovery.js';

function makeGit({
  mainStatus = '',
  wtStatusByPath = {},
  lsRemote = '',
  ancestorExit = 1,
} = {}) {
  return {
    status(cwd) {
      if (cwd === '/repo') return { status: 0, stdout: mainStatus };
      return { status: 0, stdout: wtStatusByPath[cwd] ?? '' };
    },
    lsRemote(_cwd, _ref) {
      return { status: 0, stdout: lsRemote };
    },
    isAncestor(_cwd, _a, _b) {
      return { status: ancestorExit };
    },
  };
}

function makeFs(existingPaths = []) {
  return { existsSync: (p) => existingPaths.includes(p) };
}

const CWD = '/repo';

test('detectPriorState', async (t) => {
  await t.test('returns fresh when no signals match', () => {
    const result = detectPriorState({
      cwd: CWD,
      storyId: 100,
      git: makeGit(),
      fs: makeFs([]),
    });
    assert.strictEqual(result.state, RECOVERY_STATES.FRESH);
  });

  await t.test('returns partial-merge when UU markers present', () => {
    const result = detectPriorState({
      cwd: CWD,
      storyId: 100,
      git: makeGit({ mainStatus: 'UU some/file.js\n M other.js\n' }),
      fs: makeFs([]),
    });
    assert.strictEqual(result.state, RECOVERY_STATES.PARTIAL_MERGE);
    assert.strictEqual(result.detail.checkout, CWD);
  });

  await t.test(
    'returns uncommitted-worktree when worktree exists and dirty',
    () => {
      const wtPath = path.join(CWD, '.worktrees', 'story-100');
      const result = detectPriorState({
        cwd: CWD,
        storyId: 100,
        git: makeGit({
          wtStatusByPath: { [wtPath]: ' M src/index.js\n' },
        }),
        fs: makeFs([wtPath]),
      });
      assert.strictEqual(result.state, RECOVERY_STATES.UNCOMMITTED_WORKTREE);
      assert.strictEqual(result.detail.worktreePath, wtPath);
    },
  );

  await t.test('skips uncommitted-worktree when worktree is clean', () => {
    const wtPath = path.join(CWD, '.worktrees', 'story-100');
    const result = detectPriorState({
      cwd: CWD,
      storyId: 100,
      git: makeGit({ wtStatusByPath: { [wtPath]: '' } }),
      fs: makeFs([wtPath]),
    });
    assert.strictEqual(result.state, RECOVERY_STATES.FRESH);
  });

  await t.test(
    'returns pushed-unmerged when remote story branch exists and not merged',
    () => {
      const result = detectPriorState({
        cwd: CWD,
        storyId: 100,
        epicId: 42,
        git: makeGit({
          lsRemote: 'abc123\trefs/heads/story-100\n',
          ancestorExit: 1, // not an ancestor → not yet merged
        }),
        fs: makeFs([]),
      });
      assert.strictEqual(result.state, RECOVERY_STATES.PUSHED_UNMERGED);
      assert.match(result.detail.remoteRef, /story-100/);
    },
  );

  await t.test(
    'returns fresh when remote branch exists but is already merged into epic',
    () => {
      const result = detectPriorState({
        cwd: CWD,
        storyId: 100,
        epicId: 42,
        git: makeGit({
          lsRemote: 'abc123\trefs/heads/story-100\n',
          ancestorExit: 0, // already merged
        }),
        fs: makeFs([]),
      });
      assert.strictEqual(result.state, RECOVERY_STATES.FRESH);
    },
  );

  await t.test('partial-merge takes priority over dirty worktree', () => {
    const wtPath = path.join(CWD, '.worktrees', 'story-100');
    const result = detectPriorState({
      cwd: CWD,
      storyId: 100,
      git: makeGit({
        mainStatus: 'UU conflict.js\n',
        wtStatusByPath: { [wtPath]: ' M dirty.js\n' },
      }),
      fs: makeFs([wtPath]),
    });
    assert.strictEqual(result.state, RECOVERY_STATES.PARTIAL_MERGE);
  });

  await t.test(
    'dirty worktree takes priority over pushed-unmerged remote',
    () => {
      const wtPath = path.join(CWD, '.worktrees', 'story-100');
      const result = detectPriorState({
        cwd: CWD,
        storyId: 100,
        epicId: 42,
        git: makeGit({
          wtStatusByPath: { [wtPath]: ' M dirty.js\n' },
          lsRemote: 'abc123\trefs/heads/story-100\n',
          ancestorExit: 1,
        }),
        fs: makeFs([wtPath]),
      });
      assert.strictEqual(result.state, RECOVERY_STATES.UNCOMMITTED_WORKTREE);
    },
  );

  await t.test('throws without required cwd/storyId', () => {
    assert.throws(() => detectPriorState({ storyId: 1 }), /cwd is required/);
    assert.throws(() => detectPriorState({ cwd: '/x' }), /storyId is required/);
  });

  await t.test('honors custom worktreeRoot', () => {
    const wtPath = path.join(CWD, 'custom-wt', 'story-100');
    const result = detectPriorState({
      cwd: CWD,
      storyId: 100,
      worktreeRoot: 'custom-wt',
      git: makeGit({ wtStatusByPath: { [wtPath]: ' M f.js\n' } }),
      fs: makeFs([wtPath]),
    });
    assert.strictEqual(result.state, RECOVERY_STATES.UNCOMMITTED_WORKTREE);
  });
});
