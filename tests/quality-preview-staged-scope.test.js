import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  getStagedFiles,
  resolveMergeHead,
  resolvePreviewScope,
} from '../.agents/scripts/lib/changed-files.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';
import { runCli } from '../.agents/scripts/quality-preview.js';
import { seedGitIdentity } from './fixtures/git-fixture.js';

// Env with every `GIT_*` variable dropped. Under a husky pre-push from a
// linked worktree, git exports GIT_DIR pointing at the shared main gitdir —
// a fixture `git init` under that env writes `core.bare=true` into the MAIN
// checkout's `.git/config` (#4580).
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
);

function git(cwd, ...args) {
  execSync(['git', ...args].join(' '), { cwd, stdio: 'pipe', env: CLEAN_ENV });
}

function initRepo() {
  const repo = makeTempDir('qp-staged-');
  git(repo, 'init');
  seedGitIdentity(repo);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt');
  git(repo, 'commit', '-m', 'init');
  return repo;
}

describe('quality-preview staged scope (git integration)', () => {
  it('staged-only: only index paths appear in staged scope', () => {
    const repo = initRepo();
    fs.writeFileSync(
      path.join(repo, 'staged-only.js'),
      'export const a = 1;\n',
    );
    fs.writeFileSync(
      path.join(repo, 'unstaged-only.js'),
      'export const b = 2;\n',
    );
    git(repo, 'add', 'staged-only.js');

    assert.deepEqual(getStagedFiles({ cwd: repo }), ['staged-only.js']);

    const scope = resolvePreviewScope({ staged: true, cwd: repo });
    assert.equal(scope.scope, 'staged');
    assert.deepEqual([...scope.scopeSet], ['staged-only.js']);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('unstaged-only: cached diff is empty when nothing is staged', () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, 'another-unstaged.js'), 'x\n');
    assert.deepEqual(getStagedFiles({ cwd: repo }), []);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('mixed staged and unstaged: staged scope excludes unstaged-only file', () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, 'mixed-staged.js'), 's\n');
    fs.writeFileSync(path.join(repo, 'mixed-unstaged.js'), 'u\n');
    git(repo, 'add', 'mixed-staged.js');
    fs.appendFileSync(path.join(repo, 'mixed-unstaged.js'), 'edit\n');

    const staged = new Set(getStagedFiles({ cwd: repo }));
    assert.ok(staged.has('mixed-staged.js'));
    assert.ok(!staged.has('mixed-unstaged.js'));

    const scope = resolvePreviewScope({ staged: true, cwd: repo });
    assert.equal(scope.scope, 'staged');
    assert.deepEqual([...scope.scopeSet], ['mixed-staged.js']);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

/**
 * Story #5131 — the base-sync merge case, against real git.
 *
 * `single-story-close`'s base-sync phase tells the operator to run
 * `git merge --no-edit origin/<base>` by hand. A CLEAN merge auto-commits and
 * git never fires `pre-commit`, so only the CONFLICTED case reaches the gate:
 * the operator resolves, runs `git commit`, and the hook scores the index.
 * Before this Story that index was diffed against HEAD — the pre-merge tip —
 * so every file the base branch had landed entered the scope and was scored
 * against the branch's baseline rows.
 */
function initMergeConflict() {
  const repo = makeTempDir('qp-merge-');
  git(repo, 'init');
  seedGitIdentity(repo);
  fs.writeFileSync(path.join(repo, 'shared.js'), 'export const v = 0;\n');
  fs.writeFileSync(path.join(repo, 'base-only.js'), 'export const b = 0;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'init');
  // `git init` picks the default branch from the host's git config, so read
  // it back rather than assuming `main` or `master`.
  const baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: repo,
    encoding: 'utf-8',
    env: CLEAN_ENV,
  }).trim();

  // The Story branch edits the shared file and adds one of its own.
  git(repo, 'checkout', '-b', 'story-x');
  fs.writeFileSync(path.join(repo, 'shared.js'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(repo, 'branch-only.js'), 'export const n = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'branch-work');

  // Meanwhile the base branch moves: it touches the SAME shared file (forcing
  // the conflict) and lands two files the Story branch never saw.
  git(repo, 'checkout', baseBranch);
  fs.writeFileSync(path.join(repo, 'shared.js'), 'export const v = 2;\n');
  fs.writeFileSync(path.join(repo, 'base-only.js'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(repo, 'base-new.js'), 'export const c = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'base-moved');

  // Base-sync: merge the base in, resolve, leave the merge staged but
  // uncommitted — exactly the state `pre-commit` runs in.
  git(repo, 'checkout', 'story-x');
  try {
    git(repo, 'merge', '--no-edit', baseBranch);
  } catch {
    // Expected: the shared file conflicts.
  }
  fs.writeFileSync(path.join(repo, 'shared.js'), 'export const v = 3;\n');
  git(repo, 'add', 'shared.js');
  return repo;
}

describe('quality-preview staged scope during a base-sync merge', () => {
  it('detects the in-progress merge through git, not the filesystem', () => {
    const repo = initMergeConflict();
    const head = resolveMergeHead({ cwd: repo });
    assert.match(head ?? '', /^[0-9a-f]{40}$/);
    assert.equal(
      head,
      execSync('git rev-parse MERGE_HEAD', {
        cwd: repo,
        encoding: 'utf-8',
        env: CLEAN_ENV,
      }).trim(),
    );
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('scopes to the branch contribution and excludes incoming base files', () => {
    const repo = initMergeConflict();

    // What the gate used to see: the base branch's own landed files.
    const naive = new Set(
      execSync('git diff --name-only --cached', {
        cwd: repo,
        encoding: 'utf-8',
        env: CLEAN_ENV,
      })
        .split('\n')
        .filter(Boolean),
    );
    assert.ok(
      naive.has('base-only.js') && naive.has('base-new.js'),
      'precondition: the bare cached diff must carry the incoming base files',
    );

    const staged = new Set(getStagedFiles({ cwd: repo }));
    assert.ok(staged.has('branch-only.js'), 'branch-only work stays in scope');
    assert.ok(
      staged.has('shared.js'),
      'the conflict resolution stays in scope',
    );
    assert.ok(!staged.has('base-only.js'), 'incoming base file is excluded');
    assert.ok(!staged.has('base-new.js'), 'incoming base file is excluded');

    const scope = resolvePreviewScope({ staged: true, cwd: repo });
    assert.equal(scope.scope, 'staged');
    assert.equal(
      scope.diffRef,
      execSync('git rev-parse MERGE_HEAD', {
        cwd: repo,
        encoding: 'utf-8',
        env: CLEAN_ENV,
      }).trim(),
    );
    assert.deepEqual([...scope.scopeSet].sort(), [
      'branch-only.js',
      'shared.js',
    ]);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('names the merge in the quality:preview header', async () => {
    const repo = initMergeConflict();
    // Only the merge probe touches real git here; the gate runners are stubbed
    // so the assertion is about the header, not about scoring a temp repo.
    const empty = { exitCode: 0, envelope: null };
    let out = '';
    await runCli({
      argv: ['--staged'],
      cwd: repo,
      stdout: { write: (s) => (out += s) },
      stderr: { write: () => {} },
      runMi: async () => empty,
      runCrap: async () => empty,
    });
    assert.match(out, /merge in progress: scored against MERGE_HEAD, not HEAD/);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('leaves the header alone when no merge is in progress', async () => {
    const repo = initRepo();
    const empty = { exitCode: 0, envelope: null };
    let out = '';
    await runCli({
      argv: ['--staged'],
      cwd: repo,
      stdout: { write: (s) => (out += s) },
      stderr: { write: () => {} },
      runMi: async () => empty,
      runCrap: async () => empty,
    });
    assert.match(out, /scope=staged \(git diff --cached\)/);
    assert.doesNotMatch(out, /merge in progress/);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('is inert outside a merge — diffRef stays null', () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, 'plain.js'), 'export const p = 1;\n');
    git(repo, 'add', 'plain.js');
    assert.equal(resolveMergeHead({ cwd: repo }), null);
    const scope = resolvePreviewScope({ staged: true, cwd: repo });
    assert.equal(scope.diffRef, null);
    assert.deepEqual([...scope.scopeSet], ['plain.js']);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
