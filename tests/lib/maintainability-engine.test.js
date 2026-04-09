import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  calculateForFile,
  calculateForSource,
} from '../../.agents/scripts/lib/maintainability-engine.js';

test('calculateForSource - parses valid code', () => {
  const code = `
    function hello(name) {
      if (name) {
        return "Hello " + name;
      }
      return "Hello World";
    }
  `;
  const score = calculateForSource(code);
  assert.ok(typeof score === 'number');
  assert.ok(score > 0 && score <= 171);
});

test('calculateForSource - returns 0 for invalid syntax', () => {
  const invalidCode = `function foo() { if ( }`;
  const score = calculateForSource(invalidCode);
  assert.strictEqual(score, 0);
});

test('calculateForFile - parses file', () => {
  const tempPath = path.join(
    os.tmpdir(),
    `temp_m_engine_test_${Date.now()}.js`,
  );
  fs.writeFileSync(tempPath, 'const a = 1;');

  try {
    const score = calculateForFile(tempPath);
    assert.ok(typeof score === 'number');
    assert.ok(score > 0 && score <= 171);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
});

test('calculateForFile - throws ENOENT if file missing', () => {
  assert.throws(() => {
    calculateForFile('non-existent-file.js');
  }, /File not found/);
});
