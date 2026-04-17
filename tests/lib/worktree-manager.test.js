import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseWorktreePorcelain,
  WorktreeManager,
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
    () =>
      new WorktreeManager({
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
  assert.equal(
    wm.pathFor(235),
    path.resolve('/repo', '.worktrees', 'story-235'),
  );
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
      'worktree list': () => ({
        status: 0,
        stdout: 'worktree /repo\nHEAD x\nbranch refs/heads/main\n',
        stderr: '',
      }),
      'show-ref': () => ({ status: 1, stdout: '', stderr: '' }), // branch does not exist
      'worktree add': (_cwd, args) => {
        assert.deepEqual(args.slice(0, 4), [
          'worktree',
          'add',
          '-b',
          'story-235',
        ]);
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
        assert.fail(
          'ensure should not call `worktree add` for existing worktree',
        );
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
    await assert.rejects(
      () => wm.ensure(235, 'story-235'),
      /on branch story-999/,
    );
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
      'status --porcelain': () => ({
        status: 0,
        stdout: ' M file.js',
        stderr: '',
      }),
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
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
        if (args.includes('--abbrev-ref'))
          return { status: 0, stdout: 'story-235', stderr: '' };
        return { status: 0, stdout: 'TIP_SHA', stderr: '' };
      },
      // `merge-base --is-ancestor` exits 1 when branch is NOT an ancestor
      // of epicBranch — i.e. the branch has unmerged commits.
      'merge-base': () => ({ status: 1, stdout: '', stderr: '' }),
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
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
        if (args.includes('--abbrev-ref'))
          return { status: 0, stdout: 'story-235', stderr: '' };
        return { status: 0, stdout: 'SAME_SHA', stderr: '' };
      },
      'show-ref': () => ({ status: 0, stdout: '', stderr: '' }),
      'merge-base': () => ({ status: 0, stdout: 'SAME_SHA', stderr: '' }),
    });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    const r = await wm.isSafeToRemove(wtPath, { epicBranch: 'epic/229' });
    assert.equal(r.safe, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reap: throws on force=true', async () => {
  const wm = new WorktreeManager({
    repoRoot: '/repo',
    logger: SILENT_LOGGER,
    git: mockGit({}),
    platform: 'linux',
  });
  await assert.rejects(
    () => wm.reap(235, { force: true }),
    /--force is not permitted/,
  );
});

test('reap: returns not-a-worktree when path not registered', async () => {
  const git = mockGit({
    'worktree list': () => ({
      status: 0,
      stdout: 'worktree /repo\nHEAD x\nbranch refs/heads/main\n',
      stderr: '',
    }),
  });
  const wm = new WorktreeManager({
    repoRoot: '/repo',
    logger: SILENT_LOGGER,
    git,
    platform: 'linux',
  });
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
      'status --porcelain': () => ({
        status: 0,
        stdout: ' M file',
        stderr: '',
      }),
      'worktree remove': () =>
        assert.fail('reap must not call remove on unsafe worktree'),
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
          `worktree ${tmp}`,
          'HEAD x',
          'branch refs/heads/main',
          '',
          `worktree ${wt235}`,
          'HEAD y',
          'branch refs/heads/story-235',
          '',
          `worktree ${wt236}`,
          'HEAD z',
          'branch refs/heads/story-236',
          '',
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
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    const r = await wm.gc([235]); // only 235 is still "open"
    assert.deepEqual(
      r.reaped.map((x) => x.storyId),
      [236],
    );
    assert.deepEqual(removed, [wt236]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─────────────────── Integration test (real git) ───────────────────

test('integration: round-trips worktree add and remove on a real repo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-int-'));
  const run = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

// ---------------------------------------------------------------------------
// nodeModulesStrategy — per-worktree / symlink / pnpm-store
// ---------------------------------------------------------------------------

function defaultStrategyGit() {
  return mockGit({
    'worktree list': () => ({ status: 0, stdout: '', stderr: '' }),
    'show-ref': () => ({ status: 1, stdout: '', stderr: '' }),
    'worktree add': (_cwd, args) => {
      // Create the worktree directory so _applyNodeModulesStrategy can find it.
      const wtPath = args[args.length - 1];
      fs.mkdirSync(wtPath, { recursive: true });
      return { status: 0, stdout: '', stderr: '' };
    },
    config: () => ({ status: 0, stdout: '', stderr: '' }),
  });
}

test('nodeModulesStrategy: per-worktree is a no-op (default)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: {}, // default strategy
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });
    const res = await wm.ensure(100, 'story-100');
    assert.equal(fs.existsSync(path.join(res.path, 'node_modules')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: pnpm-store is a no-op (agent runs pnpm install)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: { nodeModulesStrategy: 'pnpm-store' },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });
    const res = await wm.ensure(101, 'story-101');
    assert.equal(fs.existsSync(path.join(res.path, 'node_modules')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: symlink creates link from primed donor', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    // Prime a donor worktree-like directory with node_modules.
    const prime = path.join(tmp, 'prime');
    fs.mkdirSync(path.join(prime, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(prime, 'node_modules', 'pkg', 'index.js'), '//');

    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: {
        nodeModulesStrategy: 'symlink',
        primeFromPath: 'prime',
      },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });

    const res = await wm.ensure(102, 'story-102');
    const nm = path.join(res.path, 'node_modules');
    assert.ok(fs.existsSync(nm), 'symlink should exist');
    // Symlink target resolves to the primed node_modules.
    assert.ok(fs.existsSync(path.join(nm, 'pkg', 'index.js')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: symlink without primeFromPath throws', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: { nodeModulesStrategy: 'symlink' },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });
    await assert.rejects(
      () => wm.ensure(103, 'story-103'),
      /requires orchestration\.worktreeIsolation\.primeFromPath/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: symlink with missing primed node_modules throws', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    // primeFromPath exists but has no node_modules dir.
    fs.mkdirSync(path.join(tmp, 'empty-prime'), { recursive: true });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: {
        nodeModulesStrategy: 'symlink',
        primeFromPath: 'empty-prime',
      },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });
    await assert.rejects(
      () => wm.ensure(104, 'story-104'),
      /no node_modules directory/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: symlink refuses on Windows without explicit opt-in', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    fs.mkdirSync(path.join(tmp, 'prime', 'node_modules'), { recursive: true });
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: {
        nodeModulesStrategy: 'symlink',
        primeFromPath: 'prime',
      },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'win32',
    });
    await assert.rejects(
      () => wm.ensure(105, 'story-105'),
      /refuses on Windows/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('nodeModulesStrategy: unknown value throws (defense-in-depth vs schema)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-strat-'));
  try {
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: { nodeModulesStrategy: 'bogus' },
      logger: SILENT_LOGGER,
      git: defaultStrategyGit(),
      platform: 'linux',
    });
    await assert.rejects(
      () => wm.ensure(106, 'story-106'),
      /unknown nodeModulesStrategy 'bogus'/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_copyBootstrapFiles: default copies .env and .mcp.json when present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env'), 'DATABASE_URL=postgres://x\n');
    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{"servers":{}}\n');
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    wm._copyBootstrapFiles(wtPath);

    assert.equal(
      fs.readFileSync(path.join(wtPath, '.env'), 'utf-8'),
      'DATABASE_URL=postgres://x\n',
    );
    assert.equal(
      fs.readFileSync(path.join(wtPath, '.mcp.json'), 'utf-8'),
      '{"servers":{}}\n',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_copyBootstrapFiles: no-op when source .env does not exist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  try {
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    wm._copyBootstrapFiles(wtPath);

    assert.equal(fs.existsSync(path.join(wtPath, '.env')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_copyBootstrapFiles: never overwrites an existing worktree .env', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env'), 'ROOT=1\n');
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });
    fs.writeFileSync(path.join(wtPath, '.env'), 'AGENT_OVERRIDE=1\n');

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    wm._copyBootstrapFiles(wtPath);

    assert.equal(
      fs.readFileSync(path.join(wtPath, '.env'), 'utf-8'),
      'AGENT_OVERRIDE=1\n',
      'agent-placed .env must survive',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_copyBootstrapFiles: rejects path traversal and absolute paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  try {
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const warns = [];
    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: { bootstrapFiles: ['../../etc/passwd', '/abs/path', '.env'] },
      logger: { info() {}, warn: (m) => warns.push(m), error() {} },
      git: mockGit({}),
      platform: 'linux',
    });
    wm._copyBootstrapFiles(wtPath);

    assert.equal(
      warns.filter((m) => m.includes('skipped invalid')).length,
      2,
      'both traversal and absolute paths should be rejected',
    );
    // Legitimate `.env` in the list should still have been attempted (no
    // source file here, so it's a silent no-op — no warning).
    assert.equal(fs.existsSync(path.join(wtPath, '.env')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_copyBootstrapFiles: honors configured bootstrapFiles list', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  try {
    fs.writeFileSync(path.join(tmp, '.env'), 'A=1\n');
    fs.writeFileSync(path.join(tmp, '.env.test'), 'B=2\n');
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const wm = new WorktreeManager({
      repoRoot: tmp,
      config: { bootstrapFiles: ['.env', '.env.test'] },
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    wm._copyBootstrapFiles(wtPath);

    assert.equal(fs.existsSync(path.join(wtPath, '.env')), true);
    assert.equal(fs.existsSync(path.join(wtPath, '.env.test')), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_linkAgentsToRoot: refuses to wipe root .agents when wtPath equals repoRoot', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-safety-'));
  try {
    const rootAgents = path.join(tmp, '.agents');
    fs.mkdirSync(rootAgents);
    fs.writeFileSync(path.join(rootAgents, 'sentinel.txt'), 'precious');

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    // Force submodule-mode so `_linkAgentsToRoot` actually runs its body.
    wm._isAgentsSubmodule = () => true;

    assert.throws(
      () => wm._linkAgentsToRoot(tmp),
      /refusing to clear root \.agents/,
    );
    assert.equal(
      fs.existsSync(path.join(rootAgents, 'sentinel.txt')),
      true,
      'root .agents must not be touched when wtPath aliases repoRoot',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_unlinkAgentsFromRoot: unlinks symlink even when target case differs (win32)', () => {
  // Simulate the Windows case where readlinkSync returns a path that differs
  // from the constructor-resolved repoRoot only by drive-letter case. On
  // strict-equality comparison this was silently skipped, leaving the
  // junction for `git worktree remove` to traverse. With case-insensitive
  // compare the symlink is unlinked cleanly.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-unlink-'));
  try {
    const rootAgents = path.join(tmp, '.agents');
    fs.mkdirSync(rootAgents);
    fs.writeFileSync(path.join(rootAgents, 'sentinel.txt'), 'precious');

    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });
    const wtAgents = path.join(wtPath, '.agents');
    // Use junction on Windows (doesn't require admin/dev-mode); dir
    // elsewhere. Matches what production does in `_linkAgentsToRoot`.
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(rootAgents, wtAgents, linkType);

    const warns = [];
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: { info() {}, warn: (m) => warns.push(m), error() {} },
      git: mockGit({}),
      // Pretend we're on Windows to exercise case-insensitive path compare.
      platform: 'win32',
    });

    wm._unlinkAgentsFromRoot(wtPath);
    assert.equal(fs.existsSync(wtAgents), false, 'symlink should be unlinked');
    assert.equal(
      fs.existsSync(path.join(rootAgents, 'sentinel.txt')),
      true,
      'root target must survive symlink removal',
    );
    assert.equal(warns.length, 0, 'same canonical target should not warn');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_unlinkAgentsFromRoot: drops .agents gitlink from index in submodule repos', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gitlink-'));
  try {
    fs.writeFileSync(
      path.join(tmp, '.gitmodules'),
      '[submodule ".agents"]\n\tpath = .agents\n\turl = ../agents\n',
    );
    fs.mkdirSync(path.join(tmp, '.agents'));
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const calls = [];
    const git = {
      calls,
      gitSync: () => '',
      gitSpawn: (cwd, ...args) => {
        calls.push({ cwd, args });
        const key2 = args.slice(0, 2).join(' ');
        if (key2 === 'ls-files --stage') {
          return {
            status: 0,
            stdout: '160000 abc123 0\t.agents\n',
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });

    wm._unlinkAgentsFromRoot(wtPath);

    const rmCall = calls.find(
      (c) => c.args[0] === 'rm' && c.args.includes('.agents'),
    );
    assert.ok(rmCall, 'git rm --cached must be called on the gitlink');
    assert.deepEqual(rmCall.args, ['rm', '--cached', '-f', '--', '.agents']);
    assert.equal(
      rmCall.cwd,
      wtPath,
      'rm must target the worktree, not the root',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_unlinkAgentsFromRoot: skips index scrub in non-submodule (framework) repos', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-framework-'));
  try {
    // No .gitmodules → _isAgentsSubmodule() returns false.
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    fs.mkdirSync(wtPath, { recursive: true });

    const calls = [];
    const git = {
      gitSync: () => '',
      gitSpawn: (_cwd, ...args) => {
        calls.push(args[0]);
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git,
      platform: 'linux',
    });
    wm._unlinkAgentsFromRoot(wtPath);
    assert.equal(
      calls.includes('ls-files'),
      false,
      'framework repos must not probe the index',
    );
    assert.equal(calls.includes('rm'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_unlinkAgentsFromRoot: no-op when .agents is a real directory (not a symlink)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-unlink-real-'));
  try {
    const wtPath = path.join(tmp, '.worktrees', 'story-1');
    const wtAgents = path.join(wtPath, '.agents');
    fs.mkdirSync(wtAgents, { recursive: true });
    fs.writeFileSync(path.join(wtAgents, 'keep.txt'), 'keep');

    const wm = new WorktreeManager({
      repoRoot: tmp,
      logger: SILENT_LOGGER,
      git: mockGit({}),
      platform: 'linux',
    });
    wm._unlinkAgentsFromRoot(wtPath);
    assert.equal(
      fs.existsSync(path.join(wtAgents, 'keep.txt')),
      true,
      'real directories must not be disturbed',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
