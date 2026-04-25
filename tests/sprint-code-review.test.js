import assert from 'node:assert';
import { test } from 'node:test';
import {
  analyzeChangedFiles,
  buildLintLine,
  buildReviewReport,
  buildSeverity,
  classifyChangedFile,
  parseLintOutput,
  parseReviewArgs,
} from '../.agents/scripts/sprint-code-review.js';

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

test('parseReviewArgs - rejects missing/invalid epic id', () => {
  assert.deepStrictEqual(parseReviewArgs([]), {
    epicId: null,
    baseBranch: null,
    post: true,
  });
  assert.strictEqual(parseReviewArgs(['--epic', 'abc']).epicId, null);
  assert.strictEqual(parseReviewArgs(['--epic', '0']).epicId, null);
  assert.strictEqual(parseReviewArgs(['--epic', '-3']).epicId, null);
});

test('parseReviewArgs - parses epic and base', () => {
  assert.deepStrictEqual(
    parseReviewArgs(['--epic', '42', '--base', 'develop']),
    { epicId: 42, baseBranch: 'develop', post: true },
  );
});

test('classifyChangedFile - critical tier with low worst method', () => {
  const out = classifyChangedFile('foo.js', {
    reportFn: () => ({ moduleScore: 5, worstMethod: 12 }),
    classifier: () => 'critical',
  });
  assert.strictEqual(out.row.tier, 'critical');
  assert.match(out.criticalIssue, /worst method 12.0/);
  assert.strictEqual(out.warningIssue, null);
});

test('classifyChangedFile - critical tier falls back to module score', () => {
  const out = classifyChangedFile('foo.js', {
    reportFn: () => ({ moduleScore: 18.4, worstMethod: 25 }),
    classifier: () => 'critical',
  });
  assert.match(out.criticalIssue, /module score 18.4/);
});

test('classifyChangedFile - warning tier emits size/volume row', () => {
  const out = classifyChangedFile('foo.js', {
    reportFn: () => ({ moduleScore: 60.5, worstMethod: 30.3 }),
    classifier: () => 'warning',
  });
  assert.strictEqual(out.criticalIssue, null);
  assert.match(out.warningIssue, /Size\/Volume Warning/);
  assert.match(out.warningIssue, /worst method 30.3/);
});

test('classifyChangedFile - warning tier without worstMethod', () => {
  const out = classifyChangedFile('foo.js', {
    reportFn: () => ({ moduleScore: 70, worstMethod: null }),
    classifier: () => 'warning',
  });
  assert.match(out.warningIssue, /module 70.0\)/);
});

test('classifyChangedFile - swallows file-deleted reportFn errors', () => {
  const out = classifyChangedFile('gone.js', {
    reportFn: () => {
      throw new Error('ENOENT');
    },
    classifier: () => 'healthy',
  });
  assert.deepStrictEqual(out, {
    row: null,
    criticalIssue: null,
    warningIssue: null,
  });
});

test('analyzeChangedFiles - skips non-JS files and accumulates tiers', () => {
  const reports = new Map([
    ['a.js', { moduleScore: 80, worstMethod: 50 }],
    ['b.mjs', { moduleScore: 60, worstMethod: 40 }],
    ['c.cjs', { moduleScore: 10, worstMethod: 5 }],
  ]);
  const tiers = new Map([
    [80, 'healthy'],
    [60, 'warning'],
    [10, 'critical'],
  ]);
  const out = analyzeChangedFiles(['a.js', 'b.mjs', 'c.cjs', 'd.md', 'e.txt'], {
    reportFn: (abs) => {
      const key = [...reports.keys()].find((k) => abs.endsWith(k));
      return reports.get(key);
    },
    classifier: (r) => tiers.get(r.moduleScore),
  });
  assert.strictEqual(out.totalFiles, 5);
  assert.strictEqual(out.jsFiles, 3);
  assert.strictEqual(out.maintainability.length, 3);
  assert.strictEqual(out.criticalIssues.length, 1);
  assert.strictEqual(out.warningIssues.length, 1);
});

test('analyzeChangedFiles - drops files where reportFn throws', () => {
  const out = analyzeChangedFiles(['bad.js'], {
    reportFn: () => {
      throw new Error('parse failed');
    },
    classifier: () => 'healthy',
  });
  assert.strictEqual(out.jsFiles, 1);
  assert.strictEqual(out.maintainability.length, 0);
});

test('buildSeverity - composes tally and lint counts', () => {
  const out = buildSeverity(
    { criticalIssues: ['x', 'y'], warningIssues: ['z'] },
    { errors: 3, warnings: 0 },
  );
  assert.deepStrictEqual(out, {
    critical: 2,
    high: 1,
    medium: 1,
    suggestion: 0,
  });
});

test('buildLintLine - error / warning / clean variants', () => {
  assert.match(
    buildLintLine({ errors: 2, warnings: 0 }),
    /Lint Check Failed.*2 error/,
  );
  assert.match(
    buildLintLine({ errors: 0, warnings: 1 }),
    /Passed with Warnings.*1 warning/,
  );
  assert.strictEqual(
    buildLintLine({ errors: 0, warnings: 0 }),
    '✅ **Lint Check Passed**: Workspace is clean.',
  );
});

test('buildReviewReport - assembles the markdown body deterministically', () => {
  const body = buildReviewReport({
    epicId: 7,
    baseBranch: 'main',
    epicBranch: 'epic/7',
    results: {
      totalFiles: 4,
      jsFiles: 3,
      maintainability: [
        {
          file: 'a.js',
          report: { moduleScore: 80, worstMethod: 50 },
          tier: 'healthy',
        },
        {
          file: 'b.js',
          report: { moduleScore: 60, worstMethod: null },
          tier: 'warning',
        },
        {
          file: 'c.js',
          report: { moduleScore: 10, worstMethod: 5 },
          tier: 'critical',
        },
      ],
      criticalIssues: ['🔴 Low Maintainability: `c.js` (worst method 5.0)'],
      warningIssues: ['🟡 Size/Volume Warning: `b.js` (module 60.0)'],
    },
    severity: { critical: 1, high: 0, medium: 1, suggestion: 0 },
    lintLine: '✅ ok',
  });
  assert.match(body, /Epic #7/);
  assert.match(body, /4 files changed \(3 JS files\)/);
  assert.match(body, /🟢 Healthy/);
  assert.match(body, /🟡 Warning/);
  assert.match(body, /🔴 Critical/);
  assert.match(body, /Low Maintainability: `c.js`/);
  assert.match(body, /Size\/Volume Warning: `b.js`/);
  assert.ok(body.endsWith('verify business logic and security constraints._'));
});

test('buildReviewReport - empty issue lists render the green-path lines', () => {
  const body = buildReviewReport({
    epicId: 1,
    baseBranch: 'main',
    epicBranch: 'epic/1',
    results: {
      totalFiles: 0,
      jsFiles: 0,
      maintainability: [],
      criticalIssues: [],
      warningIssues: [],
    },
    severity: { critical: 0, high: 0, medium: 0, suggestion: 0 },
    lintLine: '✅ clean',
  });
  assert.match(body, /No maintainability blockers identified\./);
  assert.match(body, /No size\/volume warnings\./);
});

test('buildReviewReport - parse-error tier emits the warning glyph', () => {
  const body = buildReviewReport({
    epicId: 9,
    baseBranch: 'main',
    epicBranch: 'epic/9',
    results: {
      totalFiles: 1,
      jsFiles: 1,
      maintainability: [
        {
          file: 'broken.js',
          report: { moduleScore: 0, worstMethod: null },
          tier: 'parse-error',
        },
      ],
      criticalIssues: [],
      warningIssues: [],
    },
    severity: { critical: 0, high: 0, medium: 0, suggestion: 0 },
    lintLine: '✅',
  });
  assert.match(body, /⚠️ Parse Error/);
});
