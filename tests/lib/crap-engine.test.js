import assert from 'node:assert';
import { test } from 'node:test';
import {
  calculateCrapForSource,
  crapFormula,
} from '../../.agents/scripts/lib/crap-engine.js';

/**
 * Build a coverage-entry fixture that forces coverageForMethodInEntry to
 * return a specific ratio for a method starting at `methodStartLine`.
 */
function coverageEntryFor(methodStartLine, ratio) {
  const total = 10;
  const covered = Math.round(ratio * total);
  const statementMap = {};
  const s = {};
  for (let i = 0; i < total; i += 1) {
    statementMap[String(i)] = {
      start: { line: methodStartLine + 1 + i, column: 0 },
      end: { line: methodStartLine + 1 + i, column: 10 },
    };
    s[String(i)] = i < covered ? 1 : 0;
  }
  return {
    fnMap: {
      0: {
        name: 'fn',
        decl: { start: { line: methodStartLine, column: 0 } },
        loc: {
          start: { line: methodStartLine, column: 0 },
          end: { line: methodStartLine + total + 1, column: 1 },
        },
      },
    },
    f: { 0: covered > 0 ? 1 : 0 },
    statementMap,
    s,
    branchMap: {},
    b: {},
  };
}

test('crapFormula — cov=1 returns c (no penalty)', () => {
  assert.strictEqual(crapFormula(1, 1), 1);
  assert.strictEqual(crapFormula(10, 1), 10);
});

test('crapFormula — cov=0 returns c² + c (full penalty)', () => {
  assert.strictEqual(crapFormula(1, 0), 2);
  assert.strictEqual(crapFormula(5, 0), 30);
  assert.strictEqual(crapFormula(10, 0), 110);
});

test('crapFormula — clamps coverage inputs into [0, 1]', () => {
  assert.strictEqual(crapFormula(5, -1), crapFormula(5, 0));
  assert.strictEqual(crapFormula(5, 2), crapFormula(5, 1));
});

test('crapFormula — newMethodCeiling=30 matches canonical c=5, cov=0 threshold', () => {
  // The PRD canonical ceiling of 30 corresponds to c=5 at zero coverage.
  assert.strictEqual(crapFormula(5, 0), 30);
  assert.ok(crapFormula(6, 0) > 30);
  assert.ok(crapFormula(4, 0) < 30);
});

test('calculateCrapForSource — low complexity + full coverage → low CRAP', () => {
  const source = `export function simple(x) { return x + 1; }\n`;
  const cov = coverageEntryFor(1, 1.0);
  const rows = calculateCrapForSource(source, cov);
  assert.strictEqual(rows.length, 1);
  const [row] = rows;
  assert.strictEqual(row.method, 'simple');
  assert.strictEqual(row.startLine, 1);
  assert.strictEqual(row.cyclomatic, 1);
  assert.strictEqual(row.coverage, 1);
  assert.strictEqual(row.crap, 1);
});

test('calculateCrapForSource — low complexity + zero coverage stays under ceiling', () => {
  const source = `export function simple(x) { return x + 1; }\n`;
  const cov = coverageEntryFor(1, 0);
  const [row] = calculateCrapForSource(source, cov);
  assert.strictEqual(row.cyclomatic, 1);
  assert.strictEqual(row.coverage, 0);
  assert.strictEqual(row.crap, 2);
});

test('calculateCrapForSource — high complexity + full coverage → CRAP = c', () => {
  const source = `
export function branchy(x) {
  if (x === 1) return 1;
  if (x === 2) return 2;
  if (x === 3) return 3;
  if (x === 4) return 4;
  if (x === 5) return 5;
  if (x === 6) return 6;
  if (x === 7) return 7;
  if (x === 8) return 8;
  if (x === 9) return 9;
  return 0;
}
`;
  const cov = coverageEntryFor(2, 1.0);
  const [row] = calculateCrapForSource(source, cov);
  assert.ok(
    row.cyclomatic >= 10,
    `expected high cyclomatic, got ${row.cyclomatic}`,
  );
  assert.strictEqual(row.coverage, 1);
  assert.strictEqual(row.crap, row.cyclomatic);
});

test('calculateCrapForSource — high complexity + zero coverage explodes', () => {
  const source = `
export function branchy(x) {
  if (x === 1) return 1;
  if (x === 2) return 2;
  if (x === 3) return 3;
  if (x === 4) return 4;
  if (x === 5) return 5;
  if (x === 6) return 6;
  if (x === 7) return 7;
  if (x === 8) return 8;
  if (x === 9) return 9;
  return 0;
}
`;
  const cov = coverageEntryFor(2, 0);
  const [row] = calculateCrapForSource(source, cov);
  assert.ok(row.cyclomatic >= 10);
  assert.strictEqual(row.coverage, 0);
  // c=10 → CRAP = 100 + 10 = 110; allow for slightly higher cyclomatic.
  const c = row.cyclomatic;
  assert.strictEqual(row.crap, c * c + c);
  assert.ok(row.crap >= 110);
});

test('calculateCrapForSource — null coverageForFile yields coverage=null, crap=null per method', () => {
  const source = `
export function a(x) { if (x) return 1; return 0; }
export function b() { return 2; }
`;
  const rows = calculateCrapForSource(source, null);
  assert.strictEqual(rows.length, 2);
  for (const row of rows) {
    assert.strictEqual(row.coverage, null);
    assert.strictEqual(row.crap, null);
    assert.ok(typeof row.cyclomatic === 'number' && row.cyclomatic >= 1);
    assert.ok(typeof row.startLine === 'number' && row.startLine > 0);
  }
});

test('calculateCrapForSource — method without coverage record gets null, others scored', () => {
  const source = `
export function scored(x) { return x + 1; }
export function unscored(x) { return x * 2; }
`;
  // Only provide coverage for the first method (startLine=2).
  const cov = coverageEntryFor(2, 1.0);
  const rows = calculateCrapForSource(source, cov);
  assert.strictEqual(rows.length, 2);
  const scored = rows.find((r) => r.method === 'scored');
  const unscored = rows.find((r) => r.method === 'unscored');
  assert.strictEqual(scored.coverage, 1);
  assert.strictEqual(scored.crap, scored.cyclomatic);
  assert.strictEqual(unscored.coverage, null);
  assert.strictEqual(unscored.crap, null);
});

test('calculateCrapForSource — invalid syntax returns empty array', () => {
  const rows = calculateCrapForSource('function foo( {', null);
  assert.deepStrictEqual(rows, []);
});

test('calculateCrapForSource — source with no methods returns empty array', () => {
  const rows = calculateCrapForSource('const x = 1;\nconst y = 2;\n', null);
  assert.deepStrictEqual(rows, []);
});

test('calculateCrapForSource — rows carry escomplex lineStart for baseline matching', () => {
  const source = `
// leading comments

export function first() { return 1; }

export function second() { return 2; }
`;
  const rows = calculateCrapForSource(source, null);
  const first = rows.find((r) => r.method === 'first');
  const second = rows.find((r) => r.method === 'second');
  assert.ok(first && second);
  assert.ok(second.startLine > first.startLine);
});

test('calculateCrapForSource — fixGuidance round-trip (single-axis fixes pass ceiling)', () => {
  // Simulate a regression: c=10, cov=0 → CRAP=110. Target ceiling 30.
  const c = 10;
  const target = 30;

  // minComplexityAt100Cov = floor(sqrt(target)) = 5 → CRAP at cov=1 is 5.
  const minComplexityAt100Cov = Math.floor(Math.sqrt(target));
  assert.ok(crapFormula(minComplexityAt100Cov, 1) <= target);

  // minCoverageAtCurrentComplexity = 1 − ((target − c)/c²)^(1/3)
  // For target=30, c=10 → 1 − (20/100)^(1/3) ≈ 0.415
  const minCov = 1 - ((target - c) / (c * c)) ** (1 / 3);
  assert.ok(crapFormula(c, minCov) <= target + 1e-9);
});
