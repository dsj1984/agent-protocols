/**
 * close-validation.js — Shift-left validation gates for sprint-story-close.
 *
 * Runs lint, test, biome format check, and maintainability regression check
 * before the story merge so drift is caught in the worktree rather than at
 * pre-push time on the Epic branch. All gates inherit stdio so the operator
 * sees the raw output; the returned summary is used to surface actionable
 * hints when a gate fails.
 */

import { spawnSync } from 'node:child_process';

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
    name: 'check-crap',
    cmd: 'node',
    args: ['.agents/scripts/check-crap.js'],
    hint: 'Reduce complexity or add coverage on the flagged methods, or run `npm run crap:update` and commit with a `baseline-refresh:` tagged subject + non-empty body if the drift is justified. Self-skips when `agentSettings.maintainability.crap.enabled` is false.',
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
