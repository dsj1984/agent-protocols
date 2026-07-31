import assert from 'node:assert';
import { describe, it, test } from 'node:test';
import {
  COORDINATE_ORIGINAL,
  COORDINATE_TRANSPILED,
  calculateCrapForSource,
  crapFormula,
  deriveFixGuidance,
  finalizeMethodRows,
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
  // `unscored` sits far below the covered function's `loc` range so neither
  // containment nor the ±1 decl window can claim it (Story #4775) — it is
  // genuinely uninstrumented, not merely mis-keyed.
  const source = `
export function scored(x) { return x + 1; }
${'\n'.repeat(40)}
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

// ---------------------------------------------------------------------------
// Story #4866 — coordinate provenance. Before this Story, a method whose
// sourcemap lookup returned null silently kept its TRANSPILED line while its
// siblings carried remapped ORIGINAL ones: one scan, two coordinate systems,
// indistinguishable on disk. That mix is what mis-keys rows against the
// baseline and manufactures a regression no change can satisfy.
// ---------------------------------------------------------------------------

/** A source whose methods sit at known lines, for provenance assertions. */
const TWO_METHODS = `
export function first(x) { if (x) return 1; return 0; }

export function second(x) { if (x) return 2; return 0; }
`;

describe('methodRowsFromReport — coordinate provenance (AC-1, AC-2)', () => {
  it('records original coordinates for a JavaScript source (no mapper)', () => {
    // JS coordinates already ARE original-source coordinates — nothing was
    // remapped, and nothing needed to be.
    const rows = calculateCrapForSource(TWO_METHODS, null);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.coordinateSystem, COORDINATE_ORIGINAL);
    }
  });

  it('records original coordinates when the sourcemap resolves', () => {
    const rows = calculateCrapForSource(TWO_METHODS, null, (line) => line + 10);
    for (const row of rows) {
      assert.equal(row.coordinateSystem, COORDINATE_ORIGINAL);
    }
    // And the row reports the remapped line, not the generated one.
    assert.ok(rows.every((r) => r.startLine > 10));
  });

  it('flags the row when the sourcemap has no entry for the generated line', () => {
    const rows = calculateCrapForSource(TWO_METHODS, null, () => null);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.coordinateSystem, COORDINATE_TRANSPILED);
    }
  });

  it('emits exactly one coordinate system per row in a MIXED scan (AC-3)', () => {
    // The defect's exact shape: one method resolves, its sibling does not.
    // Both rows used to be emitted as if they shared a coordinate system.
    const rows = calculateCrapForSource(TWO_METHODS, null, (line) =>
      line < 3 ? line + 100 : null,
    );
    const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]));
    assert.equal(byMethod.first.coordinateSystem, COORDINATE_ORIGINAL);
    assert.equal(byMethod.second.coordinateSystem, COORDINATE_TRANSPILED);
    assert.equal(
      new Set(rows.map((r) => r.coordinateSystem)).size,
      2,
      'the mix must be VISIBLE on the rows, not silently flattened',
    );
  });
});

describe('methodRowsFromReport — an un-remapped line joins no coverage (AC-2)', () => {
  it('refuses the coverage join rather than reading the wrong coordinate', () => {
    // The coverage entry is keyed at line 2 in ORIGINAL coordinates. Without
    // a resolved remap the row's line is a transpiled coordinate, and reading
    // istanbul's fnMap with it does not merely miss — it can land inside an
    // unrelated function's range and report an untested method as covered.
    const source = `export function simple(x) { return x + 1; }\n`;
    const cov = coverageEntryFor(1, 1.0);

    const resolved = calculateCrapForSource(source, cov, (line) => line);
    assert.equal(resolved[0].coverage, 1);
    assert.equal(resolved[0].crap, 1);

    const unresolved = calculateCrapForSource(source, cov, () => null);
    assert.equal(unresolved[0].coordinateSystem, COORDINATE_TRANSPILED);
    assert.equal(
      unresolved[0].coverage,
      null,
      'a transpiled coordinate must not be joined against an original-source fnMap',
    );
    assert.equal(unresolved[0].crap, null);
  });
});

describe('finalizeMethodRows — provenance survives the policy step', () => {
  const raw = [
    {
      method: 'mapped',
      startLine: 4,
      cyclomatic: 2,
      coverage: 1,
      crap: 2,
      coordinateSystem: COORDINATE_ORIGINAL,
    },
    {
      method: 'unmapped',
      startLine: 9,
      cyclomatic: 3,
      coverage: null,
      crap: null,
      coordinateSystem: COORDINATE_TRANSPILED,
    },
  ];

  it('drops the un-remapped row under requireCoverage: true', () => {
    // The default policy. An un-remapped row is unresolved, so it never
    // reaches a baseline at all — which is why a pure-JS baseline is
    // untouched by this change.
    const out = finalizeMethodRows(raw, { requireCoverage: true });
    assert.deepEqual(
      out.rows.map((r) => r.method),
      ['mapped'],
    );
    assert.equal(out.skippedMethodsNoCoverage, 1);
  });

  it('keeps the flag on a row scored 0% under requireCoverage: false', () => {
    // Here the row DOES land in the baseline, so the flag is the only thing
    // stopping the compare from keying a transpiled line as an original one.
    const out = finalizeMethodRows(raw, { requireCoverage: false });
    const unmapped = out.rows.find((r) => r.method === 'unmapped');
    assert.equal(unmapped.coordinateSystem, COORDINATE_TRANSPILED);
    assert.equal(unmapped.coverage, 0);
    assert.equal(unmapped.crap, 3 ** 2 + 3);
  });

  it('defaults a row with no stamp to original coordinates', () => {
    // Back-compat: rows built before the stamp existed are original-source
    // coordinates by construction.
    const out = finalizeMethodRows(
      [{ method: 'legacy', startLine: 1, cyclomatic: 1, coverage: 1, crap: 1 }],
      { requireCoverage: true },
    );
    assert.equal(out.rows[0].coordinateSystem, COORDINATE_ORIGINAL);
  });
});

test('deriveFixGuidance — regression path (target=baseline, c=10 → both axes achievable)', () => {
  const guidance = deriveFixGuidance({ cyclomatic: 10, target: 30 });
  assert.ok(guidance);
  assert.strictEqual(guidance.crapCeiling, 30);
  assert.strictEqual(guidance.minComplexityAt100Cov, 5);
  // Formula: 1 - ((30-10)/100)^(1/3) ≈ 0.4152; expect a finite [0,1] value.
  assert.ok(guidance.minCoverageAtCurrentComplexity > 0);
  assert.ok(guidance.minCoverageAtCurrentComplexity < 1);
  // Round-trip — applying the coverage fix at the current complexity passes.
  assert.ok(
    crapFormula(10, guidance.minCoverageAtCurrentComplexity) <= 30 + 1e-9,
  );
  // Round-trip — applying the complexity fix at full coverage passes.
  assert.ok(crapFormula(guidance.minComplexityAt100Cov, 1) <= 30);
});

test('deriveFixGuidance — c > target renders coverage axis unachievable (null)', () => {
  // At c=40, CRAP@cov=1 = 40 which already exceeds a ceiling of 30. Coverage
  // alone cannot rescue the method — only complexity reduction can.
  const guidance = deriveFixGuidance({ cyclomatic: 40, target: 30 });
  assert.ok(guidance);
  assert.strictEqual(guidance.minCoverageAtCurrentComplexity, null);
  assert.strictEqual(guidance.minComplexityAt100Cov, 5);
});

test('deriveFixGuidance — c === target yields cov=1 exactly (boundary)', () => {
  // At c=t, the only passing coverage is 1.0 — the cube-root term is zero.
  const guidance = deriveFixGuidance({ cyclomatic: 10, target: 10 });
  assert.ok(guidance);
  assert.strictEqual(guidance.minCoverageAtCurrentComplexity, 1);
  assert.strictEqual(guidance.minComplexityAt100Cov, 3);
});

test('deriveFixGuidance — new-violation path (target=ceiling=30, c=6)', () => {
  const guidance = deriveFixGuidance({ cyclomatic: 6, target: 30 });
  assert.ok(guidance);
  assert.strictEqual(guidance.crapCeiling, 30);
  assert.strictEqual(guidance.minComplexityAt100Cov, 5);
  assert.ok(
    crapFormula(6, guidance.minCoverageAtCurrentComplexity) <= 30 + 1e-9,
  );
});

test('deriveFixGuidance — c=0 is degenerate: coverage is null, complexity fix is 0', () => {
  const guidance = deriveFixGuidance({ cyclomatic: 0, target: 30 });
  assert.ok(guidance);
  assert.strictEqual(guidance.minCoverageAtCurrentComplexity, null);
  assert.strictEqual(guidance.minComplexityAt100Cov, 5);
});

test('deriveFixGuidance — non-finite inputs return null', () => {
  assert.strictEqual(deriveFixGuidance({ cyclomatic: NaN, target: 30 }), null);
  assert.strictEqual(
    deriveFixGuidance({ cyclomatic: 10, target: Infinity }),
    null,
  );
  assert.strictEqual(deriveFixGuidance({ cyclomatic: 10, target: -1 }), null);
  assert.strictEqual(deriveFixGuidance(), null);
});

test('deriveFixGuidance — deterministic across repeated calls', () => {
  const a = deriveFixGuidance({ cyclomatic: 10, target: 30 });
  const b = deriveFixGuidance({ cyclomatic: 10, target: 30 });
  assert.deepStrictEqual(a, b);
});
