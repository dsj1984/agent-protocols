/**
 * tests/scripts/check-gherkin-corpus.test.js — the static Gherkin corpus gate.
 *
 * Every scenario here runs against the **committed** fixture corpus under
 * `tests/fixtures/gherkin-corpus/`, one project root per behaviour, rather
 * than a tmpdir assembled at test time. The gate's whole value is that it runs
 * the real `@cucumber/gherkin` parser over real files; a synthesized corpus
 * would let a fixture drift into a shape the parser never sees.
 *
 * The two fail-closed paths are the ones worth stating plainly, because both
 * are blackouts that a naive implementation reports as a clean run: a scope
 * that resolves zero step definitions (every step would read unbound), and a
 * parser that cannot be resolved (nothing is checked at all).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectActiveSteps,
  expandStepText,
  loadGherkinParser,
  parseArgs,
  renderFinding,
  runCli,
  toParseFindings,
} from '../../.agents/scripts/check-gherkin-corpus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CORPUS = path.join(REPO_ROOT, 'tests', 'fixtures', 'gherkin-corpus');
const SCRIPT = path.join(
  REPO_ROOT,
  '.agents',
  'scripts',
  'check-gherkin-corpus.js',
);

/** Drive the CLI body in-process against one fixture project. */
async function run(fixture) {
  const out = [];
  const err = [];
  const code = await runCli({
    argv: [],
    cwd: path.join(CORPUS, fixture),
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('must-compile', () => {
  it('fails with a file:line:column position for a malformed feature', async () => {
    const { code, stderr } = await run('malformed');
    assert.equal(code, 1);
    assert.match(
      stderr,
      /parse-error features[/\\]broken\.feature:6:3 /,
      `no positioned parse error in:\n${stderr}`,
    );
  });

  it('reports nothing but the parse error for the file that failed it', async () => {
    // A broken file parses as an arbitrary subset of itself, so linting the
    // remainder invents findings that bury the one actionable line.
    const { stderr } = await run('malformed');
    const brokenLines = stderr
      .split('\n')
      .filter((line) => line.includes('broken.feature'));
    assert.equal(brokenLines.length, 1);
    assert.ok(brokenLines[0].includes('parse-error'));
    assert.ok(!stderr.includes('unbound'));
  });

  it('still checks the sound files alongside a broken one', async () => {
    const { stderr } = await run('malformed');
    assert.match(stderr, /across 2 feature file\(s\)/);
    assert.ok(!stderr.includes('sound.feature'));
  });

  it('exits 1 from a real process invocation against the committed corpus', () => {
    const proc = spawnSync(
      process.execPath,
      [SCRIPT, '--cwd', path.join(CORPUS, 'malformed')],
      { encoding: 'utf8', cwd: REPO_ROOT },
    );
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /broken\.feature:6:3/);
  });
});

describe('must-bind, scoped per step root', () => {
  it('names the file, line and text of a step no definition claims', async () => {
    const { code, stderr } = await run('two-scope');
    assert.equal(code, 1);
    assert.match(
      stderr,
      /unbound \[app-a\] app-a[/\\]features[/\\]a\.feature:6 no definition anywhere claims this step/,
    );
  });

  it('reports a step defined only under scope B as unbound in scope A', async () => {
    const { stderr } = await run('two-scope');
    assert.match(
      stderr,
      /unbound \[app-a\] app-a[/\\]features[/\\]a\.feature:5 I open the app-b admin console/,
    );
  });

  it('binds that same step when scope B uses it in its own feature', async () => {
    // Pooling every step root into one matcher list would make this pass by
    // making the assertion above impossible — the cross-app false bind.
    const { stderr } = await run('two-scope');
    assert.ok(
      !stderr.includes('b.feature'),
      `scope B reported a finding it should not have:\n${stderr}`,
    );
    assert.match(stderr, /2 finding\(s\)/);
  });
});

describe('escapes for a false unbound', () => {
  it('exempts a tagged scenario and honours a step waiver', async () => {
    const { code, stdout } = await run('escapes');
    assert.equal(code, 0, 'the escapes corpus should report clean');
    // Two files: the exemption/waiver feature, and a comment-only file that
    // compiles to no Feature node at all — which must be counted and skipped,
    // never crashed on.
    assert.match(stdout, /✅ 2 feature file\(s\) compile and bind/);
  });

  it('does not let an exemption tag escape must-compile', async () => {
    // The malformed fixture's broken scenario carries `@skip`; the parse error
    // in its file must still fail the run.
    const { code, stderr } = await run('malformed');
    assert.equal(code, 1);
    assert.match(stderr, /broken\.feature:6:3/);
  });
});

describe('opt-in', () => {
  it('exits 0 and says so when qa.gherkinLint is absent, despite features on disk', async () => {
    const { code, stdout } = await run('unconfigured');
    assert.equal(code, 0);
    assert.match(stdout, /not configured/);
  });
});

describe('background inheritance', () => {
  it('checks a feature Background whose only scenarios live under a Rule', async () => {
    const { code, stderr } = await run('rule-background');
    assert.equal(code, 1);
    assert.match(stderr, /no definition anywhere claims this background step/);
  });

  it('reports an inherited background step once, not once per container', async () => {
    const { stderr } = await run('rule-background');
    const hits = stderr.match(/claims this background step/g) ?? [];
    assert.equal(hits.length, 1, `duplicated findings:\n${stderr}`);
  });
});

describe('fail-closed inside the opt-in', () => {
  it('refuses a scope whose featureRoots do not exist, naming them', async () => {
    const { code, stderr } = await run('missing-root');
    assert.equal(code, 1);
    assert.match(stderr, /scope "app" names featureRoots that do not exist/);
    assert.match(stderr, /featurez/);
    // It must not report the friendly "nothing to check" line: the corpus is
    // real, the config just cannot see it.
    assert.ok(
      !/nothing to check/.test(stderr),
      `reported a clean run over an unchecked corpus:\n${stderr}`,
    );
  });

  it('refuses a scope that resolves zero step definitions, naming its step roots', async () => {
    const { code, stderr } = await run('blackout');
    assert.equal(code, 1);
    assert.match(stderr, /scope "app" resolved 0 step definitions/);
    assert.match(stderr, /stepRoots: steps/);
    // The whole point: it must NOT emit a per-step unbound finding instead.
    assert.ok(!/\] unbound \[/.test(stderr), `emitted findings:\n${stderr}`);
  });

  it('refuses an unresolvable parser, naming the package and how to install it', async () => {
    const err = [];
    const code = await runCli({
      argv: [],
      cwd: path.join(CORPUS, 'two-scope'),
      stdout: { write: () => {} },
      stderr: { write: (s) => err.push(s) },
      loadParser: async () => {
        throw new Error(
          '@cucumber/gherkin could not be resolved — install it with `npm install --save-dev @cucumber/gherkin`',
        );
      },
    });
    assert.equal(code, 1);
    assert.match(err.join(''), /@cucumber\/gherkin/);
    assert.match(err.join(''), /npm install --save-dev/);
  });

  it('does not require a parser when the configured corpus is empty', async () => {
    let asked = false;
    const out = [];
    const code = await runCli({
      argv: ['--cwd', path.join(CORPUS, 'blackout', 'steps')],
      cwd: REPO_ROOT,
      stdout: { write: (s) => out.push(s) },
      stderr: { write: () => {} },
      loadParser: async () => {
        asked = true;
        throw new Error('should never be reached');
      },
    });
    // No `.agentrc.json` under that directory → the resolver falls back to
    // built-in defaults, which carry no `qa` block at all.
    assert.equal(code, 0);
    assert.equal(asked, false);
    assert.match(out.join(''), /not configured/);
  });
});

describe('parser resolution', () => {
  it('resolves @cucumber/gherkin from the framework anchor and parses', async () => {
    const parser = await loadGherkinParser({ cwd: REPO_ROOT });
    const doc = parser.parse('Feature: F\n  Scenario: S\n    Given a step\n');
    assert.equal(doc.feature.name, 'F');
  });

  it('falls back to the framework anchor when the project has no install', async () => {
    // A consumer project under a non-hoisting linker need not hold a
    // transitive dependency of playwright-bdd; the framework's own install is
    // the second anchor precisely so that case still parses.
    const parser = await loadGherkinParser({
      cwd: path.join(CORPUS, 'unconfigured'),
    });
    assert.equal(parser.parse('Feature: F\n').feature.name, 'F');
  });
});

describe('pure helpers', () => {
  it('parseArgs reads --cwd and ignores a dangling flag', () => {
    assert.deepEqual(parseArgs(['--cwd', '/tmp/x']), { cwd: '/tmp/x' });
    assert.deepEqual(parseArgs(['--cwd']), { cwd: null });
    assert.deepEqual(parseArgs([]), { cwd: null });
  });

  it('toParseFindings flattens a composite exception and defaults its position', () => {
    const composite = {
      errors: [{ message: 'a', location: { line: 3, column: 7 } }],
    };
    assert.deepEqual(toParseFindings(composite, 'f.feature'), [
      {
        kind: 'parse-error',
        file: 'f.feature',
        line: 3,
        column: 7,
        message: 'a',
      },
    ]);
    const bare = toParseFindings(new Error('boom'), 'f.feature');
    assert.equal(bare.length, 1);
    assert.equal(bare[0].line, 1);
    assert.equal(bare[0].column, 1);
  });

  it('expandStepText substitutes every Examples row and passes plain text through', () => {
    assert.deepEqual(expandStepText('a plain step', []), ['a plain step']);
    const examples = [
      {
        tableHeader: { cells: [{ value: 'colour' }] },
        tableBody: [
          { cells: [{ value: 'red' }] },
          { cells: [{ value: 'blue' }] },
        ],
      },
    ];
    assert.deepEqual(expandStepText('I pick <colour>', examples), [
      'I pick red',
      'I pick blue',
    ]);
    // A placeholder with no Examples table falls back to the raw text so the
    // finding still quotes what the author wrote.
    assert.deepEqual(expandStepText('I pick <colour>', []), [
      'I pick <colour>',
    ]);
  });

  it('renderFinding formats both finding kinds on one line each', () => {
    assert.equal(
      renderFinding({
        kind: 'parse-error',
        file: 'a.feature',
        line: 2,
        column: 4,
        message: 'nope',
      }),
      '[gherkin-corpus] parse-error a.feature:2:4 nope',
    );
    assert.equal(
      renderFinding({
        kind: 'unbound',
        file: 'a.feature',
        line: 9,
        text: 'a step',
        scope: 'web',
      }),
      '[gherkin-corpus] unbound [web] a.feature:9 a step',
    );
  });
});

describe('collectActiveSteps', () => {
  const step = (line, text) => ({ location: { line }, text });

  it('drops a scenario carrying an exemption tag', () => {
    const feature = {
      tags: [],
      children: [
        {
          scenario: { tags: [{ name: '@skip' }], steps: [step(3, 'skipped')] },
        },
        { scenario: { tags: [], steps: [step(6, 'kept')] } },
      ],
    };
    assert.deepEqual(
      collectActiveSteps(feature, ['@skip']).map((s) => s.text),
      ['kept'],
    );
  });

  it('drops every scenario when the feature itself is exempt', () => {
    const feature = {
      tags: [{ name: '@wip' }],
      children: [{ scenario: { tags: [], steps: [step(3, 'a')] } }],
    };
    assert.deepEqual(collectActiveSteps(feature, ['@wip']), []);
  });

  it('checks background steps once, but only while a live scenario remains', () => {
    const withLive = {
      tags: [],
      children: [
        { background: { steps: [step(2, 'shared setup')] } },
        { scenario: { tags: [], steps: [step(5, 'a')] } },
        { scenario: { tags: [], steps: [step(8, 'b')] } },
      ],
    };
    assert.deepEqual(
      collectActiveSteps(withLive, []).map((s) => s.text),
      ['shared setup', 'a', 'b'],
    );

    const allExempt = {
      tags: [],
      children: [
        { background: { steps: [step(2, 'shared setup')] } },
        { scenario: { tags: [{ name: '@skip' }], steps: [step(5, 'a')] } },
      ],
    };
    assert.deepEqual(collectActiveSteps(allExempt, ['@skip']), []);
  });

  it('descends into Rule containers and inherits their tags', () => {
    const feature = {
      tags: [],
      children: [
        {
          rule: {
            tags: [{ name: '@skip' }],
            children: [{ scenario: { tags: [], steps: [step(6, 'ruled')] } }],
          },
        },
      ],
    };
    assert.deepEqual(collectActiveSteps(feature, ['@skip']), []);
  });
});
