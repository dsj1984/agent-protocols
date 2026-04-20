import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  calculateForFile,
  calculateForSource,
  calculateReport,
  calculateReportForFile,
  classifyReport,
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

test('calculateReport - returns per-method breakdown with worst/mean', () => {
  const code = `
    export function alpha(a) { return a + 1; }
    export function beta(b) { if (b) { return b * 2; } return 0; }
    export function gamma(c) {
      if (c > 0) {
        for (let i = 0; i < c; i++) {
          if (i % 2 === 0) return i;
        }
      }
      return -1;
    }
  `;
  const report = calculateReport(code);
  assert.strictEqual(report.parseError, false);
  assert.ok(report.methods.length >= 3, 'expected at least 3 methods');
  assert.ok(report.worstMethod !== null);
  assert.ok(report.meanMethod !== null);
  assert.ok(report.worstMethod <= report.meanMethod);
  assert.ok(report.moduleScore >= 0);
});

test('calculateReport - parse error returns structured failure', () => {
  const report = calculateReport('function foo() { if ( }');
  assert.strictEqual(report.parseError, true);
  assert.strictEqual(report.moduleScore, 0);
  assert.deepStrictEqual(report.methods, []);
});

test('calculateReportForFile - reads from disk', () => {
  const tempPath = path.join(os.tmpdir(), `report_test_${Date.now()}.js`);
  fs.writeFileSync(tempPath, 'export const foo = () => 1;');
  try {
    const report = calculateReportForFile(tempPath);
    assert.strictEqual(report.parseError, false);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

test('calculateReportForFile - throws ENOENT if file missing', () => {
  assert.throws(() => {
    calculateReportForFile('non-existent-file.js');
  }, /File not found/);
});

test('classifyReport - healthy when all methods strong', () => {
  const report = calculateReport(
    'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;',
  );
  assert.strictEqual(classifyReport(report), 'healthy');
});

test('classifyReport - warning when worst method < 50 but no critical hotspot', () => {
  const report = {
    moduleScore: 70,
    methods: [{ name: 'x', maintainability: 40, cyclomatic: 5, sloc: 20 }],
    worstMethod: 40,
    meanMethod: 40,
    parseError: false,
  };
  assert.strictEqual(classifyReport(report), 'warning');
});

test('classifyReport - warning when module low but no methods (size-driven)', () => {
  const report = {
    moduleScore: 55,
    methods: [],
    worstMethod: null,
    meanMethod: null,
    parseError: false,
  };
  assert.strictEqual(classifyReport(report), 'warning');
});

test('classifyReport - critical when a single method is a real hotspot', () => {
  const report = {
    moduleScore: 80,
    methods: [
      { name: 'gnarly', maintainability: 12, cyclomatic: 25, sloc: 60 },
    ],
    worstMethod: 12,
    meanMethod: 12,
    parseError: false,
  };
  assert.strictEqual(classifyReport(report), 'critical');
});

test('classifyReport - critical only when methodless module collapses far', () => {
  const lowNoMethods = {
    moduleScore: 30,
    methods: [],
    worstMethod: null,
    meanMethod: null,
    parseError: false,
  };
  assert.strictEqual(classifyReport(lowNoMethods), 'critical');
});

test('classifyReport - parse-error tier on failed parse', () => {
  assert.strictEqual(
    classifyReport({ parseError: true, moduleScore: 0, methods: [] }),
    'parse-error',
  );
});
