import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scanDirectory } from '../.agents/scripts/lib/maintainability-utils.js';

/**
 * Acceptance criterion (Story #829, 5.29.0): `coverage/` and `.next/`
 * are now in IGNORED_DIRS. This test asserts that source files dropped
 * inside a `coverage/` directory under the scan root are NOT walked, so
 * vitest's istanbul HTML scaffolding (which writes .js files) doesn't
 * pollute the baseline.
 */

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mi_ignore_'));
}

function rmTmp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

test('scanDirectory — files inside coverage/ are not walked', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'coverage'));
    fs.mkdirSync(path.join(dir, 'coverage', 'lcov-report'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;');
    fs.writeFileSync(
      path.join(dir, 'coverage', 'block-navigation.js'),
      'const x = 1;',
    );
    fs.writeFileSync(
      path.join(dir, 'coverage', 'lcov-report', 'sorter.js'),
      'const y = 2;',
    );

    const found = scanDirectory(dir);
    const rels = found.map((p) => path.relative(dir, p).replace(/\\/g, '/'));
    assert.deepStrictEqual(rels.sort(), ['src/a.js']);
  } finally {
    rmTmp(dir);
  }
});

test('scanDirectory — files inside .next/ are not walked', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'app'));
    fs.mkdirSync(path.join(dir, '.next'));
    fs.mkdirSync(path.join(dir, '.next', 'static'));
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default 1;');
    fs.writeFileSync(path.join(dir, '.next', 'build-manifest.js'), 'const a;');
    fs.writeFileSync(
      path.join(dir, '.next', 'static', 'chunk.js'),
      'const b = 1;',
    );

    const found = scanDirectory(dir);
    const rels = found.map((p) => path.relative(dir, p).replace(/\\/g, '/'));
    assert.deepStrictEqual(rels.sort(), ['app/page.tsx']);
  } finally {
    rmTmp(dir);
  }
});

test('scanDirectory — accepts .js, .mjs, .cjs, .ts, .tsx, .mts, .cts', () => {
  const dir = mkTmp();
  try {
    const exts = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
    for (const ext of exts) {
      fs.writeFileSync(path.join(dir, `file${ext}`), '// noop\n');
    }
    fs.writeFileSync(path.join(dir, 'README.md'), '# nope');
    fs.writeFileSync(path.join(dir, 'data.json'), '{}');

    const found = scanDirectory(dir);
    const rels = found.map((p) => path.relative(dir, p)).sort();
    assert.deepStrictEqual(
      rels,
      [
        'file.cjs',
        'file.cts',
        'file.js',
        'file.mjs',
        'file.mts',
        'file.ts',
        'file.tsx',
      ].sort(),
    );
  } finally {
    rmTmp(dir);
  }
});
