import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseLintOutput,
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
