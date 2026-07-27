import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { scanAndScore } from '../.agents/scripts/lib/crap-utils.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

/**
 * Acceptance criterion (Story #829, 5.29.0): when scoring a `.tsx`
 * source whose coverage entry is keyed on the original `.tsx` path,
 * CRAP must resolve coverage correctly at the FILE-PATH level. The
 * transpile is in-memory only — vitest's `coverage-final.json` keys on
 * the source file, never the transpiled output, so the original path is
 * what the lookup must use.
 *
 * Line numbers (Story #4775): `ts.transpileModule` does NOT preserve line
 * numbers. JSX runtime imports add a line at the top of TSX output and
 * interface elision shifts subsequent code in plain TS, so escomplex's
 * per-method `lineStart` is in TRANSPILED coordinates while the coverage
 * entry is in ORIGINAL SOURCE coordinates. The scorer closes that gap at
 * scoring time by remapping each method start through the transpile's
 * source map before the coverage lookup.
 *
 * This fixture therefore lays its coverage entry at the REAL source line
 * — the line a reader opening `Greeting.tsx` would see — which is the only
 * configuration a real `coverage-final.json` can contain. The previous
 * revision of this file laid the entry at the transpiled line instead and
 * asserted that `compareCrap`'s line-drift fallback absorbed the
 * difference; it does not. `compareCrap` reconciles CURRENT rows against
 * BASELINE rows at comparison time, long after an unresolved method has
 * already been dropped at scoring time — which is precisely how the
 * production path stayed broken while this test stayed green.
 */

function mkTmp() {
  return makeTempDir('crap_tsx_');
}

function rmTmp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

const TSX_SOURCE = `interface Props { name: string; count: number; }

export function Greeting({ name, count }: Props): JSX.Element {
  if (count > 0) {
    return <div className="hi">Hello {name} ({count})</div>;
  }
  if (count < 0) {
    return <div className="oops">Negative {name}</div>;
  }
  return <div>Hello {name}</div>;
}
`;

/**
 * Build a coverage-final.json entry whose statements map covers the body
 * of `Greeting`, keyed at its REAL line in `TSX_SOURCE`. The entry uses the
 * absolute file path as its key field — vitest writes absolute paths in
 * `coverage-final.json` by default; the loader/resolver normalises by
 * suffix match.
 */
function coverageEntryForGreeting(absPath, methodStartLine) {
  const total = 8;
  const covered = total; // 100% coverage so coverage > 0 → non-null
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
    [absPath]: {
      path: absPath,
      fnMap: {
        0: {
          name: 'Greeting',
          decl: { start: { line: methodStartLine, column: 0 } },
          loc: {
            start: { line: methodStartLine, column: 0 },
            end: { line: methodStartLine + total + 2, column: 1 },
          },
          line: methodStartLine,
        },
      },
      f: { 0: 1 },
      statementMap,
      s,
      branchMap: {},
      b: {},
    },
  };
}

test('scanAndScore — TSX source resolves coverage keyed on original .tsx path', async () => {
  const dir = mkTmp();
  try {
    const tsxPath = path.join(dir, 'Greeting.tsx');
    fs.writeFileSync(tsxPath, TSX_SOURCE);

    // `Greeting` is declared at line 3 of TSX_SOURCE. After
    // ts.transpileModule with JsxEmit.ReactJSX it lands at transpiled line 2
    // (the interface is elided, the JSX runtime import injected). The
    // coverage entry is laid at the SOURCE line — 3 — exactly as a real
    // coverage-final.json would; the scorer remaps 2 → 3 before the lookup.
    const GREETING_SOURCE_LINE = 3;
    assert.match(
      TSX_SOURCE.split('\n')[GREETING_SOURCE_LINE - 1],
      /export function Greeting/,
      'fixture drift: Greeting is no longer on the asserted source line',
    );
    const coverage = coverageEntryForGreeting(tsxPath, GREETING_SOURCE_LINE);

    const result = await scanAndScore({
      targetDirs: [dir],
      coverage,
      requireCoverage: true,
      cwd: dir,
    });

    // The file-path lookup hit even though the entry key is the
    // absolute .tsx path — proves no key mismatch from the transpile.
    assert.strictEqual(result.skippedFilesNoCoverage, 0);
    // Greeting function is scored.
    assert.ok(
      result.rows.length >= 1,
      `expected ≥1 row; got ${result.rows.length}`,
    );
    // The path stored in the row is the original .tsx path (POSIX).
    for (const row of result.rows) {
      assert.match(row.file, /\.tsx$/, 'rows must use original TSX path');
      assert.notStrictEqual(
        row.coverage,
        null,
        'coverage must resolve via TSX key',
      );
      assert.ok(row.coverage >= 0 && row.coverage <= 1);
    }
    // Every method resolved — nothing was silently dropped for want of a
    // coordinate remap (Story #4775, AC-2).
    assert.strictEqual(result.skippedMethodsNoCoverage, 0);
    assert.strictEqual(result.resolution.rate, 1);
    // And the persisted startLine is a line a reader can open in the .tsx.
    const greeting = result.rows.find((r) => r.method === 'Greeting');
    assert.ok(greeting, 'Greeting must be scored');
    assert.strictEqual(greeting.startLine, GREETING_SOURCE_LINE);
  } finally {
    rmTmp(dir);
  }
});

test('scanAndScore — TSX source without coverage entry is skipped under requireCoverage=true', async () => {
  const dir = mkTmp();
  try {
    const tsxPath = path.join(dir, 'NoCov.tsx');
    fs.writeFileSync(tsxPath, TSX_SOURCE);

    // Coverage map deliberately empty — verifies the file path filter
    // and skip path treat .tsx the same as .js.
    const result = await scanAndScore({
      targetDirs: [dir],
      coverage: {},
      requireCoverage: true,
      cwd: dir,
    });
    assert.strictEqual(result.skippedFilesNoCoverage, 1);
    assert.strictEqual(result.rows.length, 0);
  } finally {
    rmTmp(dir);
  }
});
