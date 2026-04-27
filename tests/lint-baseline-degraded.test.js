import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diffPerFile,
  formatDiffTable,
  parseLintOutput,
  parseLintOutputDetailed,
  runLintCommand,
} from '../.agents/scripts/lint-baseline.js';

/**
 * Tech Spec #819 / Story #826 — `runLintCommand` previously emitted a silent
 * `{ errorCount: 0, warningCount: 0 }` fallback when the lint command's stdout
 * couldn't be JSON-parsed, masking real tooling regressions. The new contract:
 *
 *   - default mode → `{ ok: false, degraded: true, reason: 'LINT_OUTPUT_PARSE_FAILED', detail }`
 *   - gate-mode    → throws (hard-fail closed)
 *
 * These tests pin both branches against a synthetic command (`node -e ...`)
 * whose stdout is deterministic, so the suite stays hermetic.
 */

const NOT_JSON_CMD = `node -e "process.stdout.write('this is not json output')"`;
const VALID_JSON_CMD = `node -e "process.stdout.write('[]')"`;

test('parseLintOutput — empty string returns zero counts (existing contract preserved)', () => {
  assert.deepEqual(parseLintOutput('', 'cmd'), {
    errorCount: 0,
    warningCount: 0,
  });
});

test('parseLintOutput — well-formed array tallies counts across files', () => {
  const json = JSON.stringify([
    { errorCount: 2, warningCount: 1 },
    { errorCount: 0, warningCount: 3 },
  ]);
  assert.deepEqual(parseLintOutput(json, 'cmd'), {
    errorCount: 2,
    warningCount: 4,
  });
});

test('runLintCommand — JSON-parse failure returns the degraded envelope (default mode)', () => {
  const result = runLintCommand(NOT_JSON_CMD, 5000, 1024 * 1024, {
    argv: [],
    env: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, 'LINT_OUTPUT_PARSE_FAILED');
  assert.match(result.detail, /failed to parse JSON/);
});

test('runLintCommand — JSON-parse failure throws under --gate-mode', () => {
  assert.throws(
    () =>
      runLintCommand(NOT_JSON_CMD, 5000, 1024 * 1024, {
        argv: ['--gate-mode'],
        env: {},
      }),
    (err) => {
      assert.equal(err.code, 'LINT_OUTPUT_PARSE_FAILED');
      assert.equal(err.degraded, true);
      return true;
    },
  );
});

test('runLintCommand — well-formed JSON output returns counts (no degraded shape)', () => {
  const result = runLintCommand(VALID_JSON_CMD, 5000, 1024 * 1024, {
    argv: [],
    env: {},
  });
  assert.deepEqual(result, { errorCount: 0, warningCount: 0 });
});

/* --------------------------------------------------------------------- */
/* parseLintOutputDetailed + diffPerFile + formatDiffTable                */
/* --------------------------------------------------------------------- */

test('parseLintOutputDetailed — empty input returns empty byFile + zero totals', () => {
  assert.deepEqual(parseLintOutputDetailed('', 'cmd'), {
    errorCount: 0,
    warningCount: 0,
    byFile: {},
  });
});

test('parseLintOutputDetailed — captures per-file counts and rule histograms', () => {
  const json = JSON.stringify([
    {
      filePath: 'src/foo.ts',
      errorCount: 1,
      warningCount: 2,
      messages: [
        { ruleId: 'no-unused-vars', severity: 2 },
        { ruleId: 'sonarjs/no-small-switch', severity: 1 },
        { ruleId: 'sonarjs/no-small-switch', severity: 1 },
      ],
    },
    {
      filePath: 'src/bar.ts',
      errorCount: 0,
      warningCount: 0,
      messages: [],
    },
  ]);
  const out = parseLintOutputDetailed(json, 'cmd');
  assert.equal(out.errorCount, 1);
  assert.equal(out.warningCount, 2);
  assert.deepEqual(out.byFile, {
    'src/foo.ts': {
      errorCount: 1,
      warningCount: 2,
      rules: { 'no-unused-vars': 1, 'sonarjs/no-small-switch': 2 },
    },
  });
});

test('diffPerFile — surfaces files where current exceeds baseline; sorted by warning delta', () => {
  const baseline = {
    byFile: {
      'apps/web/src/a.ts': { errorCount: 0, warningCount: 1 },
      'apps/web/src/b.ts': { errorCount: 0, warningCount: 0 },
    },
  };
  const current = {
    byFile: {
      'apps/web/src/a.ts': {
        errorCount: 0,
        warningCount: 3,
        rules: { 'sonarjs/cyclomatic-complexity': 2 },
      },
      'apps/web/src/b.ts': {
        errorCount: 0,
        warningCount: 1,
        rules: { 'sonarjs/no-small-switch': 1 },
      },
      'apps/web/src/c.ts': {
        errorCount: 1,
        warningCount: 0,
        rules: { 'no-unused-vars': 1 },
      },
    },
  };
  const rows = diffPerFile(baseline, current);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].file, 'apps/web/src/a.ts');
  assert.equal(rows[0].warningDelta, 2);
  assert.deepEqual(rows[0].rules, ['sonarjs/cyclomatic-complexity']);
  assert.equal(rows[1].file, 'apps/web/src/b.ts');
  assert.equal(rows[2].file, 'apps/web/src/c.ts');
  assert.equal(rows[2].errorDelta, 1);
});

test('diffPerFile — files with no regression are dropped', () => {
  const baseline = {
    byFile: { 'a.ts': { errorCount: 5, warningCount: 5 } },
  };
  const current = {
    byFile: {
      'a.ts': { errorCount: 3, warningCount: 5, rules: { foo: 1 } },
    },
  };
  assert.deepEqual(diffPerFile(baseline, current), []);
});

test('diffPerFile — missing baseline.byFile treats baseline as empty', () => {
  const current = {
    byFile: { 'a.ts': { errorCount: 0, warningCount: 1, rules: { foo: 1 } } },
  };
  const rows = diffPerFile({}, current);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].warningDelta, 1);
});

test('formatDiffTable — empty rows renders the no-regression message', () => {
  const out = formatDiffTable([], { baselineHasByFile: true });
  assert.match(out, /No per-file regressions detected/);
});

test('formatDiffTable — renders header + per-file row with delta and rules', () => {
  const out = formatDiffTable(
    [
      {
        file: 'src/foo.ts',
        errorDelta: 0,
        warningDelta: 2,
        rules: ['sonarjs/no-small-switch', 'sonarjs/cyclomatic-complexity'],
      },
    ],
    { baselineHasByFile: true },
  );
  assert.match(out, /File\s+Δ warn\/err\s+rules/);
  assert.match(out, /src\/foo\.ts/);
  assert.match(out, /\+2w \/ \+0e/);
  assert.match(out, /sonarjs\/no-small-switch/);
});

test('formatDiffTable — prepends note when baseline lacks byFile', () => {
  const out = formatDiffTable(
    [
      {
        file: 'a.ts',
        errorDelta: 0,
        warningDelta: 1,
        rules: ['foo'],
      },
    ],
    { baselineHasByFile: false },
  );
  assert.match(out, /Baseline has no per-file data/);
  assert.match(out, /a\.ts/);
});
