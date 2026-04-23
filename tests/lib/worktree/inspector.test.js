import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  isInsideWorktree,
  maybeWarnWindowsPath,
  parseWorktreePorcelain,
  samePath,
  storyIdFromPath,
} from '../../../.agents/scripts/lib/worktree/inspector.js';

test('parseWorktreePorcelain: empty input yields empty array', () => {
  assert.deepEqual(parseWorktreePorcelain(''), []);
});

test('parseWorktreePorcelain: parses main + secondary worktree records', () => {
  const raw = [
    'worktree /repo',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/story-1',
    'HEAD def',
    'branch refs/heads/story-1',
    '',
    'worktree /repo/bare',
    'bare',
  ].join('\n');
  const out = parseWorktreePorcelain(raw);
  assert.equal(out.length, 3);
  assert.equal(out[0].branch, 'main');
  assert.equal(out[1].branch, 'story-1');
  assert.equal(out[2].bare, true);
});

test('parseWorktreePorcelain: detached flag recognised', () => {
  const raw = 'worktree /repo/detached\nHEAD xyz\ndetached\n';
  assert.equal(parseWorktreePorcelain(raw)[0].detached, true);
});

test('samePath: posix case-sensitive', () => {
  assert.equal(samePath('/a/B', '/a/b', 'linux'), false);
  assert.equal(samePath('/a/b', '/a/b', 'linux'), true);
});

test('samePath: windows case-insensitive', () => {
  assert.equal(samePath('C:\\Users\\Foo', 'C:\\users\\foo', 'win32'), true);
});

test('storyIdFromPath: valid story path returns numeric id', () => {
  const root = path.resolve('/repo/.worktrees');
  assert.equal(storyIdFromPath('/repo/.worktrees/story-42', root), 42);
});

test('storyIdFromPath: non-story path returns null', () => {
  const root = path.resolve('/repo/.worktrees');
  assert.equal(storyIdFromPath('/repo/.worktrees/other', root), null);
});

test('storyIdFromPath: path escaping worktreeRoot returns null', () => {
  const root = path.resolve('/repo/.worktrees');
  assert.equal(storyIdFromPath('/other/story-1', root), null);
});

test('isInsideWorktree: equal paths return true', () => {
  assert.equal(
    isInsideWorktree('/repo/.worktrees/a', '/repo/.worktrees/a', 'linux'),
    true,
  );
});

test('isInsideWorktree: nested path returns true', () => {
  assert.equal(
    isInsideWorktree(
      '/repo/.worktrees/a/src/index.js',
      '/repo/.worktrees/a',
      'linux',
    ),
    true,
  );
});

test('isInsideWorktree: sibling returns false', () => {
  assert.equal(
    isInsideWorktree('/repo/.worktrees/b', '/repo/.worktrees/a', 'linux'),
    false,
  );
});

test('maybeWarnWindowsPath: no-op on non-windows', () => {
  const logs = [];
  const result = maybeWarnWindowsPath(
    {
      platform: 'linux',
      threshold: 100,
      logger: { warn: (m) => logs.push(m) },
    },
    'a'.repeat(250),
  );
  assert.equal(result, null);
  assert.equal(logs.length, 0);
});

test('maybeWarnWindowsPath: warns past threshold on windows', () => {
  const logs = [];
  const wtPath = `C:\\${'a'.repeat(200)}`;
  const result = maybeWarnWindowsPath(
    {
      platform: 'win32',
      threshold: 240,
      logger: { warn: (m) => logs.push(m) },
    },
    wtPath,
  );
  assert.ok(result);
  assert.equal(result.threshold, 240);
  assert.equal(logs.length, 1);
});

test('maybeWarnWindowsPath: silent under threshold on windows', () => {
  const logs = [];
  const result = maybeWarnWindowsPath(
    {
      platform: 'win32',
      threshold: 240,
      logger: { warn: (m) => logs.push(m) },
    },
    'C:\\short',
  );
  assert.equal(result, null);
  assert.equal(logs.length, 0);
});
