import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  checkFile,
  DEFAULT_SCAN_ROOTS,
  discoverMarkdown,
  escapesPayload,
  extractLinks,
  extractSlashTokens,
  maskCodeRegions,
  parseArgs,
  RETIRED_COMMANDS,
  runCheck,
  SLASH_ALLOWLIST,
} from '../.agents/scripts/check-doc-links.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

/**
 * Unit coverage for the doc-links / slash-command resolver.
 *
 * Strategy: build a minimal fake repo in tmpdir with a `docs/` tree, a
 * `.agents/` tree, and a `.agents/workflows/` directory, then drive
 * `runCheck` with that repo root. Three required scenarios live below
 * (passing fixture, broken relative link, retired token); a handful of
 * additional helper-level tests pin the masking and tokenizer behaviour.
 */

function makeFakeRepo() {
  const root = makeTempDir('check-doc-links-');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'workflows'), { recursive: true });
  // Seed two workflow files so /plan and /deliver resolve.
  fs.writeFileSync(
    path.join(root, '.agents', 'workflows', 'plan.md'),
    '# plan\n',
  );
  fs.writeFileSync(
    path.join(root, '.agents', 'workflows', 'deliver.md'),
    '# deliver\n',
  );
  return root;
}

function write(root, relPath, body) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

test('runCheck (a) passing fixture: clean tree exits 0 with zero violations', () => {
  const root = makeFakeRepo();
  // A doc with a valid relative link, a valid slash command, an allowlisted
  // token, an external URL, and a pure anchor — all should pass.
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' +
      'See [the spec](spec.md) and run [/plan](../.agents/workflows/plan.md).\n\n' +
      'Visit https://example.com/issues/1 for context, store scratch in /temp/.\n\n' +
      'Jump to [later](#later).\n\n' +
      '## later\n',
  );
  write(root, 'docs/spec.md', '# Spec\n');
  // CHANGELOG.md is excluded even when malformed.
  write(root, 'docs/CHANGELOG.md', '[dangling](./nope.md)\n');

  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(
    result.exitCode,
    0,
    `unexpected violations: ${JSON.stringify(result.violations, null, 2)}`,
  );
  assert.equal(result.violations.length, 0);
  assert.ok(result.scanned >= 2);
});

test('runCheck (b) broken relative link: exits non-zero and names the file:line', () => {
  const root = makeFakeRepo();
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' + 'Line two has [a bad link](./nope.md).\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(result.exitCode, 1);
  const v = result.violations.find((x) => x.kind === 'broken-link');
  assert.ok(
    v,
    `expected broken-link violation; got ${JSON.stringify(result.violations)}`,
  );
  assert.equal(v.file, 'docs/intro.md');
  assert.equal(v.line, 3);
  assert.match(v.message, /nope\.md/);
});

test('runCheck (c) retired /agents-bootstrap-github token: exits non-zero and names file:line', () => {
  const root = makeFakeRepo();
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' + 'Do not run /agents-bootstrap-github any more.\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(result.exitCode, 1);
  const v = result.violations.find((x) => x.kind === 'retired-command');
  assert.ok(
    v,
    `expected retired-command violation; got ${JSON.stringify(result.violations)}`,
  );
  assert.equal(v.file, 'docs/intro.md');
  assert.equal(v.line, 3);
  assert.match(v.message, /agents-bootstrap-github/);
});

test('runCheck: unknown slash command surfaces a violation when no allowlist hit', () => {
  const root = makeFakeRepo();
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' + 'Try /not-a-real-command for fun.\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(result.exitCode, 1);
  const v = result.violations.find((x) => x.kind === 'unknown-command');
  assert.ok(v);
  assert.equal(v.file, 'docs/intro.md');
  assert.equal(v.line, 3);
  assert.match(v.message, /not-a-real-command/);
});

test('runCheck: namespaced /loops:<name> resolves to workflows/loops/<name>.md', () => {
  const root = makeFakeRepo();
  fs.mkdirSync(path.join(root, '.agents', 'workflows', 'loops'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, '.agents', 'workflows', 'loops', 'fix-failing-tests.md'),
    '# loop\n',
  );
  write(
    root,
    'docs/intro.md',
    '# Intro\n\nRun /loops:fix-failing-tests to converge.\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(
    result.exitCode,
    0,
    `unexpected violations: ${JSON.stringify(result.violations)}`,
  );
});

test('runCheck: namespaced /loops:<name> with no unit surfaces a violation', () => {
  const root = makeFakeRepo();
  write(root, 'docs/intro.md', '# Intro\n\nRun /loops:missing now.\n');
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(result.exitCode, 1);
  const v = result.violations.find((x) => x.kind === 'unknown-command');
  assert.ok(v);
  assert.match(v.message, /loops:missing/);
  assert.match(v.message, /loops\/missing\.md/);
});

test('extractSlashTokens: captures the namespaced loops:<name> form whole', () => {
  const tokens = extractSlashTokens(
    maskCodeRegions('see /loops:watch-ci and /plan\n'),
  );
  const names = tokens.map((t) => t.token);
  assert.deepEqual(names, ['loops:watch-ci', 'plan']);
});

test('runCheck: tokens inside fenced code blocks are ignored', () => {
  const root = makeFakeRepo();
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' +
      '```bash\n' +
      '/not-a-real-command\n' +
      '/agents-bootstrap-github\n' +
      '```\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(
    result.exitCode,
    0,
    `unexpected violations: ${JSON.stringify(result.violations)}`,
  );
});

test('runCheck: links inside inline code spans are ignored', () => {
  const root = makeFakeRepo();
  write(
    root,
    'docs/intro.md',
    '# Intro\n\n' + 'Inline `[bad](./nope.md)` should not be checked.\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['docs', '.agents'] });
  assert.equal(result.exitCode, 0);
});

test('maskCodeRegions: zeroes fenced regions and inline spans while preserving line count', () => {
  const src = 'a\n```\nbad /token\n```\nb `inline /token` c\n';
  const masked = maskCodeRegions(src);
  // Same number of newlines preserved
  assert.equal(masked.split('\n').length, src.split('\n').length);
  assert.equal(masked.includes('bad /token'), false);
  assert.equal(masked.includes('inline /token'), false);
});

test('extractLinks: returns target + line for inline markdown links', () => {
  const src = '# H\n\nSee [x](./y.md) and [z](http://example.com).\n';
  const links = extractLinks(maskCodeRegions(src));
  assert.equal(links.length, 2);
  assert.equal(links[0].target, './y.md');
  assert.equal(links[0].line, 3);
  assert.equal(links[1].target, 'http://example.com');
});

test('extractSlashTokens: ignores tokens prefixed by word chars or colons (URL paths)', () => {
  const src = 'visit https://example.com/foo and /bar but not text/bar\n';
  const tokens = extractSlashTokens(maskCodeRegions(src));
  const names = tokens.map((t) => t.token);
  assert.deepEqual(names, ['bar']);
});

test('discoverMarkdown: skips docs/CHANGELOG.md', () => {
  const root = makeFakeRepo();
  write(root, 'docs/keep.md', '# keep\n');
  write(root, 'docs/CHANGELOG.md', '# changelog\n');
  const files = discoverMarkdown(root, ['docs']);
  const rels = files.map((f) =>
    path.relative(root, f).split(path.sep).join('/'),
  );
  assert.ok(rels.includes('docs/keep.md'));
  assert.equal(rels.includes('docs/CHANGELOG.md'), false);
});

test('checkFile: anchor-only and protocol-relative targets are skipped', () => {
  const root = makeFakeRepo();
  const abs = write(root, 'docs/intro.md', '[a](#x) and [b](//example.com)\n');
  const v = checkFile(abs, root);
  assert.equal(v.length, 0);
});

test('static constants: retired blocklist seeded with agents-bootstrap-github; allowlist includes /temp/', () => {
  assert.ok(RETIRED_COMMANDS.has('agents-bootstrap-github'));
  assert.ok(SLASH_ALLOWLIST.has('temp'));
});

test('static constants: retired blocklist includes /mandrel (retired for generated workflows.md)', () => {
  assert.ok(RETIRED_COMMANDS.has('mandrel'));
});

// --- Payload boundary (Story #4801) ----------------------------------------

test('payload-boundary: an .agents/** link to a framework-only path is a violation even though the target exists', () => {
  const root = makeFakeRepo();
  write(root, 'tests/diagnose-output.test.js', '// real file\n');
  const abs = write(
    root,
    '.agents/workflows/helpers/diagnose.md',
    '# diagnose\n\nSee [the test](../../../tests/diagnose-output.test.js).\n',
  );
  const v = checkFile(abs, root);
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, 'payload-boundary');
  assert.notEqual(v[0].kind, 'broken-link');
  assert.match(v[0].message, /materialized/);
  assert.match(v[0].message, /\.agents\//);
});

test('payload-boundary: a packaged-but-unmaterialized lib/ target still violates (package.json#files would have missed it)', () => {
  const root = makeFakeRepo();
  write(
    root,
    'lib/cli/update.js',
    '// shipped in the tarball, not to the repo root\n',
  );
  const abs = write(
    root,
    '.agents/workflows/mandrel-update.md',
    '# update\n\nOwned by [`lib/cli/update.js`](../../lib/cli/update.js).\n',
  );
  const v = checkFile(abs, root);
  assert.equal(v.length, 1);
  assert.equal(v[0].kind, 'payload-boundary');
});

test('payload-boundary: the rule is scoped to .agents/** sources — a docs/** link to the same path is clean', () => {
  const root = makeFakeRepo();
  write(root, 'tests/diagnose-output.test.js', '// real file\n');
  const abs = write(
    root,
    'docs/notes.md',
    '# notes\n\nSee [the test](../tests/diagnose-output.test.js).\n',
  );
  const v = checkFile(abs, root);
  assert.equal(v.length, 0);
});

test('payload-boundary: consumer-owned escapes are allowed from .agents/**', () => {
  const root = makeFakeRepo();
  write(root, 'package.json', '{}\n');
  write(root, '.agentrc.json', '{}\n');
  write(root, 'baselines/coverage.json', '{}\n');
  write(root, 'docs/architecture.md', '# arch\n');
  const abs = write(
    root,
    '.agents/docs/quality-gates.md',
    '# gates\n\n' +
      'See [pkg](../../package.json), [rc](../../.agentrc.json),\n' +
      '[cov](../../baselines/coverage.json) and [arch](../../docs/architecture.md).\n',
  );
  const v = checkFile(abs, root);
  assert.deepEqual(v, []);
});

test('payload-boundary: links that stay inside .agents/ are clean', () => {
  const root = makeFakeRepo();
  const abs = write(
    root,
    '.agents/workflows/deliver.md',
    '# deliver\n\nSee [plan](plan.md).\n',
  );
  const v = checkFile(abs, root);
  assert.deepEqual(v, []);
});

test('escapesPayload: unit contract for source scoping and the allowlist', () => {
  assert.equal(
    escapesPayload('.agents/workflows/a.md', 'tests/x.test.js'),
    true,
  );
  assert.equal(
    escapesPayload('.agents/workflows/a.md', 'lib/cli/update.js'),
    true,
  );
  assert.equal(
    escapesPayload('.agents/workflows/a.md', '.agents/docs/b.md'),
    false,
  );
  assert.equal(escapesPayload('.agents/workflows/a.md', 'package.json'), false);
  assert.equal(
    escapesPayload('.agents/workflows/a.md', 'baselines/crap.json'),
    false,
  );
  // docs/** is framework-repo-only and keeps existence-only semantics.
  assert.equal(escapesPayload('docs/notes.md', 'tests/x.test.js'), false);
});

test('runCheck: a consumer-shaped tree (only .agents/) scans clean', () => {
  const root = makeTempDir('check-doc-links-consumer-');
  fs.mkdirSync(path.join(root, '.agents', 'workflows'), { recursive: true });
  write(root, '.agents/workflows/plan.md', '# plan\n');
  write(
    root,
    '.agents/workflows/deliver.md',
    '# deliver\n\nRun [/plan](plan.md); see the harness docs at\n' +
      '[update](https://github.com/dsj1984/mandrel/blob/main/lib/cli/update.js).\n',
  );
  const result = runCheck({ repoRoot: root, scanRoots: ['.agents'] });
  assert.deepEqual(result.violations, []);
  assert.equal(result.exitCode, 0);
});

// --- CLI scoping flags (Story #4801) ---------------------------------------

test('discoverMarkdown: --exclude globs drop matching files from the scan', () => {
  const root = makeFakeRepo();
  write(root, 'docs/keep.md', '# keep\n');
  write(root, 'docs/drafts/skip.md', '# skip\n');
  const all = discoverMarkdown(root, ['docs']).map((f) =>
    path.relative(root, f).split(path.sep).join('/'),
  );
  assert.ok(all.includes('docs/drafts/skip.md'));
  const filtered = discoverMarkdown(root, ['docs'], ['docs/drafts/**']).map(
    (f) => path.relative(root, f).split(path.sep).join('/'),
  );
  assert.ok(filtered.includes('docs/keep.md'));
  assert.equal(filtered.includes('docs/drafts/skip.md'), false);
});

test('parseArgs: no flags reproduces the pre-#4801 defaults', () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed.scanRoots, [...DEFAULT_SCAN_ROOTS]);
  assert.deepEqual(parsed.exclude, []);
});

test('parseArgs: --scan-root and --exclude are repeatable and --scan-root replaces the defaults', () => {
  const parsed = parseArgs([
    '--scan-root',
    '.agents',
    '--scan-root',
    'handbook',
    '--exclude',
    '**/archive/**',
    '--exclude',
    '**/tmp/**',
  ]);
  assert.deepEqual(parsed.scanRoots, ['.agents', 'handbook']);
  assert.deepEqual(parsed.exclude, ['**/archive/**', '**/tmp/**']);
});
