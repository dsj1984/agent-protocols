import assert from 'node:assert';
import { test } from 'node:test';
import {
  parseFreshnessArgs,
  renderFreshnessFailureMessage,
  renderFreshnessLine,
  renderFreshnessSuccessMessage,
  resolveDocList,
  runFreshnessGate,
} from '../.agents/scripts/validate-docs-freshness.js';

test('parseFreshnessArgs: invalid epic id returns null', () => {
  assert.strictEqual(parseFreshnessArgs([]).epicId, null);
  assert.strictEqual(parseFreshnessArgs(['--epic', '0']).epicId, null);
  assert.strictEqual(parseFreshnessArgs(['--epic', 'oops']).epicId, null);
});

test('parseFreshnessArgs: parses --json and --docs comma list', () => {
  const out = parseFreshnessArgs([
    '--epic',
    '7',
    '--json',
    '--docs',
    ' a.md , b.md ,, ',
  ]);
  assert.strictEqual(out.epicId, 7);
  assert.strictEqual(out.json, true);
  assert.deepStrictEqual(out.docsList, ['a.md', 'b.md']);
});

test('parseFreshnessArgs: omits --docs leaves docsList null', () => {
  const out = parseFreshnessArgs(['--epic', '5']);
  assert.strictEqual(out.docsList, null);
  assert.strictEqual(out.json, false);
});

test('renderFreshnessLine: pass + fail variants', () => {
  assert.strictEqual(
    renderFreshnessLine({ pass: true, file: 'a.md', reason: 'commit' }),
    '[docs-freshness] ✅ a.md — commit',
  );
  assert.strictEqual(
    renderFreshnessLine({ pass: false, file: 'b.md', reason: 'no ref' }),
    '[docs-freshness] ❌ b.md — no ref',
  );
});

test('renderFreshnessFailureMessage references epic id twice', () => {
  const msg = renderFreshnessFailureMessage(99);
  assert.match(msg, /FAILED for Epic #99/);
  assert.match(msg, /references #99/);
});

test('renderFreshnessSuccessMessage formats count + epic id', () => {
  assert.strictEqual(
    renderFreshnessSuccessMessage(7, 4),
    '[docs-freshness] ✅ All 4 doc(s) reference Epic #7.',
  );
});

test('resolveDocList merges release.docs and docsContextFiles under paths.docsRoot', () => {
  const docs = resolveDocList({
    release: { docs: ['README.md', 'docs/CHANGELOG.md'] },
    docsContextFiles: ['architecture.md', 'decisions.md'],
    paths: { docsRoot: 'docs' },
  });
  assert.deepStrictEqual(docs, [
    'README.md',
    'docs/CHANGELOG.md',
    'docs/architecture.md',
    'docs/decisions.md',
  ]);
});

test('resolveDocList deduplicates identical entries', () => {
  const docs = resolveDocList({
    release: { docs: ['docs/architecture.md'] },
    docsContextFiles: ['architecture.md'],
    paths: { docsRoot: 'docs' },
  });
  assert.deepStrictEqual(docs, ['docs/architecture.md']);
});

test('resolveDocList returns [] when nothing is configured', () => {
  assert.deepStrictEqual(resolveDocList({}), []);
  assert.deepStrictEqual(resolveDocList({ release: {} }), []);
});

test('runFreshnessGate passes when commit message references the Epic', () => {
  const { ok, results } = runFreshnessGate({
    epicId: 349,
    docs: ['docs/CHANGELOG.md'],
    readFileImpl: () => 'content without epic ref',
    commitsForFile: () => ['abc123'],
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(results[0].pass, true);
  assert.match(results[0].reason, /commit.*#349/);
});

test('runFreshnessGate passes when file body references the Epic', () => {
  const { ok, results } = runFreshnessGate({
    epicId: 349,
    docs: ['docs/CHANGELOG.md'],
    readFileImpl: () => 'Release notes for Epic #349.',
    commitsForFile: () => [],
  });
  assert.strictEqual(ok, true);
  assert.match(results[0].reason, /body.*#349/);
});

test('runFreshnessGate fails when neither commit nor body references the Epic', () => {
  const { ok, results } = runFreshnessGate({
    epicId: 349,
    docs: ['docs/CHANGELOG.md'],
    readFileImpl: () => 'unrelated content',
    commitsForFile: () => [],
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(results[0].pass, false);
  assert.match(results[0].reason, /no commit message or body/);
});

test('runFreshnessGate does not accept #3490 when checking for #349', () => {
  const { ok } = runFreshnessGate({
    epicId: 349,
    docs: ['docs/CHANGELOG.md'],
    readFileImpl: () => 'bumped issue #3490 reference',
    commitsForFile: () => [],
  });
  assert.strictEqual(ok, false);
});

test('runFreshnessGate handles unreadable files without throwing', () => {
  const { ok, results } = runFreshnessGate({
    epicId: 349,
    docs: ['docs/missing.md'],
    readFileImpl: () => {
      throw new Error('ENOENT');
    },
    commitsForFile: () => [],
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(results[0].pass, false);
});

test('runFreshnessGate reports pass + fail rows independently across docs', () => {
  const { ok, results } = runFreshnessGate({
    epicId: 12,
    docs: ['README.md', 'docs/CHANGELOG.md'],
    readFileImpl: (abs) =>
      abs.endsWith('README.md') ? 'mentions #12 explicitly' : 'silent',
    commitsForFile: () => [],
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(results[0].pass, true);
  assert.strictEqual(results[1].pass, false);
});
