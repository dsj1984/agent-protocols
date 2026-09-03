/**
 * cyclomatic-scope.js — which files the cyclomatic ratchet still has to score
 * (Story #5109).
 *
 * `check-cyclomatic.js` re-parsed the whole tree on every run — 0.94 s of
 * escomplex work to re-derive rows that could not have moved. The scan surface
 * is unchanged; only the *scoring* is narrowed, and it is narrowed to exactly
 * the two sets a ratchet verdict can come from:
 *
 *   - **every file already recorded in the baseline**, because `improved`,
 *     `worsened` and `removed` are all computed by re-deriving a recorded
 *     file's current count;
 *   - **everything this branch changed** against `project.baseBranch`,
 *     including the staged, unstaged and untracked working tree, because
 *     `added` is what a change introduces — and a pre-push gate that only
 *     looked at committed work would wave through the breach an operator is
 *     about to commit.
 *
 * A file in neither set is unchanged and unrecorded: it cannot produce a
 * verdict in any bucket.
 *
 * @module lib/cyclomatic-scope
 */

import path from 'node:path';
import { createGitInterface } from './git-utils.js';
import { isIgnoredByGlobs } from './maintainability-utils.js';

/**
 * Git probes whose union is "everything this working copy has touched".
 *
 * Three, not four: `git diff --name-only HEAD` already reports the staged
 * *and* unstaged deltas, so a separate `--cached` pass would only re-list
 * paths this one has, at the cost of another process spawn.
 *
 * @type {ReadonlyArray<ReadonlyArray<string>>}
 */
const CHANGE_PROBES = Object.freeze([
  Object.freeze(['diff', '--name-only', '__BASE__...HEAD']),
  Object.freeze(['diff', '--name-only', 'HEAD']),
  Object.freeze(['ls-files', '--others', '--exclude-standard']),
]);

/**
 * Resolve the set of repo-relative POSIX paths the ratchet still needs to
 * score, or `null` when it must scan the whole tree.
 *
 * **Fails open, never closed.** Any git failure — a shallow clone, a missing
 * base ref, a fixture directory that is not a repository at all — returns
 * `null`, and the caller scans everything. Narrowing on an unreadable scope
 * is how a ratchet silently stops ratcheting; paying for a whole-tree scan is
 * not.
 *
 * @param {{
 *   cwd: string,
 *   baseRef: string,
 *   baselineRows?: Array<{ file?: string }>,
 *   git?: ReturnType<typeof createGitInterface>,
 * }} args
 * Module-private: `resolveScanScope` below is the only caller, and it is the
 * one the CLI actually asks. Exporting both would ship a seam whose only
 * importer is a test, which the `--production` dead-export pass discounts.
 *
 * @returns {Set<string> | null}
 */
function resolveCyclomaticScope({ cwd, baseRef, baselineRows = [], git }) {
  const gitIface = git ?? createGitInterface({});
  const scope = new Set();
  for (const row of baselineRows) {
    if (typeof row?.file === 'string' && row.file) scope.add(row.file);
  }
  for (const probe of CHANGE_PROBES) {
    const argv = probe.map((arg) =>
      arg === '__BASE__...HEAD' ? `${baseRef}...HEAD` : arg,
    );
    const res = gitIface.gitSpawn(cwd, ...argv);
    if (res?.status !== 0) return null;
    for (const line of String(res.stdout ?? '').split('\n')) {
      const file = line.trim().replace(/\\/g, '/');
      if (file) scope.add(file);
    }
  }
  return scope;
}

/**
 * Decide the scan scope for one `check-cyclomatic` invocation.
 *
 * `--update` rewrites the baseline from the current tree, and
 * `BASELINE_SCOPE=full` is the operator's explicit "re-derive everything" —
 * both must see the whole tree, so both return `null`.
 *
 * @param {{
 *   cwd: string,
 *   config?: { project?: { baseBranch?: string } } | null,
 *   update?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   baselineRows?: Array<{ file?: string }>,
 *   git?: ReturnType<typeof createGitInterface>,
 * }} args
 * @returns {Set<string> | null} `null` means "scan everything".
 */
export function resolveScanScope({
  cwd,
  config = null,
  update = false,
  env = process.env,
  baselineRows = [],
  git,
}) {
  if (update || env?.BASELINE_SCOPE === 'full') return null;
  return resolveCyclomaticScope({
    cwd,
    baseRef: config?.project?.baseBranch ?? 'main',
    baselineRows,
    git,
  });
}

/**
 * Reduce a walked file list to the `{ abs, rel }` pairs that will actually be
 * scored, applying the gate's `ignoreGlobs` and then the diff scope.
 *
 * Kept here rather than inside `scanCyclomatic` so "which files count" lives
 * in one module: the ignore rule and the scope rule are the same decision
 * asked twice, and splitting them across two files is how they drift.
 *
 * @param {string[]} files Absolute paths, as walked.
 * @param {{ cwd: string, ignoreGlobs?: string[], scopeFiles?: Set<string> | null }} args
 * @returns {Array<{ abs: string, rel: string }>}
 */
export function selectFilesToScore(
  files,
  { cwd, ignoreGlobs = [], scopeFiles = null },
) {
  const selected = [];
  for (const abs of files) {
    if (isIgnoredByGlobs(abs, ignoreGlobs, cwd)) continue;
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    if (scopeFiles && !scopeFiles.has(rel)) continue;
    selected.push({ abs, rel });
  }
  return selected;
}
