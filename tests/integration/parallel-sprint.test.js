/**
 * Parallel sprint integration test — Epic #229 AC6 + AC7.
 *
 * Real git, real worktrees. Five concurrent "story agents" each mutate a
 * file and commit, all against the same repo. Proves:
 *
 *   - AC6: no branch-swap races and no WIP cross-contamination — every
 *          story's commit contains exactly that story's file.
 *   - AC7: the main checkout's reflog is quiet — agent activity appears
 *          in per-worktree reflogs, never in the main checkout's.
 *
 * A separate fallback-mode regression check confirms that with isolation
 * disabled the v5.5.1 guards still function (assert-branch rejects a swap).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { assertBranch } from '../../.agents/scripts/assert-branch.js';
import { WorktreeManager } from '../../.agents/scripts/lib/worktree-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGit(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function initRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'par-sprint-'));
  runGit(tmp, 'init', '-q', '-b', 'main');
  runGit(tmp, 'config', 'user.email', 'ci@test.local');
  runGit(tmp, 'config', 'user.name', 'CI');
  runGit(tmp, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(tmp, 'README.md'), '# root\n');
  // Ignore the worktree root so the main checkout's `git status` stays
  // quiet during parallel sprints.
  fs.writeFileSync(path.join(tmp, '.gitignore'), '.worktrees/\n');
  runGit(tmp, 'add', 'README.md', '.gitignore');
  runGit(tmp, 'commit', '-q', '-m', 'init');
  return tmp;
}

function reflogHeadSwaps(cwd) {
  // `git reflog` on a quiet main shows only the initial commit; any HEAD
  // movement (checkout, reset, ...) adds entries. We count entries whose
  // subject line contains "checkout:" — the signature of a branch swap.
  const out = execFileSync('git', ['reflog', '--format=%gs'], {
    cwd,
    encoding: 'utf8',
  });
  return out.split(/\r?\n/).filter((l) => /^checkout:/.test(l)).length;
}

// ---------------------------------------------------------------------------
// Worktree mode — AC6 + AC7
// ---------------------------------------------------------------------------

describe('parallel sprint (worktree mode) — 5 concurrent stories', () => {
  let repo;

  before(() => {
    repo = initRepo();
  });

  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('no WIP cross-contamination and main reflog stays quiet', async () => {
    const mainReflogBefore = reflogHeadSwaps(repo);

    const wm = new WorktreeManager({
      repoRoot: repo,
      config: { root: '.worktrees' },
      logger: { info() {}, warn() {}, error() {} },
      platform: 'linux',
    });

    const storyIds = [301, 302, 303, 304, 305];

    // Simulate 5 concurrent story agents. Each ensures its worktree, writes
    // its own file, commits. All operations run in parallel via Promise.all.
    const results = await Promise.all(
      storyIds.map(async (id) => {
        const { path: wtPath } = await wm.ensure(id, `story-${id}`);
        runGit(wtPath, 'config', 'user.email', 'ci@test.local');
        runGit(wtPath, 'config', 'user.name', 'CI');
        runGit(wtPath, 'config', 'commit.gpgsign', 'false');

        const file = `story-${id}.txt`;
        fs.writeFileSync(path.join(wtPath, file), `owned-by-${id}\n`);
        runGit(wtPath, 'add', file);
        runGit(wtPath, 'commit', '-q', '-m', `feat(story-${id}): add ${file}`);

        const head = runGit(wtPath, 'rev-parse', '--abbrev-ref', 'HEAD');
        const porcelain = runGit(wtPath, 'status', '--porcelain');
        const lastSubject = runGit(wtPath, 'log', '-1', '--format=%s');
        return { id, wtPath, head, porcelain, lastSubject };
      }),
    );

    // AC6a: every worktree ended up on its own story branch.
    for (const r of results) {
      assert.equal(
        r.head,
        `story-${r.id}`,
        `story-${r.id} drifted to ${r.head}`,
      );
    }

    // AC6b: no uncommitted WIP (would indicate a cross-commit swept state).
    for (const r of results) {
      assert.equal(
        r.porcelain,
        '',
        `story-${r.id} has unexpected WIP: ${r.porcelain}`,
      );
    }

    // AC6c: the commit on each story branch mentions exactly that story and
    // touches exactly that story's file — no cross-contamination.
    for (const r of results) {
      assert.match(r.lastSubject, new RegExp(`story-${r.id}`));
      const files = runGit(
        r.wtPath,
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        'HEAD',
      );
      assert.equal(
        files,
        `story-${r.id}.txt`,
        `story-${r.id} commit swept the wrong file(s): ${files}`,
      );
    }

    // AC7: the main checkout's reflog should not have gained any HEAD
    // swap entries from the agent runs. Worktree ensure/dispatch must not
    // touch the main checkout's HEAD.
    const mainReflogAfter = reflogHeadSwaps(repo);
    assert.equal(
      mainReflogAfter,
      mainReflogBefore,
      `main checkout reflog gained ${mainReflogAfter - mainReflogBefore} agent-driven HEAD swap(s)`,
    );

    // Main checkout is still on main, clean.
    assert.equal(runGit(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(runGit(repo, 'status', '--porcelain'), '');
  });
});

// ---------------------------------------------------------------------------
// Fallback (single-tree) mode — v5.5.1 guard still protects
// ---------------------------------------------------------------------------

describe('fallback (single-tree) mode — assert-branch still guards swaps', () => {
  let repo;

  before(() => {
    repo = initRepo();
    // Pre-create two story branches so the shared-tree scenario is realistic.
    runGit(repo, 'checkout', '-q', '-b', 'story-401');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'A');
    runGit(repo, 'add', 'a.txt');
    runGit(repo, 'commit', '-q', '-m', 'story-401: a');
    runGit(repo, 'checkout', '-q', '-b', 'story-402', 'main');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'B');
    runGit(repo, 'add', 'b.txt');
    runGit(repo, 'commit', '-q', '-m', 'story-402: b');
  });

  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('assertBranch detects a HEAD swap between "expected" and commit time', () => {
    runGit(repo, 'checkout', '-q', 'story-401');
    // Another "agent" swaps to story-402 mid-flight.
    runGit(repo, 'checkout', '-q', 'story-402');

    const result = assertBranch('story-401', { cwd: repo });
    assert.equal(result.ok, false, 'guard must detect the drift');
    assert.match(result.reason, /expected "story-401".*on "story-402"/);
  });

  it('assertBranch passes when the working tree is on the expected branch', () => {
    runGit(repo, 'checkout', '-q', 'story-402');
    const result = assertBranch('story-402', { cwd: repo });
    assert.equal(result.ok, true);
    assert.equal(result.actual, 'story-402');
  });
});
