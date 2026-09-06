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
      commands: { test: 'echo', typecheck: 'echo' },
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

/**
 * Git stub serving both reads the acknowledgment path makes.
 *
 * Story #5179 — `git show` is now asked for the baseline blob at a REFRESH
 * COMMIT's own SHA, not only at the base ref, so the stub resolves per-SHA
 * blobs from `commits[].rows`. A commit with no `rows` models one whose blob
 * cannot be read at all (the fail-closed case).
 */
function installGitStub({ baseRows, baseRollup, commits = [], baselineRel }) {
  const rel = baselineRel ?? COV_BASELINE_REL;
  const baseJson = JSON.stringify(
    covEnvelope({ rows: baseRows, rollup: baseRollup }),
  );
  const blobBySha = new Map();
  for (const c of commits) {
    if (c.rows)
      blobBySha.set(c.sha, JSON.stringify(covEnvelope({ rows: c.rows })));
  }
  __setSpawnRunner({
    spawn: (_cmd, args) => {
      const verb = args?.[0];
      if (verb === 'show') {
        const spec = args?.[1] ?? '';
        if (!spec.endsWith(`:${rel}`)) {
          return { status: 128, stdout: '', stderr: 'no base' };
        }
        const ref = spec.slice(0, spec.length - rel.length - 1);
        if (blobBySha.has(ref)) {
          return { status: 0, stdout: blobBySha.get(ref), stderr: '' };
        }
        if (ref === 'main') return { status: 0, stdout: baseJson, stderr: '' };
        return { status: 128, stdout: '', stderr: 'no blob at ref' };
      }
      if (verb === 'log') {
        const lines = commits.map((c) => `${c.sha}\u0000${c.subject}`);
        return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
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
      commits: [
        {
          sha: 'refresh1',
          subject:
            'chore(baselines): baseline-refresh: regenerate coverage full-scope',
          rows: [{ path: 'src/a.js', lines: 70, branches: 70, functions: 70 }],
        },
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
      commits: [{ sha: 'plain1', subject: 'fix(x): an untagged commit' }],
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
        commands: { test: 'echo', typecheck: 'echo' },
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
      commits: [
        {
          sha: 'refresh1',
          subject: 'chore(baselines): baseline-refresh: regenerate coverage',
          rows: [{ path: 'src/a.js', lines: 70, branches: 70, functions: 70 }],
        },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0, 'tag probe found the default baseline path');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
  });
});

// ---------------------------------------------------------------------------
// Story #5179 — the commit-tag acknowledgment is scoped to the rows the tagged
// commit actually refreshed.
//
// It used to replace `regressions` with `[]` outright whenever a tagged commit
// sat anywhere in the range, which leaked in two directions at once: rows the
// commit never touched were cleared, and drift landing after the refresh was
// cleared along with it. The branch then merged carrying a stale row and the
// ratchet ran loose on that file — six recurrences before the mechanism was
// located.
// ---------------------------------------------------------------------------

const REFRESH_SUBJECT =
  'chore(baselines): baseline-refresh: regenerate coverage full-scope';

function covRow(p, v) {
  return { path: p, lines: v, branches: v, functions: v };
}

/** Head baseline over several rows whose rollup stays clear of the floor. */
function writeHead(root, rows) {
  writeJson(
    path.join(root, 'baselines', 'coverage.json'),
    covEnvelope({
      rollup: { '*': { lines: 90, branches: 85, functions: 90 } },
      rows,
    }),
  );
}

describe('check-baselines — refresh acknowledgment is row-scoped (#5179)', () => {
  let root;

  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  // AC-1 — the larger half of the leak: one tagged commit cleared regressions
  // on rows it never touched, including rows in unrelated directories.
  it('a regression on a row the refresh commit never touched still fails the gate', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 70), covRow('src/b.js', 70)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95), covRow('src/b.js', 95)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'the untouched row still fails the run');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true, 'the refreshed row WAS acknowledged');
    assert.deepEqual(gate.acknowledgedKeys, ['src/a.js']);
    assert.deepEqual(
      gate.regressions.map((r) => r.key),
      ['src/b.js'],
      'only the unrefreshed row survives as a regression',
    );
  });

  // AC-2 — the reported half: drift from commits landing AFTER the refresh.
  it('a row degraded beyond what the refresh commit recorded still fails the gate', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 60)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      commits: [
        // The refresh recorded 70; a later commit dropped the row to 60.
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'post-refresh drift is not acknowledged');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
    assert.deepEqual(gate.acknowledgedKeys, []);
    assert.deepEqual(
      gate.regressions.map((r) => r.key),
      ['src/a.js'],
    );
  });

  // AC-3 — the legitimate case the mechanism exists for still works.
  it('a row matching what the refresh commit recorded is acknowledged', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 70)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
    assert.deepEqual(gate.acknowledgedKeys, ['src/a.js']);
    assert.equal(gate.regressionCount, 0);
  });

  // AC-4 — several tagged commits in one range union their refreshed rows.
  it('two refresh commits acknowledge their own rows and nothing else', async () => {
    root = setupTmpRepo();
    writeHead(root, [
      covRow('src/a.js', 70),
      covRow('src/b.js', 70),
      covRow('src/c.js', 70),
    ]);
    installGitStub({
      baseRows: [
        covRow('src/a.js', 95),
        covRow('src/b.js', 95),
        covRow('src/c.js', 95),
      ],
      commits: [
        // Newest first, as git log returns them.
        { sha: 'r2', subject: REFRESH_SUBJECT, rows: [covRow('src/b.js', 70)] },
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'the third, untouched row still fails');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.deepEqual([...gate.acknowledgedKeys].sort(), [
      'src/a.js',
      'src/b.js',
    ]);
    assert.deepEqual(
      gate.regressions.map((r) => r.key),
      ['src/c.js'],
    );
  });

  // A key refreshed twice anchors to the NEWEST commit — that is the state the
  // branch is asking to be held to.
  it('a row refreshed twice is judged against the newest refresh commit', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 60)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      commits: [
        // Newest recorded 70, so head at 60 has drifted since.
        { sha: 'r2', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 60)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'the older, laxer refresh does not win');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
  });

  // AC-5 — the env arm is deliberately NOT row-scoped: there is no commit to
  // anchor to, and setting the variable is an explicit operator act.
  it('COVERAGE_REFRESH=1 still acknowledges whole-run, with no commit in range', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 70), covRow('src/b.js', 70)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95), covRow('src/b.js', 95)],
      commits: [],
    });
    const res = await runCheckBaselines({
      argv: ['--no-friction'],
      cwd: root,
      env: { COVERAGE_REFRESH: '1' },
    });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
    assert.equal(gate.regressionCount, 0, 'every row acknowledged');
    assert.deepEqual([...gate.acknowledgedKeys].sort(), [
      'src/a.js',
      'src/b.js',
    ]);
  });

  // AC-6 — fail closed. A blob we cannot read at the refresh SHA acknowledges
  // nothing rather than acknowledging on a guess.
  it('a tagged commit whose baseline blob cannot be read acknowledges nothing', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 70)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      // No `rows` → `git show r1:<baseline>` answers 128.
      commits: [{ sha: 'r1', subject: REFRESH_SUBJECT }],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'ratchet stays at full strength');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, false);
    assert.deepEqual(gate.acknowledgedKeys, []);
  });

  // The drift check honours the gate's own tolerance. Without this it would be
  // STRICTER than the ratchet it guards: a 0.2 wiggle against the refreshed row
  // would block a branch that the same wiggle against the base ref waves
  // through, and a gate whose two halves disagree on what counts as movement is
  // the bug class this Story closes.
  it('a sub-tolerance wiggle below the refresh commit is still acknowledged', async () => {
    root = setupTmpRepo();
    writeHead(root, [covRow('src/a.js', 69.8)]);
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0, '0.2 is inside the 0.5 tolerance');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.equal(gate.acknowledged, true);
    assert.deepEqual(gate.acknowledgedKeys, ['src/a.js']);
  });

  // AC-7 — floors are never suppressed, on the tag arm as on the env arm.
  it('a floor breach still fails under a commit-tag acknowledgment', async () => {
    root = setupTmpRepo({ floors: { '*': { lines: 95 } } });
    writeHead(root, [covRow('src/a.js', 70)]); // rollup lines 90 < floor 95
    installGitStub({
      baseRows: [covRow('src/a.js', 95)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [covRow('src/a.js', 70)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.notEqual(res.exitCode, 0, 'floor breach still fails the run');
    const gate = res.report.gates.find((g) => g.kind === 'coverage');
    assert.ok(gate.breachCount >= 1, 'floor breach reported');
  });
});

// ---------------------------------------------------------------------------
// Story #5179, AC-9 — direction comes from the kind's own `compare()`.
//
// The drift check asks "is head worse than what the refresh recorded?", and
// "worse" is per-kind: coverage is better-when-higher, duplication is
// better-when-LOWER. Re-deriving that in the acknowledgment path would let it
// disagree with the classifier that produced the regressions in the first
// place — and a gate whose two halves disagree fails open. Pinning the
// behaviour on a `betterWhen: 'lower'` kind is what makes a naive
// higher-is-better implementation fail this suite loudly.
// ---------------------------------------------------------------------------

const DUP_BASELINE_REL = 'baselines/duplication.json';

function dupRow(p, pct) {
  return { path: p, percentage: pct, duplicatedLines: pct, totalLines: 100 };
}

function dupEnvelope(rows) {
  return {
    $schema: 'duplication.schema.json',
    kernelVersion: currentKernelVersion('duplication'),
    generatedAt: '2026-01-01T00:00:00.000Z',
    rollup: {
      '*': {
        percentage: 4,
        duplicatedLines: 4,
        totalLines: 100,
        filesWithDuplication: rows.length,
      },
    },
    rows,
  };
}

function setupDupRepo() {
  const dir = makeTempDir('check-baselines-dup-');
  mkdirSync(path.join(dir, 'baselines'), { recursive: true });
  writeJson(path.join(dir, '.agentrc.json'), {
    project: {
      baseBranch: 'main',
      paths: { agentRoot: '.agents', docsRoot: 'docs', tempRoot: 'temp' },
      docsContextFiles: [],
      commands: { test: 'echo', typecheck: 'echo' },
    },
    github: { owner: 'x', repo: 'y', operatorHandle: '@ci' },
    delivery: {
      quality: {
        gateScoping: { scope: 'diff', diffRef: 'main' },
        gates: {
          duplication: {
            enabled: true,
            baselinePath: DUP_BASELINE_REL,
            // A regression only reaches EXIT_REGRESSION on a gate carrying an
            // explicit tolerance policy (`exitCodeForGate` in pipeline.js).
            tolerance: { kind: 'absolute', value: 1 },
            floors: { '*': { percentage: 50 } },
          },
        },
      },
    },
  });
  return dir;
}

function installDupGitStub({ baseRows, commits }) {
  const baseJson = JSON.stringify(dupEnvelope(baseRows));
  const blobBySha = new Map();
  for (const c of commits) {
    if (c.rows) blobBySha.set(c.sha, JSON.stringify(dupEnvelope(c.rows)));
  }
  __setSpawnRunner({
    spawn: (_cmd, args) => {
      const verb = args?.[0];
      if (verb === 'show') {
        const spec = args?.[1] ?? '';
        if (!spec.endsWith(`:${DUP_BASELINE_REL}`)) {
          return { status: 128, stdout: '', stderr: 'no base' };
        }
        const ref = spec.slice(0, spec.length - DUP_BASELINE_REL.length - 1);
        if (blobBySha.has(ref)) {
          return { status: 0, stdout: blobBySha.get(ref), stderr: '' };
        }
        if (ref === 'main') return { status: 0, stdout: baseJson, stderr: '' };
        return { status: 128, stdout: '', stderr: 'no blob at ref' };
      }
      if (verb === 'log') {
        const lines = commits.map((c) => `${c.sha}\u0000${c.subject}`);
        return { status: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
      }
      return { status: 128, stdout: '', stderr: 'unexpected' };
    },
  });
}

describe('check-baselines — ack direction follows the kind, not a guess (#5179)', () => {
  let root;

  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  // For duplication, HIGHER is worse. Head 9 against a refresh that recorded 9
  // is unchanged, so the regression vs the base (5) is acknowledged.
  it('acknowledges a lower-is-better row that matches the refresh commit', async () => {
    root = setupDupRepo();
    writeJson(
      path.join(root, 'baselines', 'duplication.json'),
      dupEnvelope([dupRow('src/a.js', 9)]),
    );
    installDupGitStub({
      baseRows: [dupRow('src/a.js', 5)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [dupRow('src/a.js', 9)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'duplication');
    assert.equal(gate.acknowledged, true);
    assert.deepEqual(gate.acknowledgedKeys, ['src/a.js']);
  });

  // Head 9 against a refresh that recorded 7 is WORSE for this kind. A path
  // that assumed higher-is-better would read 9 > 7 as an improvement and
  // acknowledge it; the kind's own compare() calls it drift.
  it('refuses a lower-is-better row that rose above the refresh commit', async () => {
    root = setupDupRepo();
    writeJson(
      path.join(root, 'baselines', 'duplication.json'),
      dupEnvelope([dupRow('src/a.js', 9)]),
    );
    installDupGitStub({
      baseRows: [dupRow('src/a.js', 5)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [dupRow('src/a.js', 7)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 4, 'rising duplication is drift, not a gain');
    const gate = res.report.gates.find((g) => g.kind === 'duplication');
    assert.equal(gate.acknowledged, false);
    assert.deepEqual(gate.acknowledgedKeys, []);
  });

  // The mirror: head BELOW what the refresh recorded is better for this kind,
  // so the row is acknowledged rather than treated as drift.
  it('acknowledges a lower-is-better row that fell below the refresh commit', async () => {
    root = setupDupRepo();
    writeJson(
      path.join(root, 'baselines', 'duplication.json'),
      dupEnvelope([dupRow('src/a.js', 6)]),
    );
    installDupGitStub({
      baseRows: [dupRow('src/a.js', 5)],
      commits: [
        { sha: 'r1', subject: REFRESH_SUBJECT, rows: [dupRow('src/a.js', 7)] },
      ],
    });
    const res = await runCheckBaselines({ argv: ['--no-friction'], cwd: root });
    assert.equal(res.exitCode, 0);
    const gate = res.report.gates.find((g) => g.kind === 'duplication');
    assert.equal(gate.acknowledged, true);
  });
});
