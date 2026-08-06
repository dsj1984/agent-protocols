#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * Local full verification — a true CI mirror for the gates that CAN be proven
 * locally, without epic-scoped MI projection or push semantics.
 *
 * Order: audit (SCA) → lint (includes docs:check + the arch-cycles ratchet) →
 * full test suite → unified baselines → the standalone ratchets
 * (dead-exports ×2, context-budget, cyclomatic, schema-references).
 *
 * The `audit` step runs `npm audit --audit-level=high`, matching CI's
 * "Dependency Vulnerability Audit (SCA)" gate so a local green no longer hides
 * a high-severity advisory that CI would fail on. It is independent of the
 * pre-push `PREPUSH_AUDIT` opt-in, which stays unchanged.
 *
 * The trailing ratchets complete the mirror of CI's "Architecture Cycle Check"
 * step in the `baselines` job (Story #4549). That step runs three checks;
 * `check-arch-cycles.js` is deliberately absent from STEPS because the `lint`
 * step above already runs it (see run-lint.js) — re-running it here would
 * double-pay a gate verify already covers. `check-dead-exports.js` and
 * `check-context-budget.js` had no such cover: they were reachable locally only
 * via the diff-scoped `npm run quality:preview` or a direct invocation, so a
 * clean `verify` could still hide a CI-red — the failure Story #4531 / PR #4548
 * paid for with a full push → CI → fix → push round-trip. Both are pure-Node
 * and baseline-aware, adding ~15s on a cold cache (dominated by knip's
 * full-tree scan in check-dead-exports.js) to a command that already carries
 * the full test suite.
 *
 * Story #5004 closed the last two mirror gaps that were pure omission.
 * `check-cyclomatic.js` (#4923) and `check-schema-references.js` (#4938) were
 * each added to the `baselines` job's standalone-ratchet slot without ever
 * being added here, so a green `verify` still hid both. Like their neighbours
 * they are pure-Node and cost milliseconds.
 *
 * Still NOT mirrored: `check-workflow-citations.js`, `check-baseline-scope.js`
 * and `prune-baseline-orphans.js --check` run in CI's `baselines` job only —
 * `.agents/rules/known-tooling-behavior.md` entry 2 carries the current
 * coverage table. Nor are the CI gates this command structurally cannot
 * reproduce (action pinning, TruffleHog secret scan, the BASELINE_SCOPE=full
 * push-scoped maintainability run) — those are catalogued in
 * docs/ci-contract.md.
 */

import { spawnSync } from 'node:child_process';
import { runAsCli } from './lib/cli-utils.js';

const STEPS = [
  {
    label: 'audit',
    cmd: 'npm',
    args: ['audit', '--audit-level=high'],
  },
  { label: 'lint', cmd: 'npm', args: ['run', 'lint'] },
  { label: 'test', cmd: 'npm', args: ['test'] },
  {
    label: 'baselines',
    cmd: 'node',
    args: ['.agents/scripts/check-baselines.js'],
  },
  {
    label: 'dead-exports',
    cmd: 'node',
    args: ['.agents/scripts/check-dead-exports.js'],
  },
  {
    label: 'dead-exports-production',
    cmd: 'node',
    args: ['.agents/scripts/check-dead-exports.js', '--production'],
  },
  {
    label: 'context-budget',
    cmd: 'node',
    args: ['.agents/scripts/check-context-budget.js'],
  },
  {
    label: 'cyclomatic',
    cmd: 'node',
    args: ['.agents/scripts/check-cyclomatic.js'],
  },
  {
    label: 'schema-references',
    cmd: 'node',
    args: ['.agents/scripts/check-schema-references.js'],
  },
];

export function runVerifySteps({
  spawn = spawnSync,
  shell = process.platform === 'win32',
} = {}) {
  for (const step of STEPS) {
    const result = spawn(step.cmd, step.args, {
      stdio: 'inherit',
      shell,
    });
    if (result.error) {
      throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
      return {
        ok: false,
        failedStep: step.label,
        exitCode: result.status ?? 1,
      };
    }
  }
  return { ok: true };
}

runAsCli(
  import.meta.url,
  async () => {
    const outcome = runVerifySteps();
    if (!outcome.ok) {
      process.exit(outcome.exitCode);
    }
  },
  { source: 'run-verify' },
);
