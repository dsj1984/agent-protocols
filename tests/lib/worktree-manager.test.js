import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  WorktreeManager,
  parseWorktreePorcelain,
} from '../../.agents/scripts/lib/worktree-manager.js';

/**
 * Build a mock `git` object for WorktreeManager. `handlers` maps the
 * first two positional args joined by a space ("worktree add",
 * "status --porcelain", …) to a function `(cwd, args) => { status, stdout, stderr }`.
 */
function mockGit(handlers) {
  const calls = [];
  const dispatch = (cwd, args) => {
    calls.push({ cwd, args });
    const key2 = args.slice(0, 2).join(' ');
    const key1 = args[0];
    const fn = handlers[key2] ?? handlers[key1];
    if (!fn) return { status: 0, stdout: '', stderr: '' };
    return fn(cwd, args);
  };
  return {
    calls,
    gitSync: (cwd, ...args) => {
      const res = dispatch(cwd, args);
      if (res.status !== 0) throw new Error(res.stderr || 'git failed');
      return res.stdout;
    },
    gitSpawn: (cwd, ...args) => dispatch(cwd, args),
  };
}

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

test('parseWorktreePorcelain: parses multi-block porcelain output', () => {
  const raw = [
    'worktree /repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/story-235',
    'HEAD def456',
    'branch refs/heads/story-235',
    '',
    'worktree /repo/.worktrees/bare',
    'bare',
  ].join('\n');
  const recs = parseWorktreePorcelain(raw);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].branch, 'main');
  assert.equal(recs[1].path, '/repo/.worktrees/story-235');
  assert.equal(recs[1].branch, 'story-235');
  assert.equal(recs[2].bare, true);
});

test('constructor: rejects root that escapes repoRoot', () => {
  assert.throws(
    () => new WorktreeManager({
      repoRoot: '/repo',
      config: { root: '../../evil' },
      logger: SILENT_LOGGER,
      git: mockGit({}),
    }),
    /escapes repoRoot/,
  );
});

test('pathFor: resolves .worktrees/story-<id>/ and validates id', () => {
  const wm = new WorktreeManager({
    repoRoot: '/repo',
    logger: SILENT_LOGGER,
    git: mockGit({}),
    platform: 'linux',
  });
  assert.equal(wm.pathFor(235), path.resolve('/repo', '.worktrees', 'story-235'));
  assert.throws(() => wm.pathFor('abc'), /invalid storyId/);
  assert.throws(() => wm.pathFor(-5), /invalid storyId/);
});

test('ensure: rejects branch not matching storyId', async () => {
  const wm = new WorktreeManager({
    repoRoot: '/repo',
    logger: SILENT_LOGGER,
    git: mockGit({}),
    platform: 'linux',
  });
  await assert.rejects(() => wm.ensure(235, 'story-999'), /does not match/);
  await assert.rejects(() => wm.ensure(235, 'main'), /must match/);
});

test('ensure: creates new branch + worktree when neither exists', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const git = mockGit({
      'worktree list': () => ({ status: 0, stdout: 'worktree /repo\nHEAD x\nbranch refs/heads/main\n', stderr: '' }),
      'show-ref': () => ({ status: 1, stdout: '', stderr: '' }),   // branch does not exist
      'worktree add': (_cwd, args) => {
        assert.deepEqual(args.slice(0, 4), ['worktree', 'add', '-b', 'story-235']);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    const res = await wm.ensure(235, 'story-235');
    assert.equal(res.created, true);
    assert.equal(res.path, path.join(tmp, '.worktrees', 'story-235'));
    assert.ok(fs.existsSync(path.join(tmp, '.worktrees')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensure: idempotent when worktree already on correct branch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const wtPath = path.join(tmp, '.worktrees', 'story-235');
    const git = mockGit({
      'worktree list': () => ({
        status: 0,
        stdout: `worktree ${wtPath}\nHEAD x\nbranch refs/heads/story-235\n`,
        stderr: '',
      }),
      'worktree add': () => {
        assert.fail('ensure should not call `worktree add` for existing worktree');
      },
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    const res = await wm.ensure(235, 'story-235');
    assert.equal(res.created, false);
    assert.equal(res.path, wtPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ensure: throws on branch mismatch at existing path', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const wtPath = path.join(tmp, '.worktrees', 'story-235');
    const git = mockGit({
      'worktree list': () => ({
        status: 0,
        stdout: `worktree ${wtPath}\nHEAD x\nbranch refs/heads/story-999\n`,
        stderr: '',
      }),
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    await assert.rejects(() => wm.ensure(235, 'story-235'), /on branch story-999/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isSafeToRemove: refuses on dirty tree', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const wtPath = path.join(tmp, 'dirty');
  fs.mkdirSync(wtPath, { recursive: true });
  try {
    const git = mockGit({
      'status --porcelain': () => ({ status: 0, stdout: ' M file.js', stderr: '' }),
    });
    const wm = new WorktreeManager({ repoRoot: tmp, logger: SILENT_LOGGER, git, platform: 'linux' });
    const r = await wm.isSafeToRemove(wtPath);
    assert.equal(r.safe, false);
    assert.equal(r.reason, 'uncommitted-changes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isSafeToRemove: refuses when branch has unmerged commits vs epic', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const wtPath = path.join(tmp, 'clean');
  fs.mkdirSync(wtPath, { recursive: true });
  try {
    const git = mockGit({
      'status --porcelain': () => ({ status: 0, stdout: '', stderr: '' }),
      'rev-parse': (_cwd, args) => {
        if (args.includes('--abbrev-ref')) return { status: 0, stdout: 'story-235', stderr: '' };
        return { status: 0, stdout: 'TIP_SHA', stderr: '' };
      },
      'show-ref': () => ({ status: 0, stdout: '', stderr: '' }),
      'merge-base': () => ({ status: 0, stdout: 'BASE_SHA', stderr: '' }),
    });
    const wm = new WorktreeManager({ repoRoot: tmp, logger: SILENT_LOGGER, git, platform: 'linux' });
    const r = await wm.isSafeToRemove(wtPath, { epicBranch: 'epic/229' });
    assert.equal(r.safe, false);
    assert.equal(r.reason, 'unmerged-commits');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('isSafeToRemove: safe when clean and merged', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const wtPath = path.join(tmp, 'clean');
  fs.mkdirSync(wtPath, { recursive: true });
  try {
    const git = mockGit({
      'status --porcelain': () => ({ status: 0, stdout: '', stderr: '' }),
      'rev-parse': (_cwd, args) => {
        if (args.includes('--abbrev-ref')) return { status: 0, stdout: 'story-235', stderr: '' };
        return { status: 0, stdout: 'SAME_SHA', stderr: '' };
      },
      'show-ref': () => ({ status: 0, stdout: '', stderr: '' }),
      'merge-base': () => ({ status: 0, stdout: 'SAME_SHA', stderr: '' }),
    });
    const wm = new WorktreeManager({ repoRoot: tmp, logger: SILENT_LOGGER, git, platform: 'linux' });
    const r = await wm.isSafeToRemove(wtPath, { epicBranch: 'epic/229' });
    assert.equal(r.safe, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reap: throws on force=true', async () => {
  const wm = new WorktreeManager({ repoRoot: '/repo', logger: SILENT_LOGGER, git: mockGit({}), platform: 'linux' });
  await assert.rejects(() => wm.reap(235, { force: true }), /--force is not permitted/);
});

test('reap: returns not-a-worktree when path not registered', async () => {
  const git = mockGit({
    'worktree list': () => ({ status: 0, stdout: 'worktree /repo\nHEAD x\nbranch refs/heads/main\n', stderr: '' }),
  });
  const wm = new WorktreeManager({ repoRoot: '/repo', logger: SILENT_LOGGER, git, platform: 'linux' });
  const r = await wm.reap(235);
  assert.equal(r.removed, false);
  assert.equal(r.reason, 'not-a-worktree');
});

test('reap: skips unsafe worktree with warning', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const wtPath = path.join(tmp, '.worktrees', 'story-235');
  fs.mkdirSync(wtPath, { recursive: true });
  try {
    const git = mockGit({
      'worktree list': () => ({
        status: 0,
        stdout: `worktree ${wtPath}\nHEAD x\nbranch refs/heads/story-235\n`,
        stderr: '',
      }),
      'status --porcelain': () => ({ status: 0, stdout: ' M file', stderr: '' }),
      'worktree remove': () => assert.fail('reap must not call remove on unsafe worktree'),
    });
    const warnings = [];
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: { info() {}, warn: (m) => warnings.push(m), error() {} },
      git,
      platform: 'linux',
    });
    const r = await wm.reap(235);
    assert.equal(r.removed, false);
    assert.equal(r.reason, 'uncommitted-changes');
    assert.ok(warnings.some((w) => /reap-skipped/.test(w)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('gc: reaps only worktrees for stories NOT in openStoryIds', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  try {
    const wt235 = path.join(tmp, '.worktrees', 'story-235');
    const wt236 = path.join(tmp, '.worktrees', 'story-236');
    fs.mkdirSync(wt235, { recursive: true });
    fs.mkdirSync(wt236, { recursive: true });
    const removed = [];
    const git = mockGit({
      'worktree list': () => ({
        status: 0,
        stdout: [
          `worktree ${tmp}`, 'HEAD x', 'branch refs/heads/main', '',
          `worktree ${wt235}`, 'HEAD y', 'branch refs/heads/story-235', '',
          `worktree ${wt236}`, 'HEAD z', 'branch refs/heads/story-236', '',
        ].join('\n'),
        stderr: '',
      }),
      'status --porcelain': () => ({ status: 0, stdout: '', stderr: '' }),
      'rev-parse': (cwd, args) => {
        if (args.includes('--abbrev-ref')) {
          const leaf = path.basename(cwd);
          return { status: 0, stdout: leaf, stderr: '' };
        }
        return { status: 0, stdout: 'SHA', stderr: '' };
      },
      'worktree remove': (_cwd, args) => {
        removed.push(args[2]);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    const wm = new WorktreeManager({ repoRoot: tmp, logger: SILENT_LOGGER, git, platform: 'linux' });
    const r = await wm.gc([235]);   // only 235 is still "open"
    assert.deepEqual(r.reaped.map((x) => x.storyId), [236]);
    assert.deepEqual(removed, [wt236]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─────────────────── Integration test (real git) ───────────────────

test('integration: round-trips worktree add and remove on a real repo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-int-'));
  const run = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    run(tmp, 'init', '-b', 'main');
    run(tmp, 'config', 'user.email', 'test@example.com');
    run(tmp, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n');
    run(tmp, 'add', '.');
    run(tmp, 'commit', '-m', 'init');

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      platform: process.platform,
    });

    const ensured = await wm.ensure(42, 'story-42');
    assert.equal(ensured.created, true);
    assert.ok(fs.existsSync(ensured.path));

    const again = await wm.ensure(42, 'story-42');
    assert.equal(again.created, false, 'ensure must be idempotent');

    const list = await wm.list();
    assert.ok(list.some((r) => r.branch === 'story-42'));

    // Main branch fully contains story-42 (no new commits on story-42 yet).
    const reaped = await wm.reap(42, { epicBranch: 'main' });
    assert.equal(reaped.removed, true, `reap failed: ${reaped.reason}`);
    assert.equal(fs.existsSync(ensured.path), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Windows long-path pre-flight warning
// ---------------------------------------------------------------------------

test('ensure: returns windowsPathWarning when estimated path exceeds threshold on win32', async () => {
  // Use a deep repoRoot so wtPath + 80-char allowance crosses the threshold.
  const deepRoot = `C:\\${'x'.repeat(180)}`;
  const warns = [];
  const git = mockGit({
    'worktree list': () => ({ status: 0, stdout: '', stderr: '' }),
    'show-ref': () => ({ status: 1, stdout: '', stderr: '' }),
    'worktree add': () => ({ status: 0, stdout: '', stderr: '' }),
    config: () => ({ status: 0, stdout: '', stderr: '' }),
  });
  const wm = new WorktreeManager({
    repoRoot: deepRoot,
    config: { windowsPathLengthWarnThreshold: 240 },
    logger: { info() {}, warn: (m) => warns.push(m), error() {} },
    git,
    platform: 'win32',
  });
  // Skip the real mkdirSync — deepRoot does not exist on disk. Stub it.
  const originalMkdir = fs.mkdirSync;
  fs.mkdirSync = () => undefined;
  try {
    const res = await wm.ensure(42, 'story-42');
    assert.ok(res.windowsPathWarning, 'warning payload must be present');
    assert.ok(res.windowsPathWarning.length > 240);
    assert.equal(res.windowsPathWarning.threshold, 240);
    assert.ok(warns.some((m) => /windows-long-path/.test(m)));
  } finally {
    fs.mkdirSync = originalMkdir;
  }
});

test('ensure: no windowsPathWarning when path is short', async () => {
  const git = mockGit({
    'worktree list': () => ({ status: 0, stdout: '', stderr: '' }),
    'show-ref': () => ({ status: 1, stdout: '', stderr: '' }),
    'worktree add': () => ({ status: 0, stdout: '', stderr: '' }),
    config: () => ({ status: 0, stdout: '', stderr: '' }),
  });
  const wm = new WorktreeManager({
    repoRoot: 'C:\\repo',
    logger: SILENT_LOGGER,
    git,
    platform: 'win32',
  });
  const originalMkdir = fs.mkdirSync;
  fs.mkdirSync = () => undefined;
  try {
    const res = await wm.ensure(42, 'story-42');
    assert.equal(res.windowsPathWarning, undefined);
  } finally {
    fs.mkdirSync = originalMkdir;
  }
});

test('ensure: never warns on non-win32 even with very long paths', async () => {
  const deepRoot = `/${'x'.repeat(300)}`;
  const warns = [];
  const git = mockGit({
    'worktree list': () => ({ status: 0, stdout: '', stderr: '' }),
    'show-ref': () => ({ status: 1, stdout: '', stderr: '' }),
    'worktree add': () => ({ status: 0, stdout: '', stderr: '' }),
  });
  const wm = new WorktreeManager({
    repoRoot: deepRoot,
    logger: { info() {}, warn: (m) => warns.push(m), error() {} },
    git,
    platform: 'linux',
  });
  const originalMkdir = fs.mkdirSync;
  fs.mkdirSync = () => undefined;
  try {
    const res = await wm.ensure(42, 'story-42');
    assert.equal(res.windowsPathWarning, undefined);
    assert.equal(warns.length, 0);
  } finally {
    fs.mkdirSync = originalMkdir;
  }
});
