/**
 * lib/audit-to-stories/ledger-commit.js — persist the cross-run audit ledger.
 *
 * The `--auto` sweep's whole value is memory: `baselines/audit-ledger.json`
 * is what lets the next run tell a re-detection from a fresh finding and an
 * accepted risk from an unseen one. A scheduled sweep, though, typically runs
 * on an ephemeral checkout — a fresh clone that is deleted when the job ends —
 * so the ledger `--auto` writes is discarded and every later sweep starts from
 * an empty memory. The sweep is then permanently amnesiac, and the ledger's
 * suppression and regression signals never fire.
 *
 * This module closes that hole from both ends:
 *
 *   - {@link runLedgerCommit} (`--auto --ledger-commit`) commits the changed
 *     ledger onto a dated `chore/audit-ledger-<YYYY-MM-DD>` branch, pushes it,
 *     and opens a PR against `project.baseBranch` through the `gh` wrapper.
 *     Auto-merge is never requested: a ledger PR records machine-derived state
 *     a human should glance at, so landing it stays an operator decision.
 *   - {@link assessLedgerPersistence} answers the question the *unflagged*
 *     sweep needs — "would this ledger survive?" — so a run that cannot
 *     persist (no `origin`, or HEAD parked off the base branch) says so in its
 *     summary instead of silently discarding the state.
 *
 * Both take injectable `git` / `gh` seams (`.agents/rules/test-seams.md`) so
 * the branch/commit/push/PR argv shape is assertable without a live remote.
 * The logic lives here rather than in `audit-to-stories.js` so the CLI file's
 * complexity budget does not absorb a git driver.
 */

import { gh as defaultGh } from '../gh-exec.js';
import { gitSync } from '../git-utils.js';
import { DEFAULT_LEDGER_PATH } from './ledger.js';

/** Fallback base branch when config carries no `project.baseBranch`. */
const DEFAULT_BASE_BRANCH = 'main';

/**
 * Render the `YYYY-MM-DD` stamp both the branch name and the commit subject
 * carry, so one sweep produces one identifiable ledger branch per day.
 * @param {Date|string|number} [now]
 * @returns {string}
 */
function isoDate(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve `project.baseBranch` defensively: an explicit value wins, then
 * config, then `main`. A failed config resolve must never break a sweep that
 * has already done its real work.
 * @param {string} [explicit]
 * @returns {Promise<string>}
 */
async function resolveBaseBranch(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  try {
    const { resolveConfig } = await import('../config-resolver.js');
    const branch = resolveConfig()?.project?.baseBranch;
    if (typeof branch === 'string' && branch.length > 0) return branch;
  } catch (_) {
    // fall through to the default
  }
  return DEFAULT_BASE_BRANCH;
}

/**
 * Run a read-only git probe that must never throw: a checkout with no commits
 * (or no repository at all) is a legitimate answer of "nothing to report",
 * not a crash. The write path below uses {@link runStep} instead, where a
 * failure IS fatal.
 * @param {(cwd: string, ...args: string[]) => string} git
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string} trimmed stdout, or `''` when git failed.
 */
function probeGit(git, cwd, args) {
  try {
    const out = git(cwd, ...args);
    return typeof out === 'string' ? out.trim() : '';
  } catch (_) {
    return '';
  }
}

/**
 * Wrap one write step so a git or `gh` failure surfaces as a fatal error that
 * names the step that broke. Accepts sync and async steps alike.
 * @param {string} name
 * @param {() => unknown} fn
 * @returns {Promise<unknown>}
 */
async function runStep(name, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new Error(
      `--ledger-commit failed at step "${name}": ${error?.message ?? error}`,
      { cause: error },
    );
  }
}

/**
 * Inspect whether the ledger changed and whether this checkout could persist
 * it at all.
 *
 * `unpersisted` is the signal the unflagged `--auto` summary carries: the
 * sweep produced new memory, and this checkout has nowhere to put it — either
 * there is no `origin` to push to or HEAD is not on the base branch, so a
 * commit here would not reach the repository's shared state.
 *
 * @param {object} [params]
 * @param {string} [params.ledgerPath] — defaults to `baselines/audit-ledger.json`.
 * @param {string} [params.baseBranch] — defaults to resolved `project.baseBranch`.
 * @param {string} [params.cwd]
 * @param {(cwd: string, ...args: string[]) => string} [params.git]
 * @returns {Promise<{ ledgerPath: string, baseBranch: string, changed: boolean,
 *   hasOrigin: boolean, headBranch: string, onBaseBranch: boolean,
 *   unpersisted: boolean }>}
 */
export async function assessLedgerPersistence({
  ledgerPath = DEFAULT_LEDGER_PATH,
  baseBranch,
  cwd = process.cwd(),
  git = gitSync,
} = {}) {
  const base = await resolveBaseBranch(baseBranch);
  const changed =
    probeGit(git, cwd, ['status', '--porcelain', '--', ledgerPath]).length > 0;
  const hasOrigin = probeGit(git, cwd, ['remote'])
    .split('\n')
    .map((line) => line.trim())
    .includes('origin');
  const headBranch = probeGit(git, cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const onBaseBranch = headBranch === base;

  return {
    ledgerPath,
    baseBranch: base,
    changed,
    hasOrigin,
    headBranch,
    onBaseBranch,
    unpersisted: changed && (!hasOrigin || !onBaseBranch),
  };
}

/**
 * Compose the ledger PR body. Kept separate so the step sequence below reads
 * as a sequence and not as a string-building exercise.
 * @param {string} ledgerPath
 * @param {string} date
 * @returns {string}
 */
function pullRequestBody(ledgerPath, date) {
  return [
    `Reconciles the cross-run audit ledger (\`${ledgerPath}\`) written by the`,
    `unattended \`audit-to-stories --auto\` sweep on ${date}.`,
    '',
    'Ledger-only change — no source, workflow or documentation file is touched.',
    'Merging it is what gives the next sweep a memory: without it the ledger',
    'dies with the checkout and every later run re-proposes findings this one',
    'already filed, and re-surfaces findings a human already rejected.',
    '',
    'Auto-merge is deliberately not requested: the ledger records machine-derived',
    'lifecycle state, and a human glance before it lands is the point.',
  ].join('\n');
}

/**
 * Commit the changed ledger onto a dated branch and open a PR for it.
 *
 * Skipped — returning `{ committed: false }` with a `reason` — when the ledger
 * did not change. Every git/`gh` failure is fatal and names its step; the
 * caller runs this *after* printing the run summary, so a broken remote never
 * costs the operator the sweep's findings.
 *
 * @param {object} [params]
 * @param {string} [params.ledgerPath]
 * @param {string} [params.baseBranch]
 * @param {string} [params.cwd]
 * @param {(cwd: string, ...args: string[]) => string} [params.git]
 * @param {{ pr: { create: (flags: string[]) => Promise<unknown> } }} [params.gh]
 * @param {Date|string|number} [params.now]
 * @returns {Promise<{ committed: boolean, reason?: string, branch?: string,
 *   subject?: string, baseBranch?: string, ledgerPath: string }>}
 */
export async function runLedgerCommit({
  ledgerPath = DEFAULT_LEDGER_PATH,
  baseBranch,
  cwd = process.cwd(),
  git = gitSync,
  gh = defaultGh,
  now,
} = {}) {
  const state = await assessLedgerPersistence({
    ledgerPath,
    baseBranch,
    cwd,
    git,
  });
  if (!state.changed) {
    return { committed: false, reason: 'ledger-unchanged', ledgerPath };
  }

  const date = isoDate(now);
  const branch = `chore/audit-ledger-${date}`;
  const subject = `chore(audit): reconcile audit ledger ${date}`;

  await runStep('create-branch', () => git(cwd, 'checkout', '-b', branch));
  await runStep('stage-ledger', () => git(cwd, 'add', '--', ledgerPath));
  // The `-- <path>` pathspec is what keeps the commit ledger-only even when
  // the sweep's checkout carries unrelated dirt.
  await runStep('commit-ledger', () =>
    git(cwd, 'commit', '-m', subject, '--', ledgerPath),
  );
  await runStep('push-branch', () =>
    git(cwd, 'push', '--set-upstream', 'origin', branch),
  );
  await runStep('open-pull-request', () =>
    gh.pr.create([
      '--base',
      state.baseBranch,
      '--head',
      branch,
      '--title',
      subject,
      '--body',
      pullRequestBody(ledgerPath, date),
    ]),
  );

  return {
    committed: true,
    branch,
    subject,
    baseBranch: state.baseBranch,
    ledgerPath,
  };
}
