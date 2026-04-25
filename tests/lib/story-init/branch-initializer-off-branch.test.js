/**
 * Off-branch Windows guards for `branch-initializer`:
 *
 *   1. `ensureRepoCoreLongpathsOnWindows` applies repo-level
 *      `core.longpaths=true` once, idempotently, on Windows only.
 *   2. `maybeWarnWindowsPath` defends against undefined wtPath access on the
 *      worktree-off branch.
 *
 * Both guards exist because the worktree-off codepath cannot rely on the
 * per-worktree config + path-length warning emitted by
 * `WorktreeManager.ensure` — that path never runs when isolation is off.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureRepoCoreLongpathsOnWindows } from '../../../.agents/scripts/lib/story-init/branch-initializer.js';
import { maybeWarnWindowsPath } from '../../../.agents/scripts/lib/worktree/inspector.js';

function makeRecordingGit(stdoutMap = {}) {
  const calls = [];
  return {
    calls,
    gitSpawn: (cwd, ...args) => {
      const key = args.join(' ');
      calls.push({ cwd, args });
      const stub = stdoutMap[key];
      if (stub) return stub;
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

test('ensureRepoCoreLongpathsOnWindows: skipped on linux (web runtime)', () => {
  const git = makeRecordingGit();
  const result = ensureRepoCoreLongpathsOnWindows({
    cwd: '/repo',
    platform: 'linux',
    git,
  });
  assert.deepEqual(result, { applied: false, reason: 'not-windows' });
  assert.equal(git.calls.length, 0);
});

test('ensureRepoCoreLongpathsOnWindows: skipped on darwin', () => {
  const git = makeRecordingGit();
  const result = ensureRepoCoreLongpathsOnWindows({
    cwd: '/repo',
    platform: 'darwin',
    git,
  });
  assert.deepEqual(result, { applied: false, reason: 'not-windows' });
  assert.equal(git.calls.length, 0);
});

test('ensureRepoCoreLongpathsOnWindows: applies when unset on win32', () => {
  const git = makeRecordingGit({
    'config --local --get core.longpaths': {
      status: 1,
      stdout: '',
      stderr: '',
    },
    'config --local core.longpaths true': {
      status: 0,
      stdout: '',
      stderr: '',
    },
  });
  const progressLog = [];
  const result = ensureRepoCoreLongpathsOnWindows({
    cwd: '/repo',
    platform: 'win32',
    git,
    progress: (level, msg) => progressLog.push([level, msg]),
  });
  assert.equal(result.applied, true);
  assert.equal(result.reason, 'set');
  assert.equal(git.calls.length, 2);
  assert.match(progressLog[0][1], /core\.longpaths=true/);
});

test('ensureRepoCoreLongpathsOnWindows: idempotent when already set', () => {
  const git = makeRecordingGit({
    'config --local --get core.longpaths': {
      status: 0,
      stdout: 'true\n',
      stderr: '',
    },
  });
  const result = ensureRepoCoreLongpathsOnWindows({
    cwd: '/repo',
    platform: 'win32',
    git,
  });
  assert.deepEqual(result, { applied: false, reason: 'already-set' });
  assert.equal(git.calls.length, 1, 'should not invoke set when already true');
});

test('ensureRepoCoreLongpathsOnWindows: surfaces set-failure without throwing', () => {
  const git = makeRecordingGit({
    'config --local --get core.longpaths': {
      status: 1,
      stdout: '',
      stderr: '',
    },
    'config --local core.longpaths true': {
      status: 1,
      stdout: '',
      stderr: 'permission denied',
    },
  });
  const progressLog = [];
  const result = ensureRepoCoreLongpathsOnWindows({
    cwd: '/repo',
    platform: 'win32',
    git,
    progress: (level, msg) => progressLog.push([level, msg]),
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'set-failed');
  assert.match(progressLog[0][1], /Failed to set core\.longpaths/);
});

test('maybeWarnWindowsPath: returns null on undefined wtPath (off-branch defense)', () => {
  const calls = [];
  const ctx = {
    platform: 'win32',
    threshold: 240,
    logger: { warn: (m) => calls.push(m) },
  };
  assert.equal(maybeWarnWindowsPath(ctx, undefined), null);
  assert.equal(maybeWarnWindowsPath(ctx, null), null);
  assert.equal(maybeWarnWindowsPath(ctx, ''), null);
  assert.equal(calls.length, 0, 'no warning logged for missing path');
});

test('maybeWarnWindowsPath: returns null on non-windows regardless of length', () => {
  const calls = [];
  const longPath = 'a'.repeat(500);
  const ctx = {
    platform: 'linux',
    threshold: 240,
    logger: { warn: (m) => calls.push(m) },
  };
  assert.equal(maybeWarnWindowsPath(ctx, longPath), null);
  assert.equal(calls.length, 0);
});
