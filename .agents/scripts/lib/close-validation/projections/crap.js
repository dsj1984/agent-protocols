// .agents/scripts/lib/close-validation/projections/crap.js
/**
 * crap.js — pre-merge CRAP ceiling projection helper (Story #4776).
 *
 * The CRAP analogue of `projections/maintainability.js`. Both answer the
 * same operator question before the merge runs: *given what this branch
 * changed, which committed baseline rows would the post-merge tree breach,
 * and what is the exact remedy?*
 *
 * Advisory only. `check-baselines` already fails close-validation closed on
 * a real regression; duplicating that here would double-gate the same
 * defect. What this projection adds is the **refresh** half of the loop —
 * naming the breaching methods and the `npm run crap:update` +
 * `baseline-refresh:` remedy while the operator still has the branch in
 * hand, so a corrected baseline does not rot back into staleness.
 *
 * The helper never throws and never mutates anything. Every failure path
 * resolves to `{ ok: true, breaches: [], skipped: '<reason>' }` so the
 * caller can treat the advisory as best-effort.
 *
 * Post-merge approximation: CRAP needs a coverage join, so — unlike the MI
 * projection, which scores a `git show` blob — the scorer reads the working
 * tree. Close-validation runs inside the Story worktree at the branch tip,
 * which is exactly the content a squash-merge lands, so the approximation is
 * exact whenever the merge applies cleanly.
 */

import path from 'node:path';
import {
  compareCrap,
  filterRowsByFileScope,
} from '../../baselines/kinds/crap.js';
import { loadFile as loadBaselineFile } from '../../baselines/reader.js';
import { diffNameOnly } from '../../changed-files.js';
import { loadCoverage } from '../../coverage-utils.js';
import { scanAndScore } from '../../crap-utils.js';
import { cachedGitFetchSync } from '../../git/cached-fetch.js';
import { gitSpawn as defaultGitSpawn } from '../../git-utils.js';
import { SCORABLE_SOURCE_EXT_RE } from '../../source-extensions.js';
import { MISSING_ARG_REASONS, validateProjectionInputs } from './inputs.js';

/**
 * Default absolute tolerance on a projected CRAP score, shared with
 * `check-crap`'s regression arm: floating-point noise must not register as
 * a breach.
 */
export const DEFAULT_CRAP_TOLERANCE = 0.001;

/** Framework default for the new-method ceiling (`gates.crap.newMethodCeiling`). */
export const DEFAULT_NEW_METHOD_CEILING = 30;

/**
 * Map the shared predicate's fine-grained `missing-*` reason onto the
 * `missing-args` skipped-reason the sibling MI projection reports, so both
 * projections speak one vocabulary at the advisory boundary.
 *
 * @param {string} reason
 * @returns {string}
 */
function normaliseSkipReason(reason) {
  return MISSING_ARG_REASONS.has(reason) ? 'missing-args' : reason;
}

/**
 * Read the committed CRAP baseline and re-key its rows onto the `file`
 * field `compareCrap` matches on (the on-disk v2 envelope keys on `path`).
 * Returns `[]` when the baseline is absent or unreadable — the caller maps
 * that to the `no-baseline` skip.
 *
 * Deliberately module-local: `projectCrapBreaches`'s `loadBaseline` default
 * is the single production door to it, and tests inject their own loader.
 * Exporting it would add a second entry point nothing in production reaches
 * — which is precisely the orphaning this Story exists to stop.
 *
 * @param {string} baselinePath absolute path to `baselines/crap.json`
 * @returns {Array<{file: string, method: string, startLine: number, crap: number}>}
 */
function loadCrapBaselineRows(baselinePath) {
  let envelope;
  try {
    envelope = loadBaselineFile(baselinePath, { kind: 'crap' });
  } catch {
    return [];
  }
  const rows = Array.isArray(envelope?.rows) ? envelope.rows : [];
  return rows.map((row) => ({
    file: row.path,
    method: row.method,
    startLine: row.startLine,
    crap: row.crap,
  }));
}

/**
 * Build the default working-tree CRAP scorer. Returns an async callable
 * `(files) => rows | null`; `null` signals "coverage artifact missing under
 * `requireCoverage`", which the projection reports as the `no-coverage`
 * skip rather than as a clean run.
 *
 * @param {{
 *   cwd: string,
 *   targetDirs?: string[],
 *   ignoreGlobs?: string[],
 *   requireCoverage?: boolean,
 *   coveragePath?: string,
 * }} opts
 * @returns {(files: string[]) => Promise<Array<object>|null>}
 */
export function createCrapScorer({
  cwd,
  targetDirs = [],
  ignoreGlobs = [],
  requireCoverage = true,
  coveragePath = 'coverage/coverage-final.json',
} = {}) {
  return async (files) => {
    const abs = path.isAbsolute(coveragePath)
      ? coveragePath
      : path.resolve(cwd, coveragePath);
    const coverage = loadCoverage(abs);
    if (!coverage && requireCoverage) return null;
    const { rows } = await scanAndScore({
      targetDirs,
      coverage,
      requireCoverage,
      cwd,
      ignoreGlobs,
      scopeFiles: files,
    });
    return rows ?? [];
  };
}

/**
 * Refresh `origin/<baseBranch>` so the diff range resolves even when close
 * has not reached its own base-sync step. Routed through the shared fetch
 * cache so a story-init fetch in the same run satisfies it for free.
 *
 * @param {string} cwd
 * @param {string} baseBranch
 * @param {{ gitSpawn: typeof defaultGitSpawn }} git
 * @returns {{ ok: true } | { ok: false, detail: string }}
 */
function refreshBaseRef(cwd, baseBranch, git) {
  const res = cachedGitFetchSync(cwd, baseBranch, { gitSpawn: git.gitSpawn });
  if (res.status !== 0) {
    return {
      ok: false,
      detail: res.stderr || res.stdout || `exit ${res.status}`,
    };
  }
  return { ok: true };
}

/**
 * Enumerate the Story branch's changed files, narrowed by the shared
 * scorable-source extension set (`source-extensions.js`) so the projection
 * selects exactly the files the CRAP scanner walks.
 *
 * @param {{ cwd: string, baseBranch: string, storyBranch: string, git: { gitSpawn: typeof defaultGitSpawn } }} opts
 * @returns {{ ok: true, files: string[] } | { ok: false, detail: string }}
 */
function diffScorableFiles({ cwd, baseBranch, storyBranch, git }) {
  try {
    const files = diffNameOnly({
      range: `origin/${baseBranch}...${storyBranch}`,
      cwd,
      gitSpawn: git.gitSpawn,
    });
    return {
      ok: true,
      files: files.filter((f) => SCORABLE_SOURCE_EXT_RE.test(f)),
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

/**
 * Project the post-merge CRAP scores for every file changed on the Story
 * branch and return the subset of methods that would breach either their
 * committed baseline row or, for methods with no baseline row, the
 * configured `newMethodCeiling`.
 *
 * Baseline rows are narrowed to the changed-file set before the compare so
 * every untouched file's rows are not spuriously reported as removed.
 *
 * @param {{
 *   cwd: string,
 *   baseBranch: string,
 *   storyBranch: string,
 *   baselinePath: string,
 *   newMethodCeiling?: number,
 *   tolerance?: number,
 *   git?: { gitSpawn: typeof defaultGitSpawn },
 *   loadBaseline?: (path: string) => Array<object>,
 *   scoreFiles?: (files: string[]) => Promise<Array<object>|null>|Array<object>|null,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   breaches: Array<object>,
 *   skipped?: string,
 *   detail?: string,
 * }>}
 */
export async function projectCrapBreaches({
  cwd,
  baseBranch,
  storyBranch,
  baselinePath,
  newMethodCeiling = DEFAULT_NEW_METHOD_CEILING,
  tolerance = DEFAULT_CRAP_TOLERANCE,
  git = { gitSpawn: defaultGitSpawn },
  loadBaseline = loadCrapBaselineRows,
  scoreFiles,
} = {}) {
  const skip = (reason, detail) => ({
    ok: true,
    breaches: [],
    skipped: reason,
    ...(detail === undefined ? {} : { detail }),
  });

  const validation = validateProjectionInputs({
    cwd,
    baseBranch,
    storyBranch,
    baselinePath,
  });
  if (!validation.ok) return skip(normaliseSkipReason(validation.reason));

  const baselineRows = loadBaseline(baselinePath);
  if (!Array.isArray(baselineRows) || baselineRows.length === 0) {
    return skip('no-baseline');
  }

  const fetched = refreshBaseRef(cwd, baseBranch, git);
  if (!fetched.ok) return skip('fetch-failed', fetched.detail);

  const diffed = diffScorableFiles({ cwd, baseBranch, storyBranch, git });
  if (!diffed.ok) return skip('diff-failed', diffed.detail);
  if (diffed.files.length === 0) return skip('no-scorable-files');

  const scorer =
    typeof scoreFiles === 'function' ? scoreFiles : createCrapScorer({ cwd });
  let currentRows;
  try {
    currentRows = await scorer(diffed.files);
  } catch (err) {
    return skip('score-failed', err?.message ?? String(err));
  }
  if (currentRows === null || currentRows === undefined) {
    return skip('no-coverage');
  }
  if (currentRows.length === 0) return skip('no-scored-methods');

  const scopeSet = new Set(diffed.files);
  const result = compareCrap({
    currentRows,
    baselineRows: filterRowsByFileScope(baselineRows, scopeSet),
    newMethodCeiling,
    tolerance,
  });
  const breaches = result.violations ?? [];
  return { ok: breaches.length === 0, breaches };
}

/**
 * Render one breach as an advisory bullet. New-method breaches name the
 * ceiling they cleared; regressions name the baseline row they exceeded.
 *
 * @param {object} b
 * @returns {string}
 */
function formatBreach(b) {
  const where = `${b.file}::${b.method} (line ${b.startLine})`;
  const projected = Number(b.crap ?? 0).toFixed(2);
  if (b.kind === 'new') {
    return `  • ${where}  projected=${projected}  ceiling=${b.ceiling}  [new method]`;
  }
  const baseline = Number(b.baseline ?? 0).toFixed(2);
  return `  • ${where}  projected=${projected}  baseline=${baseline}  [${b.kind}]`;
}

/**
 * Render the pre-merge CRAP advisory as a human-readable multi-line log
 * block, naming every breaching method and the exact refresh remedy.
 * Returns `null` when there is nothing to surface so callers can `if` past
 * the log call without a string-empty check.
 *
 * @param {Awaited<ReturnType<typeof projectCrapBreaches>>} result
 * @returns {string | null}
 */
export function formatCrapProjection(result) {
  if (!result || !Array.isArray(result.breaches)) return null;
  if (result.breaches.length === 0) return null;
  const lines = [
    `[close-validation] ⚠ Pre-merge CRAP projection: ${result.breaches.length} method(s) would breach post-merge:`,
  ];
  for (const b of result.breaches) lines.push(formatBreach(b));
  lines.push(
    '[close-validation]   To land cleanly, run `npm run crap:update` and commit the refreshed baseline with a `baseline-refresh:` tagged subject (non-empty body) on the story branch before re-running close.',
  );
  return lines.join('\n');
}
