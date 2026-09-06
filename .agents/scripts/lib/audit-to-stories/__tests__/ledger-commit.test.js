/**
 * Story #5145 — the `--auto` sweep's cross-run ledger has to survive the
 * checkout that produced it.
 *
 * AC-1: `--ledger-commit` on a changed ledger produces exactly one branch, one
 *       ledger-only commit, one push and one `pr.create` with no auto-merge
 *       flag; `--dry-run` and an unchanged ledger produce none of it.
 * AC-2: without the flag, an unpersistable checkout says so — `ledger.unpersisted`
 *       in the summary plus a stderr line naming the ledger file.
 * AC-3: a failing push or `pr.create` exits non-zero naming the step, and only
 *       after the run summary has already been printed.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../../test-temp.js';
import { assessLedgerPersistence, runLedgerCommit } from '../ledger-commit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../..');
const CLI = path.join(REPO_ROOT, '.agents/scripts/audit-to-stories.js');

const LEDGER = 'baselines/audit-ledger.json';
const NOW = new Date('2026-09-05T12:00:00.000Z');

const FIXTURE = `# Audit: Security

## Executive Summary

Severity tally: Critical 0 / High 1 / Medium 0 / Low 0

## Detailed Findings

### SQLi in login handler
- **Severity:** High
- **Location:** \`src/auth/login.js:42\`
- **Dimension:** security
- **Current State:** The login query concatenates user input.
- **Recommendation:** Parameterise the query.
`;

/**
 * A `gitSync`-shaped recorder. `responses` maps the first argument of a git
 * invocation to canned stdout; `failOn` names a sub-command that throws, so a
 * step failure can be aimed precisely.
 */
function fakeGit({ responses = {}, failOn } = {}) {
  const calls = [];
  const git = (_cwd, ...args) => {
    calls.push(args);
    if (failOn && args[0] === failOn) {
      throw new Error(`git ${failOn} exploded`);
    }
    return responses[args[0]] ?? '';
  };
  git.calls = calls;
  return git;
}

/** A `gh` facade exposing only the `pr.create` seam this module touches. */
function fakeGh({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    pr: {
      create: async (flags) => {
        calls.push(flags);
        if (fail) throw new Error('gh pr create exploded');
        return { stdout: 'https://github.com/o/r/pull/1' };
      },
    },
  };
}

/** git responses describing a dirty ledger on a pushable base branch. */
const CHANGED_ON_BASE = {
  status: ` M ${LEDGER}`,
  remote: 'origin\n',
  'rev-parse': 'main',
};

test('AC-1: a changed ledger yields one branch, one ledger-only commit, one push and one PR', async () => {
  const git = fakeGit({ responses: CHANGED_ON_BASE });
  const gh = fakeGh();

  const result = await runLedgerCommit({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git,
    gh,
    now: NOW,
  });

  assert.equal(result.committed, true);
  assert.equal(result.branch, 'chore/audit-ledger-2026-09-05');
  assert.equal(
    result.subject,
    'chore(audit): reconcile audit ledger 2026-09-05',
  );

  const writes = git.calls.filter(([verb]) =>
    ['checkout', 'add', 'commit', 'push'].includes(verb),
  );
  assert.deepEqual(writes, [
    ['checkout', '-b', 'chore/audit-ledger-2026-09-05'],
    ['add', '--', LEDGER],
    [
      'commit',
      '-m',
      'chore(audit): reconcile audit ledger 2026-09-05',
      '--',
      LEDGER,
    ],
    ['push', '--set-upstream', 'origin', 'chore/audit-ledger-2026-09-05'],
  ]);

  // The commit is scoped by pathspec, so it cannot pick up unrelated dirt.
  const commit = writes.find(([verb]) => verb === 'commit');
  assert.deepEqual(commit.slice(commit.indexOf('--')), ['--', LEDGER]);

  assert.equal(gh.calls.length, 1);
  const flags = gh.calls[0];
  assert.deepEqual(flags.slice(0, 4), [
    '--base',
    'main',
    '--head',
    'chore/audit-ledger-2026-09-05',
  ]);
  // Auto-merge is never requested — a human lands the ledger PR.
  assert.ok(
    !flags.some((f) => /auto/i.test(f) && f.startsWith('--')),
    `unexpected auto-merge flag in ${JSON.stringify(flags)}`,
  );
});

test('AC-1: an unchanged ledger commits nothing and opens no PR', async () => {
  const git = fakeGit({
    responses: { remote: 'origin\n', 'rev-parse': 'main' },
  });
  const gh = fakeGh();

  const result = await runLedgerCommit({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git,
    gh,
    now: NOW,
  });

  assert.deepEqual(result, {
    committed: false,
    reason: 'ledger-unchanged',
    ledgerPath: LEDGER,
  });
  assert.equal(
    git.calls.some(([verb]) =>
      ['checkout', 'add', 'commit', 'push'].includes(verb),
    ),
    false,
  );
  assert.equal(gh.calls.length, 0);
});

test('AC-1: --dry-run never reaches the ledger-commit tail', async () => {
  const { runAuditToStories } = await import(pathToFileURL(CLI).href);
  const commits = [];

  await runAuditToStories(['--auto', '--dry-run', '--ledger-commit'], {
    runAutoImpl: async () => ({ summary: { mode: 'auto' }, stories: [] }),
    persistImpl: () => {},
    runLedgerCommitImpl: async (opts) => {
      commits.push(opts);
      return { committed: true };
    },
    stdout: { write: () => {} },
  });

  assert.deepEqual(commits, []);
});

test('AC-2: an unpersistable checkout reports ledger.unpersisted and warns by name', () => {
  const workDir = makeTempDir('audit-ledger-unpersisted-');
  fs.mkdirSync(path.join(workDir, 'audits'), { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'audits', 'audit-security-results.md'),
    FIXTURE,
  );
  // A repository with no `origin` remote — the ephemeral-clone shape.
  execFileSync('git', ['init', '--quiet'], { cwd: workDir });

  const proc = spawnSync(
    process.execPath,
    [CLI, '--auto', '--no-provider', '--glob', 'audits/*.md'],
    { cwd: workDir, encoding: 'utf8' },
  );

  assert.equal(proc.status, 0, proc.stderr);
  const summary = JSON.parse(proc.stdout.slice(proc.stdout.indexOf('{')));
  assert.equal(summary.ledger.unpersisted, true);
  assert.match(proc.stderr, /ledger not persisted/);
  assert.ok(
    proc.stderr.includes(LEDGER),
    `stderr must name ${LEDGER}: ${proc.stderr}`,
  );
});

test('AC-2: assessLedgerPersistence flags a changed ledger off the base branch', async () => {
  const offBase = await assessLedgerPersistence({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git: fakeGit({
      responses: {
        status: ` M ${LEDGER}`,
        remote: 'origin\n',
        'rev-parse': 'story-1',
      },
    }),
  });
  assert.equal(offBase.unpersisted, true);
  assert.equal(offBase.onBaseBranch, false);

  const noOrigin = await assessLedgerPersistence({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git: fakeGit({
      responses: { status: ` M ${LEDGER}`, 'rev-parse': 'main' },
    }),
  });
  assert.equal(noOrigin.unpersisted, true);
  assert.equal(noOrigin.hasOrigin, false);

  // Persistable: changed, on the base branch, with a remote to push to.
  const ok = await assessLedgerPersistence({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git: fakeGit({ responses: CHANGED_ON_BASE }),
  });
  assert.equal(ok.unpersisted, false);

  // Unchanged is never "unpersisted" — there is nothing to lose.
  const clean = await assessLedgerPersistence({
    ledgerPath: LEDGER,
    baseBranch: 'main',
    cwd: '/repo',
    git: fakeGit({ responses: { remote: '', 'rev-parse': 'story-1' } }),
  });
  assert.equal(clean.unpersisted, false);
});

test('AC-3: a failing push or pr.create throws naming the failed step', async () => {
  await assert.rejects(
    runLedgerCommit({
      ledgerPath: LEDGER,
      baseBranch: 'main',
      cwd: '/repo',
      git: fakeGit({ responses: CHANGED_ON_BASE, failOn: 'push' }),
      gh: fakeGh(),
      now: NOW,
    }),
    /--ledger-commit failed at step "push-branch"/,
  );

  await assert.rejects(
    runLedgerCommit({
      ledgerPath: LEDGER,
      baseBranch: 'main',
      cwd: '/repo',
      git: fakeGit({ responses: CHANGED_ON_BASE }),
      gh: fakeGh({ fail: true }),
      now: NOW,
    }),
    /--ledger-commit failed at step "open-pull-request"/,
  );
});

test('AC-3: the run summary is printed before the ledger-commit failure', async () => {
  const { runAuditToStories } = await import(pathToFileURL(CLI).href);
  const persisted = [];

  await assert.rejects(
    runAuditToStories(['--auto', '--ledger-commit'], {
      runAutoImpl: async () => ({
        summary: { mode: 'auto', totals: { create: 1 } },
        stories: [],
      }),
      persistImpl: (text) => persisted.push(text),
      runLedgerCommitImpl: async () => {
        throw new Error('--ledger-commit failed at step "push-branch": boom');
      },
      stdout: { write: () => {} },
    }),
    /--ledger-commit failed at step "push-branch"/,
  );

  assert.equal(
    persisted.length,
    1,
    'summary must be persisted before the throw',
  );
  assert.match(persisted[0], /"mode": "auto"/);
});
