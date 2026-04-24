import assert from 'node:assert';
import { test } from 'node:test';
import {
  applyBaselineRefreshLabel,
  BASELINE_REFRESH_LABEL,
  classifyChangedFiles,
  evaluateGuardrail,
  findRefreshCommits,
  parseBaseBranchConfig,
  parseCliArgs,
  parseCommitLog,
} from '../.agents/scripts/baseline-refresh-guardrail.js';

/**
 * Fixture tests for the baseline-refresh-guardrail CI job. Each scenario
 * corresponds to an acceptance criterion on Story #610 / Task #630:
 *
 *   1. PR that raises newMethodCeiling but is held to base-branch ceiling —
 *      covered by the env-override tests in check-crap-env-overrides.test.js
 *      (the guardrail wires those env vars through `runCheckCrapWithBaseConfig`).
 *   2. Untagged baseline-refresh commit fails with message naming the tag.
 *   3. Tagged refresh passes.
 *   4. Baseline-only PR gets the review label exactly once across re-runs.
 *
 * The pure helpers (evaluate/classify/find/parse) are unit-tested with
 * fixtures; the label-application path is tested via an injected `runner`
 * stub to keep the suite hermetic — no real `gh` calls.
 */

const BASE_CONFIG = Object.freeze({
  newMethodCeiling: 30,
  tolerance: 0.001,
  refreshTag: 'baseline-refresh:',
});

function makeCommit(subject, body = '') {
  return { sha: 'a'.repeat(40), subject, body };
}

test('parseCommitLog — round-trips multi-commit log with bodies', () => {
  const raw = [
    'abc123',
    'feat: foo',
    'body line 1',
    'body line 2',
    '----END-COMMIT----',
    'def456',
    'baseline-refresh: bump',
    'justification goes here',
    '----END-COMMIT----',
  ].join('\n');
  const commits = parseCommitLog(raw);
  assert.strictEqual(commits.length, 2);
  assert.strictEqual(commits[0].subject, 'feat: foo');
  assert.strictEqual(commits[0].body, 'body line 1\nbody line 2');
  assert.strictEqual(commits[1].subject, 'baseline-refresh: bump');
  assert.strictEqual(commits[1].body, 'justification goes here');
});

test('parseCommitLog — empty input returns []', () => {
  assert.deepStrictEqual(parseCommitLog(''), []);
  assert.deepStrictEqual(parseCommitLog('   '), []);
});

test('parseBaseBranchConfig — reads crap block from well-formed json', () => {
  const json = JSON.stringify({
    agentSettings: {
      maintainability: {
        crap: {
          enabled: true,
          newMethodCeiling: 25,
          tolerance: 0.005,
          refreshTag: 'refresh:',
        },
      },
    },
  });
  const parsed = parseBaseBranchConfig(json);
  assert.deepStrictEqual(parsed, {
    newMethodCeiling: 25,
    tolerance: 0.005,
    refreshTag: 'refresh:',
    enabled: true,
  });
});

test('parseBaseBranchConfig — malformed json falls back to defaults', () => {
  const parsed = parseBaseBranchConfig('not json {');
  assert.strictEqual(parsed.newMethodCeiling, 30);
  assert.strictEqual(parsed.tolerance, 0.001);
  assert.strictEqual(parsed.refreshTag, 'baseline-refresh:');
  assert.strictEqual(parsed.enabled, true);
});

test('parseBaseBranchConfig — missing crap block falls back to defaults', () => {
  const parsed = parseBaseBranchConfig(
    JSON.stringify({ agentSettings: {} }),
  );
  assert.strictEqual(parsed.newMethodCeiling, 30);
  assert.strictEqual(parsed.refreshTag, 'baseline-refresh:');
});

test('parseBaseBranchConfig — respects enabled: false on base branch', () => {
  const parsed = parseBaseBranchConfig(
    JSON.stringify({
      agentSettings: {
        maintainability: { crap: { enabled: false } },
      },
    }),
  );
  assert.strictEqual(parsed.enabled, false);
});

test('classifyChangedFiles — detects baseline-only diff', () => {
  const c = classifyChangedFiles(['crap-baseline.json']);
  assert.strictEqual(c.hasBaselineEdits, true);
  assert.strictEqual(c.baselineOnly, true);
});

test('classifyChangedFiles — detects mixed baseline + source diff', () => {
  const c = classifyChangedFiles([
    'crap-baseline.json',
    '.agents/scripts/foo.js',
  ]);
  assert.strictEqual(c.hasBaselineEdits, true);
  assert.strictEqual(c.baselineOnly, false);
  assert.deepStrictEqual(c.changedBaselineFiles, ['crap-baseline.json']);
  assert.deepStrictEqual(c.changedOther, ['.agents/scripts/foo.js']);
});

test('classifyChangedFiles — non-baseline diff is pass-through', () => {
  const c = classifyChangedFiles(['.agents/scripts/foo.js']);
  assert.strictEqual(c.hasBaselineEdits, false);
  assert.strictEqual(c.baselineOnly, false);
});

test('findRefreshCommits — requires both tag prefix AND non-empty body', () => {
  const commits = [
    makeCommit('feat: bar', 'some body'),
    makeCommit('baseline-refresh: bump', ''), // tag, no body → rejected
    makeCommit('baseline-refresh: justified', 'we refactored X'), // accepted
    makeCommit('baseline-refresh:other', 'body'), // accepted (starts-with is loose)
  ];
  const matches = findRefreshCommits(commits, 'baseline-refresh:');
  assert.strictEqual(matches.length, 2);
  assert.ok(matches.every((c) => c.subject.startsWith('baseline-refresh:')));
  assert.ok(matches.every((c) => c.body.length > 0));
});

test('findRefreshCommits — empty/invalid inputs return []', () => {
  assert.deepStrictEqual(findRefreshCommits(null, 'x:'), []);
  assert.deepStrictEqual(findRefreshCommits([], 'x:'), []);
  assert.deepStrictEqual(findRefreshCommits([makeCommit('x: foo', 'b')], ''), []);
});

test('evaluateGuardrail — scenario: no baseline edits → pass, no label', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['.agents/scripts/foo.js', 'docs/CHANGELOG.md'],
    commits: [makeCommit('feat: change X', 'body')],
    refreshTag: BASE_CONFIG.refreshTag,
  });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.exitCode, 0);
  assert.strictEqual(verdict.shouldApplyBaselineLabel, false);
  assert.ok(verdict.messages.some((m) => m.includes('no baseline files')));
});

test('evaluateGuardrail — scenario: baseline edited, UNTAGGED commits → fail with tag in message', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json', '.agents/scripts/foo.js'],
    commits: [
      makeCommit('feat: refactor', 'body'),
      makeCommit('chore: bump', 'body'),
    ],
    refreshTag: 'baseline-refresh:',
  });
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.exitCode, 1);
  const combined = verdict.messages.join('\n');
  assert.ok(
    combined.includes('baseline-refresh:'),
    'failure message must name the required refreshTag',
  );
  assert.ok(combined.includes('crap-baseline.json'));
  assert.strictEqual(verdict.shouldApplyBaselineLabel, false);
});

test('evaluateGuardrail — scenario: tagged refresh commit WITH body → passes', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json'],
    commits: [
      makeCommit(
        'baseline-refresh: bump after escomplex 7.4',
        'Rescored after upstream formula change; no real regression.',
      ),
    ],
    refreshTag: 'baseline-refresh:',
  });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.exitCode, 0);
  assert.strictEqual(verdict.shouldApplyBaselineLabel, true); // baseline-only
  assert.ok(verdict.refreshCommits.length === 1);
});

test('evaluateGuardrail — scenario: tagged commit WITHOUT body → rejected, tag-in-message', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json'],
    commits: [makeCommit('baseline-refresh: bump', '')],
    refreshTag: 'baseline-refresh:',
  });
  assert.strictEqual(verdict.ok, false);
  assert.ok(
    verdict.messages.some((m) => m.includes('non-empty body')),
    'failure message must explain the non-empty-body requirement',
  );
});

test('evaluateGuardrail — scenario: custom refreshTag from base branch overrides default', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json'],
    commits: [makeCommit('chore(refresh): bump', 'justification')],
    refreshTag: 'chore(refresh):',
  });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.refreshCommits.length, 1);
});

test('evaluateGuardrail — scenario: baseline-only PR → shouldApplyBaselineLabel=true', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json', 'maintainability-baseline.json'],
    commits: [
      makeCommit('baseline-refresh: refresh both', 'dual refresh justified'),
    ],
    refreshTag: 'baseline-refresh:',
  });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.shouldApplyBaselineLabel, true);
});

test('evaluateGuardrail — scenario: mixed PR (baseline + source) → no label even when passing', () => {
  const verdict = evaluateGuardrail({
    changedFiles: ['crap-baseline.json', '.agents/scripts/foo.js'],
    commits: [
      makeCommit('baseline-refresh: bump', 'justified'),
      makeCommit('feat: new behavior', 'body'),
    ],
    refreshTag: 'baseline-refresh:',
  });
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(
    verdict.shouldApplyBaselineLabel,
    false,
    'mixed PRs should NOT get the review::baseline-refresh label',
  );
});

test('parseCliArgs — defaults and override combinations', () => {
  assert.deepStrictEqual(
    parseCliArgs(['--base-ref', 'origin/develop', '--pr-number', '42']),
    {
      baseRef: 'origin/develop',
      prNumber: 42,
      cwd: process.cwd(),
      skipLabel: false,
      skipCheckCrap: false,
    },
  );
  const defaults = parseCliArgs([]);
  assert.strictEqual(defaults.baseRef, 'origin/main');
  assert.strictEqual(defaults.prNumber, null);
});

test('parseCliArgs — --skip-label and --skip-check-crap flags', () => {
  const parsed = parseCliArgs([
    '--pr-number',
    '7',
    '--skip-label',
    '--skip-check-crap',
  ]);
  assert.strictEqual(parsed.skipLabel, true);
  assert.strictEqual(parsed.skipCheckCrap, true);
});

test('parseCliArgs — non-integer pr-number is rejected (left null)', () => {
  const parsed = parseCliArgs(['--pr-number', 'NaN']);
  assert.strictEqual(parsed.prNumber, null);
});

test('applyBaselineRefreshLabel — idempotent across re-runs (label exists → still applies)', () => {
  const calls = [];
  const runner = (_cwd, args) => {
    calls.push(args);
    if (args[0] === 'label' && args[1] === 'create') {
      // Simulate "label already exists" on re-run.
      return {
        status: 1,
        stdout: '',
        stderr: 'Label "review::baseline-refresh" already exists',
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const result1 = applyBaselineRefreshLabel({
    prNumber: 101,
    cwd: '.',
    runner,
  });
  const result2 = applyBaselineRefreshLabel({
    prNumber: 101,
    cwd: '.',
    runner,
  });
  assert.strictEqual(result1.applied, true);
  assert.strictEqual(result2.applied, true);
  // Both runs issue one create attempt + one add-label call — add-label is a
  // set-union on GitHub's side so repeats are harmless.
  const addLabelCalls = calls.filter(
    (a) => a[0] === 'pr' && a[1] === 'edit' && a.includes('--add-label'),
  );
  assert.strictEqual(addLabelCalls.length, 2);
  for (const call of addLabelCalls) {
    assert.ok(call.includes(BASELINE_REFRESH_LABEL));
    assert.ok(call.includes('101'));
  }
});

test('applyBaselineRefreshLabel — no pr-number: warns, does not call runner', () => {
  let called = false;
  const runner = () => {
    called = true;
    return { status: 0 };
  };
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(String(m));
  try {
    const res = applyBaselineRefreshLabel({
      prNumber: null,
      cwd: '.',
      runner,
    });
    assert.strictEqual(res.applied, false);
    assert.strictEqual(called, false);
    assert.ok(warnings[0].includes('--pr-number'));
  } finally {
    console.warn = origWarn;
  }
});

test('applyBaselineRefreshLabel — gh pr edit failure: returns applied=false, does not throw', () => {
  const runner = (_cwd, args) => {
    if (args[0] === 'pr' && args[1] === 'edit') {
      return { status: 1, stdout: '', stderr: 'forbidden' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const res = applyBaselineRefreshLabel({
      prNumber: 42,
      cwd: '.',
      runner,
    });
    assert.strictEqual(res.applied, false);
    assert.strictEqual(res.reason, 'gh-error');
  } finally {
    console.warn = origWarn;
  }
});
