/**
 * tests/enforcement/cli-wrapper.test.js
 *
 * Enforces the CLI-bootstrap convention: every top-level script under
 * `.agents/scripts/` must either invoke `runAsCli()` (the canonical
 * main-guard helper in `lib/cli-utils.js`) **or** carry a documented
 * `// cli-opt-out: <reason>` comment explaining why the bespoke
 * main-guard exists. The opt-out comment is the audit trail; without it,
 * a fresh main-guard pattern in this directory is a regression.
 *
 * Scope: only files matching `.agents/scripts/*.js` (top-level CLIs).
 * Library code under `.agents/scripts/lib/` is out of scope by design —
 * library files should not have main-guards at all.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, '.agents', 'scripts');

const RUN_AS_CLI_RE = /\brunAsCli\s*\(/;
// Opt-out marker must be a non-empty reason.
const OPT_OUT_RE = /\/\/\s*cli-opt-out\s*:\s*\S+/;

function listTopLevelJs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => path.join(dir, d.name));
}

function classifyScript(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (RUN_AS_CLI_RE.test(content)) return 'runAsCli';
  if (OPT_OUT_RE.test(content)) return 'opt-out';
  return 'missing';
}

test('RUN_AS_CLI_RE matches a real call', () => {
  assert.strictEqual(
    RUN_AS_CLI_RE.test('runAsCli(import.meta.url, main);'),
    true,
  );
});

test('RUN_AS_CLI_RE does not match a string mention', () => {
  // The regex relies on word boundary + open-paren — a quoted string with
  // a different surrounding char would match. That's acceptable for this
  // grep test (false-positive direction is "permits more files", which
  // can't make the test fail spuriously).
  assert.strictEqual(RUN_AS_CLI_RE.test('runAsCliMaybe();'), false);
});

test('OPT_OUT_RE requires a non-empty reason', () => {
  assert.strictEqual(
    OPT_OUT_RE.test('// cli-opt-out: bespoke main-guard'),
    true,
  );
  assert.strictEqual(OPT_OUT_RE.test('// cli-opt-out:'), false);
  assert.strictEqual(OPT_OUT_RE.test('// cli-opt-out:   '), false);
});

test('OPT_OUT_RE matches with leading whitespace and varied spacing', () => {
  assert.strictEqual(
    OPT_OUT_RE.test('   //  cli-opt-out  :   reason here'),
    true,
  );
});

test('every .agents/scripts/*.js either calls runAsCli() or has a documented cli-opt-out comment', () => {
  const files = listTopLevelJs(SCRIPTS_DIR);
  assert.ok(
    files.length > 0,
    `expected at least one .js file directly under ${SCRIPTS_DIR}`,
  );
  const failures = [];
  for (const file of files) {
    const verdict = classifyScript(file);
    if (verdict !== 'missing') continue;
    failures.push(
      `  .agents/scripts/${path.basename(file)}  — no runAsCli() call and no \`// cli-opt-out: <reason>\` comment`,
    );
  }
  assert.deepStrictEqual(
    failures,
    [],
    `Top-level CLI scripts must either call runAsCli() (preferred) or document a bespoke main-guard with a \`// cli-opt-out: <reason>\` comment.\n${failures.join('\n')}`,
  );
});

export { classifyScript, listTopLevelJs, OPT_OUT_RE, RUN_AS_CLI_RE };
