/**
 * integration-verifier.js — Post-Merge Verification Suite Runner
 *
 * Extracted from sprint-integrate.js to satisfy SRP: this module owns only
 * the post-merge gate (lint baseline, typecheck, tests). It knows nothing
 * about Git branch state.
 *
 * Each verification step is run via diagnose-friction.js so event telemetry
 * is captured uniformly.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Run all post-merge verification steps in sequence.
 * Returns on full success. Throws a VerificationError on the first failed step.
 *
 * @param {{
 *   cwd:           string,   // Project root
 *   scriptsRoot:   string,   // Rel path to .agents/scripts (from cwd)
 *   taskId:        string,
 *   typecheckCmd:  string,
 *   testCmd:       string,
 *   timeoutMs:     number,
 *   onProgress:    (phase: string, message: string) => void,
 * }} options
 * @throws {VerificationError}
 */
export function runVerificationSuite({
  cwd,
  scriptsRoot,
  taskId,
  typecheckCmd,
  testCmd,
  timeoutMs,
  onProgress,
}) {
  const lintBaselineScript = path.join(cwd, scriptsRoot, 'lint-baseline.js');
  const diagScript = path.join(cwd, scriptsRoot, 'diagnose-friction.js');

  const steps = [
    { label: 'lint-baseline', args: ['node', lintBaselineScript, 'check'] },
    {
      label: 'typecheck',
      args: typecheckCmd?.trim() ? typecheckCmd.split(' ') : [],
    },
    { label: 'test', args: testCmd?.trim() ? testCmd.split(' ') : [] },
  ].filter((s) => s.args.length > 0);

  for (const step of steps) {
    onProgress('VERIFY', `Running ${step.label}: ${step.args.join(' ')}`);

    const result = spawnSync(
      'node',
      [diagScript, '--task', taskId, '--cmd', ...step.args],
      {
        stdio: 'inherit',
        encoding: 'utf-8',
        cwd,
        timeout: timeoutMs,
      },
    );

    if (result.status !== 0) {
      throw new VerificationError(step.label, result.status ?? 1);
    }
  }
}

/**
 * Structured error thrown when a verification step fails.
 * Callers can inspect `stepLabel` and `exitCode` for targeted reporting.
 */
export class VerificationError extends Error {
  /**
   * @param {string} stepLabel - Name of the failed verification step.
   * @param {number} exitCode  - Exit code from the subprocess.
   */
  constructor(stepLabel, exitCode) {
    super(
      `Verification step "${stepLabel}" failed with exit code ${exitCode}.`,
    );
    this.name = 'VerificationError';
    this.stepLabel = stepLabel;
    this.exitCode = exitCode;
  }
}
