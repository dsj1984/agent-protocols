/**
 * tests/check-workflow-citations.test.js — the provenance-citation ratchet.
 *
 * Workflow prose is resident context: a `(Story #1234)` aside is charged at
 * the same rate as instruction and teaches the model Mandrel's own history
 * instead of the task. The strip is a one-time edit; without a ratchet the
 * tax re-accumulates one well-meaning aside at a time, which is precisely
 * how it reached 127 in the first place.
 *
 * Two things therefore have to hold, and neither is self-enforcing:
 *
 *   1. The gate FAILS on a rise. A ratchet that only reports is a ratchet
 *      nobody notices.
 *   2. The committed baseline is real — present in this repo and not below
 *      the live corpus, so `npm run lint` is actually enforcing a ceiling
 *      rather than degrading to "no baseline found".
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectMarkdownFiles,
  countCitations,
  diffTally,
  loadBaseline,
  parseArgv,
  renderDiff,
  runCli,
  tallyCitations,
} from '../.agents/scripts/check-workflow-citations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const tempRoots = [];

/** Build a throwaway repo-shaped fixture: `.agents/workflows` + a baseline. */
function makeFixture({ docs = {}, baseline = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-citations-'));
  tempRoots.push(root);
  const workflows = path.join(root, '.agents', 'workflows');
  fs.mkdirSync(workflows, { recursive: true });
  for (const [name, body] of Object.entries(docs)) {
    const full = path.join(workflows, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  if (baseline) {
    fs.mkdirSync(path.join(root, 'baselines'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'baselines', 'workflow-citations.json'),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
  }
  return root;
}

/** Capture stdout/stderr writes for assertion. */
function capture() {
  const chunks = { out: '', err: '' };
  return {
    chunks,
    stdout: {
      write: (s) => {
        chunks.out += s;
      },
    },
    stderr: {
      write: (s) => {
        chunks.err += s;
      },
    },
  };
}

after(() => {
  for (const root of tempRoots)
    fs.rmSync(root, { recursive: true, force: true });
});

describe('countCitations', () => {
  it('counts both the prefixed and the bare spelling of one citation', () => {
    assert.equal(countCitations('see (Story #4593) and also (#4722)'), 2);
  });

  it('ignores markdown headings, anchors, and short numbers', () => {
    assert.equal(countCitations('### Step 3\nsee {#recover} and gate #2'), 0);
  });
});

describe('tallyCitations', () => {
  it('omits clean files and relativizes paths against cwd', () => {
    const root = makeFixture({
      docs: { 'a.md': 'refs #1234 and #5678', 'b.md': 'no citations here' },
    });
    const tally = tallyCitations(
      collectMarkdownFiles(path.join(root, '.agents', 'workflows')),
      root,
    );
    assert.equal(tally.total, 2);
    assert.deepEqual(tally.files, [
      { path: '.agents/workflows/a.md', count: 2 },
    ]);
  });
});

describe('diffTally', () => {
  it('names the file that grew, not just the total', () => {
    const diff = diffTally(
      { total: 1, files: [{ path: 'a.md', count: 1 }] },
      { total: 3, files: [{ path: 'a.md', count: 3 }] },
    );
    assert.equal(diff.delta, 2);
    assert.deepEqual(diff.grew, [{ path: 'a.md', from: 1, to: 3 }]);
  });

  it('reports a null delta when there is no baseline to compare against', () => {
    const diff = diffTally(null, { total: 3, files: [] });
    assert.equal(diff.baselineTotal, null);
    assert.equal(diff.delta, null);
  });
});

describe('renderDiff', () => {
  it('flags shrinkage as a refresh nudge, never as a failure', () => {
    const out = renderDiff(
      { baselineTotal: 5, delta: -2, grew: [] },
      { total: 3 },
    );
    assert.match(out, /below baseline/);
    assert.match(out, /\(ok\)/);
  });
});

describe('parseArgv', () => {
  it('parses every documented flag', () => {
    assert.deepEqual(
      parseArgv(['--baseline', 'b.json', '--root', 'r', '--update', '--json']),
      { baselinePath: 'b.json', rootPath: 'r', update: true, json: true },
    );
  });
});

describe('runCli', () => {
  it('exits 1 when the total rises above the baseline', async () => {
    const root = makeFixture({
      docs: { 'a.md': 'refs #1234 and #5678' },
      baseline: {
        total: 1,
        files: [{ path: '.agents/workflows/a.md', count: 1 }],
      },
    });
    const cap = capture();
    const code = await runCli({ argv: [], cwd: root, ...cap });
    assert.equal(code, 1);
    assert.match(cap.chunks.out, /gate fail/);
    assert.match(cap.chunks.out, /a\.md: 1 -> 2/);
  });

  it('exits 0 at or below the baseline', async () => {
    const root = makeFixture({
      docs: { 'a.md': 'refs #1234' },
      baseline: {
        total: 4,
        files: [{ path: '.agents/workflows/a.md', count: 4 }],
      },
    });
    const cap = capture();
    assert.equal(await runCli({ argv: [], cwd: root, ...cap }), 0);
    assert.match(cap.chunks.out, /total=1 baseline=4/);
  });

  it('degrades to no-ceiling with a warning when the baseline is absent', async () => {
    const root = makeFixture({ docs: { 'a.md': 'refs #1234' } });
    const cap = capture();
    assert.equal(await runCli({ argv: [], cwd: root, ...cap }), 0);
    assert.match(cap.chunks.err, /baseline not found/);
  });

  it('--update writes a baseline the next run passes against', async () => {
    const root = makeFixture({ docs: { 'a.md': 'refs #1234 and #5678' } });
    const cap = capture();
    assert.equal(await runCli({ argv: ['--update'], cwd: root, ...cap }), 0);
    const written = loadBaseline(
      path.join(root, 'baselines', 'workflow-citations.json'),
    );
    assert.equal(written.total, 2);
    assert.equal(await runCli({ argv: [], cwd: root, ...capture() }), 0);
  });

  it('--json emits the machine-readable envelope', async () => {
    const root = makeFixture({
      docs: { 'a.md': 'refs #1234' },
      baseline: {
        total: 1,
        files: [{ path: '.agents/workflows/a.md', count: 1 }],
      },
    });
    const cap = capture();
    await runCli({ argv: ['--json'], cwd: root, ...cap });
    const envelope = JSON.parse(cap.chunks.out);
    assert.equal(envelope.kind, 'workflow-citations-report');
    assert.equal(envelope.total, 1);
    assert.equal(envelope.delta, 0);
  });

  it('throws when the workflow root is missing rather than passing vacuously', async () => {
    const root = makeFixture();
    fs.rmSync(path.join(root, '.agents', 'workflows'), { recursive: true });
    await assert.rejects(
      () => runCli({ argv: [], cwd: root, ...capture() }),
      /workflow root not found/,
    );
  });
});

describe('the committed baseline holds a real ceiling', () => {
  it('exists and is not below the live workflow corpus', async () => {
    const baseline = loadBaseline(
      path.join(REPO_ROOT, 'baselines', 'workflow-citations.json'),
    );
    assert.ok(
      baseline && typeof baseline.total === 'number',
      'baselines/workflow-citations.json must exist — without it `npm run lint` degrades to "no ceiling" and the citation tax re-accumulates unnoticed',
    );
    const cap = capture();
    assert.equal(
      await runCli({ argv: [], cwd: REPO_ROOT, ...cap }),
      0,
      `workflow citations regressed above the recorded baseline:\n${cap.chunks.out}`,
    );
  });
});
