// tests/check-baselines-generic-refresh-ack.test.js
//
// Story #4802 — the one-shot baseline refresh/acknowledge is now kind-generic.
//
// Stories #151 (bundle-size, env only) and #4731 (maintainability, env OR a
// `baseline-refresh:`-tagged range commit) each shipped their own
// `if (kind !== '<literal>') return ...` function. Every other ratcheted kind
// had no escape at all, which made a deliberate full-scope baseline rewrite
// unlandable: a diff-scope baseline is an accretion of many partial runs, so
// replacing it with a single full-scope measurement produces row deltas in
// both directions that are arithmetic, not behavioural.
//
// These tests pin the generalized contract on `coverage` (the kind the gap was
// reported against) and assert the mechanism reaches every kind, that floors
// are never suppressed, that nothing persists, and that an unusable baseline
// path fails closed instead of throwing.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { runCheckBaselines } from '../.agents/scripts/check-baselines.js';
import {
  __resetForTests,
  __setSpawnRunner,
} from '../.agents/scripts/lib/baselines/git-base.js';
import { currentKernelVersion } from '../.agents/scripts/lib/baselines/kernel.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

const COV_BASELINE_REL = 'baselines/coverage.json';

function writeJson(p, value) {
  writeFileSync(p, JSON.stringify(value, null, 2));
}

function covEnvelope({ rows, rollup } = {}) {
  return {
    $schema: 'coverage.schema.json',
    kernelVersion: currentKernelVersion('coverage'),
    generatedAt: '2026-01-01T00:00:00.000Z',
    rollup: rollup ?? { '*': { lines: 90, branches: 85, functions: 90 } },
    rows: rows ?? [],
  };
}

function setupTmpRepo({ floors } = {}) {
  const root = makeTempDir('check-baselines-generic-');
  mkdirSync(path.join(root, 'baselines'), { recursive: true });
  writeJson(path.join(root, '.agentrc.json'), {
    project: {
      baseBranch: 'main',
      paths: { agentRoot: '.agents', docsRoot: 'docs', tempRoot: 'temp' },
      docsContextFiles: [],
      commands: { lintBaseline: 'echo', test: 'echo', typecheck: 'echo' },
    },
    github: { owner: 'x', repo: 'y', operatorHandle: '@ci' },
    delivery: {
      quality: {
        gateScoping: { scope: 'diff', diffRef: 'main' },
        gates: {
          coverage: {
            enabled: true,
            baselinePath: COV_BASELINE_REL,
            tolerance: { kind: 'absolute', value: 0.5 },
            floors: floors ?? { '*': { lines: 50 } },
          },
        },
      },
    },
  });
  return root;
}

function installGitStub({ baseRows, baseRollup, subjects = [] }) {
  const baseJson = JSON.stringify(
    covEnvelope({ rows: baseRows, rollup: baseRollup }),
  );
  __setSpawnRunner({
    spawn: (_cmd, args) => {
      const verb = args?.[0];
      if (verb === 'show') {
        const spec = args?.[1] ?? '';
        if (spec.endsWith(`:${COV_BASELINE_REL}`)) {
          return { status: 0, stdout: baseJson, stderr: '' };
        }
        return { status: 128, stdout: '', stderr: 'no base' };
      }
      if (verb === 'log') {
        return { status: 0, stdout: `${subjects.join('\n')}\n`, stderr: '' };
      }
      return { status: 128, stdout: '', stderr: 'unexpected' };
    },
  });
}

/** Head baseline whose row regressed vs base but whose rollup clears the floor. */
function writeRegressedHead(root) {
  writeJson(
    path.join(root, 'baselines', 'coverage.json'),
    covEnvelope({
      rollup: { '*': { lines: 90, branches: 85, functions: 90 } },
      rows: [{ path: 'src/a.js', lines: 70, branches: 70, functions: 70 }],
    }),
  );
}

const REGRESSED_BASE = [
  { path: 'src/a.js', lines: 95, branches: 95, functions: 95 },
];

describe('check-baselines — generic refresh acknowledgment (#4802)', () => {
  let root;

  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  // The reported gap: coverage had no acknowledgment path at all.
  it('COVERAGE_REFRESH=1 demotes coverage head-vs-base regressions (no EXIT_REGRESSION)', async () => {
    root = setupTmpRepo();
    writeRegressedHead(root);
    installGitStub({ baseRows: REGRESSED_BASE });
    const res = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
      env: { COVERAGE_REFRESH: '1' },
    });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true, 'gate names itself acknowledged');
    assert.equal(gate.regressionCount, 0, 'regressions demoted');
  });

  // Floors are never suppressed by an acknowledgment.
  it('a floor breach still fails under COVERAGE_REFRESH=1', async () => {
    root = setupTmpRepo({ floors: { '*': { lines: 95 } } });
    writeRegressedHead(root); // rollup lines 90 < floor 95
    installGitStub({ baseRows: REGRESSED_BASE });
    const res = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
      env: { COVERAGE_REFRESH: '1' },
    });
    assert.notEqual(res.exitCode, 0, 'floor breach still fails the run');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.ok(gate.breachCount >= 1, 'floor breach reported');
  });

  // The commit-tag trigger generalizes too — previously maintainability-only.
  it('a baseline-refresh:-tagged range commit touching baselines/coverage.json acknowledges with no env var', async () => {
    root = setupTmpRepo();
    writeRegressedHead(root);
    installGitStub({
      baseRows: REGRESSED_BASE,
      subjects: [
        'chore(baselines): baseline-refresh: regenerate coverage full-scope',
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
    assert.equal(gate.regressionCount, 0);
  });

  // No trigger → the generic path is a no-op, exactly as before #4802.
  it('an unacknowledged run reports the regression exactly as before (exit 4)', async () => {
    root = setupTmpRepo();
    writeRegressedHead(root);
    installGitStub({
      baseRows: REGRESSED_BASE,
      subjects: ['fix(x): an untagged commit'],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
    assert.ok(gate.regressionCount >= 1, 'regression preserved');
  });

  // One kind's flag must not acknowledge another's.
  it('MAINTAINABILITY_REFRESH does not acknowledge the coverage gate', async () => {
    root = setupTmpRepo();
    writeRegressedHead(root);
    installGitStub({ baseRows: REGRESSED_BASE });
    const res = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
      env: { MAINTAINABILITY_REFRESH: '1' },
    });
    assert.equal(res.exitCode, 4);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
  });

  // Nothing is persisted: the acknowledgment is re-derived every run.
  it('acknowledgment does not persist — the next run without the flag reports again', async () => {
    root = setupTmpRepo();
    writeRegressedHead(root);
    installGitStub({ baseRows: REGRESSED_BASE });

    const acked = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
      env: { COVERAGE_REFRESH: '1' },
    });
    assert.equal(acked.exitCode, 0);

    __resetForTests();
    installGitStub({ baseRows: REGRESSED_BASE });
    const again = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
    });
    assert.equal(again.exitCode, 4, 'ratchet back at full strength');
    const gate = again.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
  });

  // The commit-tag probe resolves its baseline path from DEFAULT_BASELINE_PATHS
  // when the gate block omits one. (The complementary guard — a kind with
  // neither a configured path nor a DEFAULT_BASELINE_PATHS entry — is defensive
  // depth only: KNOWN_KINDS gates CLI input and every member has a default, so
  // that branch is unreachable from here. Its no-throw contract is pinned at
  // the resolver level in tests/check-bundle-size-env-overrides.test.js.)
  it('the commit-tag probe falls back to DEFAULT_BASELINE_PATHS when the gate block omits baselinePath', async () => {
    root = makeTempDir('check-baselines-generic-');
    mkdirSync(path.join(root, 'baselines'), { recursive: true });
    writeJson(path.join(root, '.agentrc.json'), {
      project: {
        baseBranch: 'main',
        paths: { agentRoot: '.agents', docsRoot: 'docs', tempRoot: 'temp' },
        docsContextFiles: [],
        commands: { lintBaseline: 'echo', test: 'echo', typecheck: 'echo' },
      },
      github: { owner: 'x', repo: 'y', operatorHandle: '@ci' },
      delivery: {
        quality: {
          gateScoping: { scope: 'diff', diffRef: 'main' },
          gates: {
            // No baselinePath — the default (baselines/coverage.json) applies.
            coverage: {
              enabled: true,
              tolerance: { kind: 'absolute', value: 0.5 },
              floors: { '*': { lines: 50 } },
            },
          },
        },
      },
    });
    writeRegressedHead(root);
    installGitStub({
      baseRows: REGRESSED_BASE,
      subjects: ['chore(baselines): baseline-refresh: regenerate coverage'],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0, 'tag probe found the default baseline path');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
  });
});
