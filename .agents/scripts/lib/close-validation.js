/**
 * close-validation.js — Shift-left validation gates for sprint-story-close.
 *
 * Runs lint, test, biome format check, and maintainability regression check
 * before the story merge so drift is caught in the worktree rather than at
 * pre-push time on the Epic branch. All gates inherit stdio so the operator
 * sees the raw output; the returned summary is used to surface actionable
 * hints when a gate fails.
 *
 * Also exports `projectMaintainabilityRegressions` — a pre-merge advisory that
 * the close script invokes before the merge step so the operator sees the
 * exact list of files that would breach their MI baseline post-merge and can
 * ship a `baseline-refresh:` commit atomically with the Story PR.
 */

import { spawnSync } from 'node:child_process';
import { gitSpawn as defaultGitSpawn } from './git-utils.js';
import { calculateForSource } from './maintainability-engine.js';
import { getBaseline } from './maintainability-utils.js';

/**
 * @typedef {Object} Gate
 * @property {string}   name  - Short label used in progress logs.
 * @property {string}   cmd   - Executable to run.
 * @property {string[]} args  - Arguments passed to `cmd`.
 * @property {string}   [hint] - Remediation hint shown on failure.
 */

/** @type {Gate[]} */
export const DEFAULT_GATES = [
  { name: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { name: 'test', cmd: 'npm', args: ['test'] },
  {
    name: 'biome format',
    cmd: 'npx',
    args: ['biome', 'format', '.'],
    hint: 'Run `npx biome format --write` to auto-fix formatting drift.',
  },
  {
    name: 'check-maintainability',
    cmd: 'node',
    args: ['.agents/scripts/check-maintainability.js'],
    hint: 'Run `npm run maintainability:update` to refresh the baseline — the refreshed baseline MUST be committed on the story branch.',
  },
  {
    name: 'coverage-capture',
    cmd: 'node',
    args: ['.agents/scripts/coverage-capture.js'],
    hint: 'Coverage capture failed — `npm run test:coverage` exited non-zero. Fix failing tests or coverage-threshold breaches, then re-run close.',
  },
  {
    name: 'check-crap',
    cmd: 'node',
    args: ['.agents/scripts/check-crap.js'],
    hint: 'Reduce complexity or add coverage on the flagged methods, or run `npm run crap:update` and commit with a `baseline-refresh:` tagged subject + non-empty body if the drift is justified. Self-skips when `agentSettings.quality.crap.enabled` is false.',
  },
];

/**
 * Run every gate sequentially. Stops collecting after the first failure is
 * recorded but still returns a summary so the caller can decide how to
 * surface the result.
 *
 * @param {{
 *   cwd: string,
 *   gates?: Gate[],
 *   runner?: typeof spawnSync,
 *   log?: (m: string) => void,
 *   onGateStart?: (gate: Gate) => void,
 * }} opts
 *   `onGateStart` is invoked immediately before each gate's runner spawn.
 *   sprint-story-close uses it to drive `phaseTimer.mark('lint'|'test')`
 *   so the per-gate wall-clock lands in the `phase-timings` structured
 *   comment. Errors thrown from the hook propagate and halt the run.
 * @returns {{ ok: boolean, failed: Array<{ gate: Gate, status: number }> }}
 */
export function runCloseValidation({
  cwd,
  gates = DEFAULT_GATES,
  runner = spawnSync,
  log = () => {},
  onGateStart,
} = {}) {
  const failed = [];
  for (const gate of gates) {
    log(`[close-validation] ▶ ${gate.name}`);
    if (typeof onGateStart === 'function') onGateStart(gate);
    const result = runner(gate.cmd, gate.args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    const status = result.status ?? 1;
    if (status !== 0) {
      failed.push({ gate, status });
      log(`[close-validation] ✖ ${gate.name} failed (exit ${status})`);
      if (gate.hint) log(`[close-validation]   hint: ${gate.hint}`);
      break;
    }
    log(`[close-validation] ✓ ${gate.name}`);
  }
  return { ok: failed.length === 0, failed };
}

/**
 * Default tolerance shared with check-maintainability.js: small floating-point
 * variances must not register as a regression.
 */
const DEFAULT_MI_TOLERANCE = 0.001;

/**
 * Project the post-merge maintainability scores for every file changed on
 * the Story branch relative to the Epic branch, and return the subset whose
 * projected score breaches the per-file baseline ceiling.
 *
 * Advisory only — the result is rendered as a log line by sprint-story-close
 * before the merge runs. The hard MI gate still runs at pre-push time via the
 * husky hook. The point of this projection is to surface the breach **before**
 * the merge so the operator can ship a `baseline-refresh:` commit atomically
 * with the Story PR rather than as a follow-on after the push.
 *
 * The "post-merge body" of each file is approximated by the file content at
 * the tip of the Story branch — a `--no-ff` merge into the Epic branch does
 * not modify file contents, so this is exact when the merge applies cleanly
 * and a close-enough projection when it auto-resolves minor conflicts.
 *
 * The helper never throws and never has side effects beyond running `git`
 * subcommands via the injected interface. Any failure path resolves to
 * `{ ok: true, regressions: [], skipped: '<reason>' }` so the caller treats
 * the advisory as best-effort.
 *
 * @param {{
 *   cwd: string,
 *   epicBranch: string,
 *   storyBranch: string,
 *   baselinePath: string,
 *   tolerance?: number,
 *   git?: { gitSpawn: typeof defaultGitSpawn },
 *   scoreSource?: (source: string) => number,
 *   loadBaseline?: (path: string) => Record<string, number>,
 * }} opts
 * @returns {{
 *   ok: boolean,
 *   regressions: Array<{ file: string, projected: number, baseline: number, drop: number }>,
 *   skipped?: string,
 *   detail?: string,
 * }}
 */
export function projectMaintainabilityRegressions({
  cwd,
  epicBranch,
  storyBranch,
  baselinePath,
  tolerance = DEFAULT_MI_TOLERANCE,
  git = { gitSpawn: defaultGitSpawn },
  scoreSource = calculateForSource,
  loadBaseline = getBaseline,
} = {}) {
  if (!cwd || !epicBranch || !storyBranch || !baselinePath) {
    return { ok: true, regressions: [], skipped: 'missing-args' };
  }

  const baseline = loadBaseline(baselinePath);
  if (!baseline || Object.keys(baseline).length === 0) {
    return { ok: true, regressions: [], skipped: 'no-baseline' };
  }

  // Refresh `origin/<epicBranch>` so the diff range resolves even if the
  // close script hasn't reached its own pull/rebase step yet. Best-effort —
  // a fetch failure is logged via `skipped: 'fetch-failed'` and the helper
  // bails rather than producing a misleading projection.
  const fetchRes = git.gitSpawn(cwd, 'fetch', 'origin', epicBranch);
  if (fetchRes.status !== 0) {
    return {
      ok: true,
      regressions: [],
      skipped: 'fetch-failed',
      detail: fetchRes.stderr || fetchRes.stdout || `exit ${fetchRes.status}`,
    };
  }

  const diff = git.gitSpawn(
    cwd,
    'diff',
    '--name-only',
    `origin/${epicBranch}...${storyBranch}`,
  );
  if (diff.status !== 0) {
    return {
      ok: true,
      regressions: [],
      skipped: 'diff-failed',
      detail: diff.stderr || diff.stdout || `exit ${diff.status}`,
    };
  }

  const changedFiles = (diff.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, '/'));

  const regressions = [];
  for (const file of changedFiles) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const baselineScore = baseline[file];
    if (typeof baselineScore !== 'number') continue;

    const show = git.gitSpawn(cwd, 'show', `${storyBranch}:${file}`);
    if (show.status !== 0) continue; // file deleted/renamed on the story branch

    const projected = scoreSource(show.stdout || '');
    if (projected < baselineScore - tolerance) {
      regressions.push({
        file,
        projected,
        baseline: baselineScore,
        drop: baselineScore - projected,
      });
    }
  }

  return { ok: regressions.length === 0, regressions };
}

/**
 * Render the pre-merge MI advisory as a human-readable multi-line log block.
 * Returns `null` when there are no regressions to surface so callers can `if`
 * past the log call without a string-empty check.
 *
 * @param {ReturnType<typeof projectMaintainabilityRegressions>} result
 * @returns {string | null}
 */
export function formatMaintainabilityProjection(result) {
  if (!result || !Array.isArray(result.regressions)) return null;
  if (result.regressions.length === 0) return null;
  const lines = [
    `[close-validation] ⚠ Pre-merge MI projection: ${result.regressions.length} file(s) would breach baseline post-merge:`,
  ];
  for (const r of result.regressions) {
    lines.push(
      `  • ${r.file}  projected=${r.projected.toFixed(2)}  baseline=${r.baseline.toFixed(2)}  drop=-${r.drop.toFixed(2)}`,
    );
  }
  lines.push(
    '[close-validation]   To land cleanly, run `npm run maintainability:update` and commit the refreshed baseline with a `baseline-refresh:` tagged subject (non-empty body) on the story branch before re-running close.',
  );
  return lines.join('\n');
}
