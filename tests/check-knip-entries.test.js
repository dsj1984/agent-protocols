import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runCli } from '../.agents/scripts/check-knip-entries.js';
import {
  __testing,
  countDivergences,
  renderEntrySyncReport,
  resolveEntrySync,
} from '../.agents/scripts/lib/knip-entry-sync.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

/**
 * Unit + invariant coverage for the knip entry-sync gate.
 *
 * The defect this suite exists to prevent (observed live during Story #5012):
 * Story #5001 replaced knip's blanket `.agents/scripts/*.js!` entry glob with
 * an explicit hand-written list and promoted the `files` rule to `error`. A CLI
 * added afterwards is absent from that list, so knip reads it as unreachable,
 * emits a whole-file `{ file, symbol: '*' }` row for it, and marks every lib
 * module only that CLI imports dead too. Accepting the ratchet's diff — the
 * obvious remedy — permanently records live operator CLIs as expected-dead.
 *
 * Modeled on the sibling `check-action-pinning.test.js`: exercise the pure
 * helpers, drive `resolveEntrySync` over fixture trees, then assert the live
 * repository's own invariants.
 */

const {
  buildInvocationPatterns,
  collectInvocationSurfaces,
  readKnipEntries,
  stripJsComments,
} = __testing;

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Build a minimal fixture repository.
 *
 * @param {{
 *   clis: string[],
 *   entry?: string[],
 *   packageJson?: object,
 *   extraFiles?: Record<string, string>,
 * }} spec
 * @returns {string} absolute repo root
 */
function makeFixtureRepo({ clis, entry, packageJson, extraFiles = {} }) {
  const root = makeTempDir('knip-entry-');
  const scriptsDir = path.join(root, '.agents', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const cli of clis) {
    fs.writeFileSync(path.join(scriptsDir, cli), `// ${cli}\n`);
  }
  fs.writeFileSync(
    path.join(root, 'knip.json'),
    JSON.stringify({
      entry: (entry ?? clis).map((c) => `.agents/scripts/${c}!`),
    }),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(packageJson ?? { scripts: {} }),
  );
  for (const [rel, body] of Object.entries(extraFiles)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

// --- pure helpers -----------------------------------------------------------

test('stripJsComments: blanks line and block comments, preserving line count', () => {
  const src = [
    'const a = 1; // trailing',
    '/* block',
    ' * body',
    ' */',
    'b()',
  ].join('\n');
  const out = stripJsComments(src);
  assert.match(out, /const a = 1;/);
  assert.ok(!out.includes('trailing'));
  assert.ok(!out.includes('body'));
  assert.equal(out.split('\n').length, src.split('\n').length);
});

test('stripJsComments: does not mangle // inside string or template literals', () => {
  const src = `const u = 'https://example.com/x'; const t = \`a//b\`; // gone`;
  const out = stripJsComments(src);
  assert.match(out, /https:\/\/example\.com\/x/);
  assert.match(out, /a\/\/b/);
  assert.ok(!out.includes('gone'));
});

test('buildInvocationPatterns: pathLiteral matches both separator styles', () => {
  const { pathLiteral } = buildInvocationPatterns('foo.js');
  assert.ok(pathLiteral.test('node .agents/scripts/foo.js --flag'));
  assert.ok(pathLiteral.test('node .agents\\scripts\\foo.js'));
  assert.ok(!pathLiteral.test('node .agents/scripts/foo-bar.js'));
});

test('buildInvocationPatterns: joinedSpawn requires the "scripts" sibling argument', () => {
  const { joinedSpawn } = buildInvocationPatterns('foo.js');
  assert.ok(joinedSpawn.test(`path.join(root, 'scripts', 'foo.js')`));
  assert.ok(
    joinedSpawn.test(`path.join(\n  root,\n  'scripts',\n  'foo.js',\n)`),
  );
  // A bare catalogue entry — the shape of source-classifier's basename
  // inventory — is a list of names, not a call.
  assert.ok(!joinedSpawn.test(`const NAMES = ['bar.js', 'foo.js'];`));
});

test('readKnipEntries: reads explicit top-level entries and ignores globs', () => {
  const root = makeFixtureRepo({ clis: ['a.js'] });
  fs.writeFileSync(
    path.join(root, 'knip.json'),
    JSON.stringify({
      entry: [
        'bin/*.js!',
        '.agents/scripts/a.js!',
        '.agents/scripts/*.js!',
        '.agents/scripts/**/__tests__/**/*.test.js',
        '.agents/scripts/lib/nested.js!',
      ],
    }),
  );
  const { entries, error } = readKnipEntries({ repoRoot: root });
  assert.equal(error, null);
  assert.deepEqual(entries, ['a.js']);
});

test('readKnipEntries: reports an entry declared without the `!` production marker', () => {
  const root = makeFixtureRepo({ clis: ['a.js', 'b.js'] });
  fs.writeFileSync(
    path.join(root, 'knip.json'),
    JSON.stringify({
      entry: ['.agents/scripts/a.js!', '.agents/scripts/b.js'],
    }),
  );
  const { entries, unsuffixed, error } = readKnipEntries({ repoRoot: root });
  assert.equal(error, null);
  // Still declared — the CLI is named — but knip's production pass negates it.
  assert.deepEqual(entries, ['a.js', 'b.js']);
  assert.deepEqual(unsuffixed, ['b.js']);
});

test('resolveEntrySync: an unsuffixed entry is a divergence, not a satisfied one', () => {
  const root = makeFixtureRepo({ clis: ['a.js'] });
  fs.writeFileSync(
    path.join(root, 'knip.json'),
    JSON.stringify({ entry: ['.agents/scripts/a.js'] }),
  );
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(report.unsuffixed, ['a.js']);
  // The gate must fail: reading it as declared points the operator away from
  // the cause, and accepting the dead-exports diff would then record a live
  // CLI as expected-dead (Story #5012).
  assert.ok(countDivergences(report) > 0);
  assert.match(renderEntrySyncReport(report), /without a "!" suffix/);
});

test('readKnipEntries: reports an unreadable or entry-less config as an error', () => {
  const root = makeTempDir('knip-entry-bad-');
  assert.match(
    readKnipEntries({ repoRoot: root }).error,
    /cannot read knip\.json/,
  );
  fs.writeFileSync(path.join(root, 'knip.json'), JSON.stringify({}));
  assert.match(readKnipEntries({ repoRoot: root }).error, /no "entry" array/);
});

// --- the regression the gate exists for -------------------------------------

test('REGRESSION: a newly-added, invoked CLI absent from knip entry is reported missing', () => {
  // Exactly the Story #5012 shape: the CLI is real, wired into package.json and
  // CI, and simply not yet listed in knip.json. Without this gate knip calls it
  // unreachable and check-dead-exports offers a whole-file dead row for it.
  const root = makeFixtureRepo({
    clis: ['existing.js', 'brand-new.js'],
    entry: ['existing.js'],
    packageJson: {
      scripts: {
        existing: 'node .agents/scripts/existing.js',
        'check:new': 'node .agents/scripts/brand-new.js',
      },
    },
    extraFiles: {
      '.github/workflows/ci.yml':
        'jobs:\n  b:\n    steps:\n      - run: node .agents/scripts/brand-new.js\n',
    },
  });

  const report = resolveEntrySync({ repoRoot: root });
  assert.equal(report.error, null);
  assert.deepEqual(
    report.missing.map((m) => m.cli),
    ['brand-new.js'],
    'a new CLI that something invokes must be flagged before knip can call it dead',
  );
  assert.deepEqual(report.missing[0].invokers.sort(), [
    '.github/workflows/ci.yml',
    'package.json',
  ]);
  assert.deepEqual(report.stale, []);

  // And the remedy the operator is told to apply must actually clear it —
  // adding the entry, NOT accepting a dead-exports diff.
  const rendered = renderEntrySyncReport(report);
  assert.match(
    rendered,
    /add "\.agents\/scripts\/brand-new\.js!" to knip\.json/,
  );
  assert.match(rendered, /\(gate fail\)/);

  fs.writeFileSync(
    path.join(root, 'knip.json'),
    JSON.stringify({
      entry: ['.agents/scripts/existing.js!', '.agents/scripts/brand-new.js!'],
    }),
  );
  const after = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(after.missing, []);
  assert.deepEqual(after.stale, []);
  assert.deepEqual(after.phantom, []);
  assert.match(renderEntrySyncReport(after), /\(ok\)/);
});

test('a CLI declared in entry that nothing invokes is reported stale', () => {
  // The blind spot #5001 closed: a declared entry point is immortal, so its
  // death can never surface. An entry outliving its last caller restores it.
  const root = makeFixtureRepo({
    clis: ['live.js', 'orphaned.js'],
    packageJson: { scripts: { live: 'node .agents/scripts/live.js' } },
  });
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(report.stale, ['orphaned.js']);
  assert.deepEqual(report.missing, []);
  assert.match(renderEntrySyncReport(report), /nothing invokes it/);
});

test('an entry whose file is gone is reported phantom', () => {
  const root = makeFixtureRepo({
    clis: ['live.js'],
    entry: ['live.js', 'renamed-away.js'],
    packageJson: { scripts: { live: 'node .agents/scripts/live.js' } },
  });
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(report.phantom, ['renamed-away.js']);
});

// --- what does and does not confer liveness ---------------------------------

test('documentation prose does not make an uninvoked CLI live', () => {
  // Four CLIs are named only in docs today; #5001 recorded all four as
  // whole-file dead on purpose. Counting prose would silently resurrect them.
  const root = makeFixtureRepo({
    clis: ['operator-tool.js'],
    entry: [],
    extraFiles: {
      'docs/onboarding.md':
        'Run `node .agents/scripts/operator-tool.js` by hand.\n',
      '.agents/docs/quality-gates.md':
        'The operator-run replacement is `node .agents/scripts/operator-tool.js`.\n',
    },
  });
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(report.missing, [], 'prose is not a caller');
  assert.deepEqual(report.stale, []);
});

test('a comment naming a CLI does not make it live, but a real spawn does', () => {
  const root = makeFixtureRepo({
    clis: ['mentioned.js', 'spawned.js'],
    entry: ['spawned.js'],
    extraFiles: {
      '.agents/scripts/lib/notes.js': [
        '/**',
        ' * Superseded by `node .agents/scripts/mentioned.js` (Story #1).',
        ' */',
        "const script = path.join(root, 'scripts', 'spawned.js');",
        'spawnSync(process.execPath, [script]);',
      ].join('\n'),
    },
  });
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(
    report.missing,
    [],
    'a JSDoc mention must not confer liveness',
  );
  assert.deepEqual(report.stale, [], 'a path.join spawn must confer liveness');
});

test('a CLI reachable only by import is neither missing nor stale', () => {
  // `cleanup-repo-test-temp.js` is imported by run-tests.js, so knip already
  // reaches it through the module graph; declaring it an entry would be wrong.
  const root = makeFixtureRepo({
    clis: ['runner.js', 'helper.js'],
    entry: ['runner.js'],
    packageJson: { scripts: { t: 'node .agents/scripts/runner.js' } },
  });
  fs.writeFileSync(
    path.join(root, '.agents', 'scripts', 'runner.js'),
    "import { help } from './helper.js';\nhelp();\n",
  );
  const report = resolveEntrySync({ repoRoot: root });
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.stale, []);
});

test('collectInvocationSurfaces: excludes test files from the invoked set', () => {
  const root = makeFixtureRepo({
    clis: ['only-tested.js'],
    entry: [],
    extraFiles: {
      '.agents/scripts/__tests__/only-tested.test.js':
        "spawnSync('node', ['.agents/scripts/only-tested.js']);\n",
    },
  });
  const surfaces = collectInvocationSurfaces({ repoRoot: root });
  assert.ok(!surfaces.some((s) => s.path.includes('__tests__')));
  assert.deepEqual(resolveEntrySync({ repoRoot: root }).missing, []);
});

// --- CLI exit codes ---------------------------------------------------------

test('runCli: exits 0 clean, 1 on divergence, 2 when it cannot run', async () => {
  const sink = () => ({
    out: '',
    write(s) {
      this.out += s;
    },
  });

  const clean = makeFixtureRepo({
    clis: ['a.js'],
    packageJson: { scripts: { a: 'node .agents/scripts/a.js' } },
  });
  assert.equal(
    await runCli({ argv: ['--cwd', clean], stdout: sink(), stderr: sink() }),
    0,
  );

  const diverged = makeFixtureRepo({
    clis: ['a.js'],
    entry: [],
    packageJson: { scripts: { a: 'node .agents/scripts/a.js' } },
  });
  assert.equal(
    await runCli({ argv: ['--cwd', diverged], stdout: sink(), stderr: sink() }),
    1,
  );

  const broken = makeTempDir('knip-entry-empty-');
  assert.equal(
    await runCli({ argv: ['--cwd', broken], stdout: sink(), stderr: sink() }),
    2,
  );

  const badFlag = sink();
  assert.equal(
    await runCli({ argv: ['--nope'], stdout: sink(), stderr: badFlag }),
    2,
  );
  assert.match(badFlag.out, /unknown flag/);
});

test('runCli: --json emits the machine-readable report', async () => {
  const root = makeFixtureRepo({
    clis: ['a.js'],
    entry: [],
    packageJson: { scripts: { a: 'node .agents/scripts/a.js' } },
  });
  const stdout = {
    out: '',
    write(s) {
      this.out += s;
    },
  };
  const code = await runCli({
    argv: ['--cwd', root, '--json'],
    stdout,
    stderr: { write() {} },
  });
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout.out);
  assert.equal(parsed.kind, 'knip-entry-sync');
  assert.deepEqual(
    parsed.missing.map((m) => m.cli),
    ['a.js'],
  );
});

// --- live-repository invariants ---------------------------------------------

test('INVARIANT: this repository\u2019s knip entry list matches its invoked CLI set', () => {
  const report = resolveEntrySync({ repoRoot: REPO_ROOT });
  assert.equal(report.error, null);
  assert.deepEqual(
    report.missing.map((m) => m.cli),
    [],
    'a CLI under .agents/scripts/ is invoked but missing from knip.json "entry" — ' +
      'add it, or knip reads it as unreachable and check-dead-exports will offer ' +
      'a false whole-file dead row for it and its private lib modules (Story #5012)',
  );
  assert.deepEqual(
    report.stale,
    [],
    'a knip.json "entry" is invoked by nothing — remove it so its death can ' +
      'surface, or wire up the caller (Story #5001)',
  );
  assert.deepEqual(
    report.phantom,
    [],
    'a knip.json "entry" names a file that is gone',
  );
});

test('INVARIANT: no entry-declared CLI is also recorded as a whole-file dead row', () => {
  // The two artifacts must stay disjoint by construction. A CLI appearing in
  // both is precisely the poisoning #5012 nearly committed: declared live to
  // knip, yet recorded as expected-dead in the ratchet's own baseline.
  const { entries } = readKnipEntries({ repoRoot: REPO_ROOT });
  const declared = new Set(entries);
  for (const baseline of [
    'baselines/dead-exports.json',
    'baselines/dead-exports-production.json',
  ]) {
    const { rows } = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, baseline), 'utf8'),
    );
    const contradictions = rows
      .filter((r) => r.symbol === '*')
      .map((r) => r.file)
      .filter((f) => /^\.agents\/scripts\/[^/]+\.js$/.test(f))
      .filter((f) => declared.has(f.slice('.agents/scripts/'.length)));
    assert.deepEqual(
      contradictions,
      [],
      `${baseline} records a whole-file dead row for a CLI that knip.json ` +
        'declares as an entry point — one of the two is a lie',
    );
  }
});
