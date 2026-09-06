// tests/check-baselines-pre-merge-wiring.test.js
//
// Story #1912 / Task #1917 — `check-baselines` is wired into the pre-merge
// gate chain as the unified baselines gate.
//
// Story #2210 retired the in-process per-kind regression gates
// (`check-maintainability`, `check-crap`, `check-mutation`). The
// `check-baselines` gate is now the single source of truth for per-kind
// regression enforcement — the chain no longer carries the per-kind
// arms alongside it, and the order-sensitivity that previously pinned
// `check-baselines` AFTER the per-kind gates is moot.
//
// Story #5172 split the gate: with an enabled-kind set that resolves, it
// registers as `check-baselines-independent` (coverage-independent kinds,
// parallel partition) and/or `check-baselines-coverage` (coverage-consuming
// kinds, serial behind `coverage-capture`). The unsplit `check-baselines`
// name survives for the empty / unresolvable kind set. The chain-membership
// and `BASELINE_REF` contracts below bind whichever names the config
// registers, so they are asserted against `BASELINES_GATE_NAMES` rather than
// a literal.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BASELINES_GATE_NAMES,
  buildDefaultGates,
} from '../.agents/scripts/lib/close-validation/gates.js';
import { runCloseValidation } from '../.agents/scripts/lib/close-validation/runner.js';

describe('pre-merge gate chain — Task #1917 contract', () => {
  it('buildDefaultGates includes the unified check-baselines gate', () => {
    const gates = buildDefaultGates({
      config: { delivery: { quality: { gates: { crap: { enabled: true } } } } },
    });
    const names = gates.map((g) => g.name);
    // `crap` is coverage-consuming, so this config registers exactly the
    // serial half of the split pair.
    assert.ok(
      names.includes(BASELINES_GATE_NAMES.coverage),
      `expected a baselines gate in the chain; got ${names.join(', ')}`,
    );
  });

  it('per-kind in-process regression gates are absent (Story #2210 retirement)', () => {
    const gates = buildDefaultGates({
      config: { delivery: { quality: { gates: { crap: { enabled: true } } } } },
    });
    const names = gates.map((g) => g.name);
    for (const kind of [
      'check-maintainability',
      'check-crap',
      'check-mutation',
    ]) {
      assert.ok(
        !names.includes(kind),
        `retired per-kind gate \`${kind}\` must not appear in the chain; got: ${names.join(', ')}`,
      );
    }
  });

  it('check-baselines invokes the new CLI', () => {
    // No config → no enabled kinds → the unsplit fallback entry.
    const gates = buildDefaultGates({});
    const gate = gates.find((g) => g.name === BASELINES_GATE_NAMES.single);
    assert.ok(gate);
    assert.equal(gate.cmd, 'node');
    assert.deepEqual(gate.args, [
      '.agents/scripts/check-baselines.js',
      '--format',
      'text',
    ]);
  });
});

describe('check-baselines epic baseRef threading — Story #3890', () => {
  it('pins BASELINE_REF to origin/<baseBranch> when an epic branch is supplied', () => {
    const gates = buildDefaultGates({ baseBranch: 'epic/3865' });
    const gate = gates.find((g) => g.name === BASELINES_GATE_NAMES.single);
    assert.ok(gate);
    assert.deepEqual(
      gate.env,
      { BASELINE_REF: 'origin/epic/3865' },
      'the unified baselines gate must compare against the epic integration branch',
    );
  });

  it('pins BASELINE_REF to origin/<baseBranch> for the standalone path', () => {
    // single-story-close forwards `baseBranch` (e.g. `main`) as `baseBranch`.
    const gates = buildDefaultGates({ baseBranch: 'main' });
    const gate = gates.find((g) => g.name === BASELINES_GATE_NAMES.single);
    assert.ok(gate);
    assert.deepEqual(gate.env, { BASELINE_REF: 'origin/main' });
  });

  it('omits the env overlay entirely when no integration branch is supplied', () => {
    const gate = buildDefaultGates({}).find(
      (g) => g.name === BASELINES_GATE_NAMES.single,
    );
    assert.ok(gate);
    assert.ok(
      !('env' in gate),
      'no epic branch → no BASELINE_REF overlay → gate keeps default/consumer-config base',
    );
  });

  it('threads the gate env through to the runner (no parent-env mutation)', async () => {
    const seen = [];
    const runner = (cmd, args, opts) => {
      seen.push({ name: opts.gateName, env: opts.env });
      return { status: 0 };
    };
    // Build the canonical gate list, then isolate the check-baselines +
    // an env-less control gate so the test exercises the env-threading
    // path without invoking the format gate's git-backed changedFileScope.
    const built = buildDefaultGates({ baseBranch: 'epic/4242' });
    const baselinesGate = built.find(
      (g) => g.name === BASELINES_GATE_NAMES.single,
    );
    assert.ok(baselinesGate?.env, 'fixture: baselines gate must carry env');
    const gates = [{ name: 'lint', cmd: 'noop', args: [] }, baselinesGate];
    await runCloseValidation({
      cwd: process.cwd(),
      gates,
      runner,
      useEvidence: false,
    });
    const baselinesCall = seen.find(
      (c) => c.name === BASELINES_GATE_NAMES.single,
    );
    assert.ok(baselinesCall, 'check-baselines gate must have been dispatched');
    assert.deepEqual(baselinesCall.env, { BASELINE_REF: 'origin/epic/4242' });
    // The control gate carries no env overlay.
    const lintCall = seen.find((c) => c.name === 'lint');
    assert.ok(lintCall, 'control gate must have been dispatched');
    assert.equal(
      lintCall.env,
      undefined,
      'only check-baselines should receive the BASELINE_REF overlay',
    );
    assert.equal(
      process.env.BASELINE_REF,
      undefined,
      'the gate-scoped env must not leak into the parent process',
    );
  });
});

describe('baselines fail-fast ordering — Story #5172', () => {
  const splitConfig = {
    delivery: {
      quality: {
        gates: {
          maintainability: { enabled: true },
          duplication: { enabled: true },
          coverage: { enabled: true },
          crap: { enabled: true },
        },
      },
    },
  };
  const splitGates = () =>
    buildDefaultGates({
      config: splitConfig,
      presentBaselines: ['maintainability', 'duplication', 'coverage', 'crap'],
      // Registers the coverage-capture gate, which is the expensive step the
      // parallel baselines entry now fails ahead of.
      packageScripts: { 'test:coverage': 'c8 node --test' },
    });

  // AC-2 — a breach in the coverage-independent entry costs no capture run.
  it('never starts coverage-capture when the coverage-independent baselines entry fails', async () => {
    const invoked = [];
    const runner = (_cmd, _args, opts) => {
      invoked.push(opts.gateName);
      return {
        status: opts.gateName === BASELINES_GATE_NAMES.independent ? 1 : 0,
      };
    };
    const result = await runCloseValidation({
      cwd: process.cwd(),
      gates: splitGates(),
      runner,
      useEvidence: false,
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.failed[0].gate.name,
      BASELINES_GATE_NAMES.independent,
      'the coverage-independent entry must be the reported failure',
    );
    assert.ok(
      !invoked.includes('coverage-capture'),
      `coverage-capture must not run after a parallel-phase failure; invoked: ${invoked.join(', ')}`,
    );
    assert.ok(
      !invoked.includes(BASELINES_GATE_NAMES.coverage),
      'the coverage-consuming entry must not run either — it sits behind the capture',
    );
  });

  it('still runs the coverage-consuming entry after the capture when the parallel phase is green', async () => {
    const invoked = [];
    const runner = (_cmd, _args, opts) => {
      invoked.push(opts.gateName);
      return { status: 0 };
    };
    const result = await runCloseValidation({
      cwd: process.cwd(),
      gates: splitGates(),
      runner,
      useEvidence: false,
    });
    assert.equal(result.ok, true);
    assert.ok(invoked.includes(BASELINES_GATE_NAMES.independent));
    assert.ok(
      invoked.indexOf('coverage-capture') <
        invoked.indexOf(BASELINES_GATE_NAMES.coverage),
      `the coverage artifact must be written before the gate that reads it; invoked: ${invoked.join(', ')}`,
    );
  });
});
