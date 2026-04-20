import assert from 'node:assert';
import { test } from 'node:test';
import { parseLintOutput } from '../.agents/scripts/sprint-code-review.js';

test('parseLintOutput - clean run reports zero', () => {
  const out = parseLintOutput({
    status: 0,
    stdout: 'Checked 42 files in 120ms. No fixes applied.\n',
    stderr: '',
  });
  assert.deepStrictEqual(out, { errors: 0, warnings: 0, parsed: false });
});

test('parseLintOutput - biome error + warning counts both captured', () => {
  const out = parseLintOutput({
    status: 1,
    stdout: 'Checked 10 files.\nFound 2 errors.\nFound 3 warnings.\n',
    stderr: '',
  });
  assert.deepStrictEqual(out, { errors: 2, warnings: 3, parsed: true });
});

test('parseLintOutput - warnings-only run stays below high-risk threshold', () => {
  const out = parseLintOutput({
    status: 0,
    stdout: 'Found 4 warnings.\n',
    stderr: '',
  });
  assert.strictEqual(out.errors, 0);
  assert.strictEqual(out.warnings, 4);
  assert.strictEqual(out.parsed, true);
});

test('parseLintOutput - markdownlint Summary line counted as error', () => {
  const out = parseLintOutput({
    status: 1,
    stdout: 'file.md:3 MD022/blanks-around-headings\n\nSummary: 1 error\n',
    stderr: '',
  });
  assert.strictEqual(out.errors, 1);
  assert.strictEqual(out.parsed, true);
});

test('parseLintOutput - unknown failing runner defaults to one error', () => {
  const out = parseLintOutput({
    status: 1,
    stdout: 'some unexpected output\n',
    stderr: 'boom\n',
  });
  assert.strictEqual(out.errors, 1);
  assert.strictEqual(out.warnings, 0);
  assert.strictEqual(out.parsed, false);
});
