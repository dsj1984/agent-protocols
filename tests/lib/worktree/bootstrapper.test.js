import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  copyBootstrapFiles,
  dropAgentsGitlinkFromIndex,
  dropAllSubmoduleGitlinksFromIndex,
  isAgentsSubmodule,
} from '../../../.agents/scripts/lib/worktree/bootstrapper.js';

function makeRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'));
}

function quietLogger() {
  const sink = { info: [], warn: [], error: [] };
  return {
    sink,
    logger: {
      info: (m) => sink.info.push(m),
      warn: (m) => sink.warn.push(m),
      error: (m) => sink.error.push(m),
    },
  };
}

test('isAgentsSubmodule: false when no .gitmodules', () => {
  const root = makeRepo();
  assert.equal(isAgentsSubmodule(root), false);
});

test('isAgentsSubmodule: true when .gitmodules declares .agents', () => {
  const root = makeRepo();
  fs.writeFileSync(
    path.join(root, '.gitmodules'),
    '[submodule ".agents"]\n\tpath = .agents\n\turl = https://example/ap\n',
  );
  assert.equal(isAgentsSubmodule(root), true);
});

test('isAgentsSubmodule: false when .gitmodules declares a different submodule', () => {
  const root = makeRepo();
  fs.writeFileSync(
    path.join(root, '.gitmodules'),
    '[submodule "vendor"]\n\tpath = vendor\n\turl = https://example/v\n',
  );
  assert.equal(isAgentsSubmodule(root), false);
});

test('copyBootstrapFiles: copies .env when present in repoRoot and missing in worktree', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, '.env'), 'FOO=bar\n');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  const { logger } = quietLogger();
  copyBootstrapFiles(
    { repoRoot: root, config: { bootstrapFiles: ['.env'] }, logger },
    wt,
  );
  assert.equal(fs.readFileSync(path.join(wt, '.env'), 'utf8'), 'FOO=bar\n');
});

test('copyBootstrapFiles: preserves existing worktree file (no overwrite)', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, '.env'), 'FROM=root\n');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.env'), 'FROM=worktree\n');
  const { logger } = quietLogger();
  copyBootstrapFiles(
    { repoRoot: root, config: { bootstrapFiles: ['.env'] }, logger },
    wt,
  );
  assert.equal(
    fs.readFileSync(path.join(wt, '.env'), 'utf8'),
    'FROM=worktree\n',
  );
});

test('copyBootstrapFiles: rejects traversal names', () => {
  const root = makeRepo();
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  const { logger, sink } = quietLogger();
  copyBootstrapFiles(
    {
      repoRoot: root,
      config: { bootstrapFiles: ['../escape', '/abs/path'] },
      logger,
    },
    wt,
  );
  assert.ok(sink.warn.some((m) => m.includes('skipped invalid name')));
});

test('copyBootstrapFiles: skips missing source files silently', () => {
  const root = makeRepo();
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  const { logger, sink } = quietLogger();
  copyBootstrapFiles(
    { repoRoot: root, config: { bootstrapFiles: ['.env'] }, logger },
    wt,
  );
  assert.equal(sink.warn.length, 0);
  assert.equal(fs.existsSync(path.join(wt, '.env')), false);
});

test('dropAgentsGitlinkFromIndex: no-op when not a submodule repo', () => {
  const root = makeRepo();
  let gitSpawnCalls = 0;
  const git = {
    gitSpawn: () => {
      gitSpawnCalls++;
      return { status: 0, stdout: '', stderr: '' };
    },
  };
  const { logger } = quietLogger();
  dropAgentsGitlinkFromIndex(
    { repoRoot: root, git, logger },
    path.join(root, 'wt'),
  );
  assert.equal(gitSpawnCalls, 0);
});

test('dropAllSubmoduleGitlinksFromIndex: parses gitlinks + issues rm --cached', () => {
  const calls = [];
  const git = {
    gitSpawn: (cwd, ...args) => {
      calls.push({ cwd, args });
      if (args[0] === 'ls-files' && args[1] === '--stage') {
        return {
          status: 0,
          stdout:
            '160000 abcdef1234567890 0\tvendor/dep\n160000 fedcba0987654321 0\tsub/mod\n100644 1234 0\tregular.js\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
  const { logger } = quietLogger();
  dropAllSubmoduleGitlinksFromIndex({ git, logger }, '/repo/wt');
  const rmCalls = calls.filter((c) => c.args[0] === 'rm');
  assert.equal(rmCalls.length, 2);
  assert.deepEqual(
    rmCalls.map((c) => c.args.at(-1)),
    ['vendor/dep', 'sub/mod'],
  );
});
