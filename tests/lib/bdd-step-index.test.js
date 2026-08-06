/**
 * tests/lib/bdd-step-index.test.js — the matching half of the corpus gate.
 *
 * The parser half of `check-gherkin-corpus.js` is exact (it runs
 * `@cucumber/gherkin`), so nothing here needs to re-prove Gherkin. This half is
 * a source scan and therefore heuristic, which makes its failure directions
 * asymmetric: over-matching costs a missed finding, under-matching costs a
 * false one that blocks a delivery. These tests pin both directions —
 * especially that word alternation stays inside its word, the trap that turns
 * `I have a/an apple` into two anchored alternatives neither of which is the
 * intended step.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildStepIndex,
  expressionToRegExp,
  listStepFiles,
  matchStep,
  parseStepDefinitions,
} from '../../.agents/scripts/lib/bdd-step-index.js';

const makeTmpDir = () =>
  mkdtempSync(path.join(tmpdir(), 'mandrel-bdd-step-index-'));

describe('expressionToRegExp', () => {
  it('matches literal text exactly and anchored', () => {
    const re = expressionToRegExp('I am on the dashboard');
    assert.ok(re.test('I am on the dashboard'));
    assert.ok(!re.test('I am on the dashboard twice'));
    assert.ok(!re.test('before I am on the dashboard'));
  });

  it('escapes regex metacharacters in literal text', () => {
    // `(` is NOT escaped here — in a Cucumber expression it opens an optional
    // run, which the optional-group test below pins. Everything else must be
    // literal, so `.` may not silently become a wildcard.
    const re = expressionToRegExp('the price is $1.50 [net] +tax');
    assert.ok(re.test('the price is $1.50 [net] +tax'));
    assert.ok(!re.test('the price is $1x50 [net] +tax'));
  });

  it('renders the built-in parameter types as capture groups', () => {
    assert.ok(expressionToRegExp('I have {int} cukes').test('I have 42 cukes'));
    assert.ok(expressionToRegExp('I have {int} cukes').test('I have -7 cukes'));
    assert.ok(!expressionToRegExp('I have {int} cukes').test('I have x cukes'));
    assert.ok(expressionToRegExp('I wait {float}s').test('I wait 1.5s'));
    assert.ok(expressionToRegExp('I press {word}').test('I press Enter'));
    assert.ok(!expressionToRegExp('I press {word}').test('I press two words'));
    assert.ok(expressionToRegExp('I type {string}').test('I type "hello"'));
    assert.ok(expressionToRegExp('I see {}').test('I see whatever I like'));
  });

  it('degrades an unresolvable custom parameter type to a wildcard', () => {
    // Over-matching costs a missed finding; under-matching costs a FALSE
    // finding that blocks a delivery. The heuristic must fail the first way.
    const re = expressionToRegExp('I sign in as {persona}');
    assert.ok(re.test('I sign in as an org admin'));
  });

  it('keeps alternation inside its own word', () => {
    const re = expressionToRegExp('I have a/an apple');
    assert.ok(re.test('I have a apple'));
    assert.ok(re.test('I have an apple'));
    // The bug this pins: a top-level `|` would make `^I have a` a whole
    // alternative, so this unrelated text would match.
    assert.ok(!re.test('I have a'));
    assert.ok(!re.test('an apple'));
  });

  it('renders a parenthesised run as optional', () => {
    const re = expressionToRegExp('I add {int} item(s)');
    assert.ok(re.test('I add 1 item'));
    assert.ok(re.test('I add 3 items'));
  });

  it('treats an escaped brace or slash as literal', () => {
    assert.ok(
      expressionToRegExp('a \\{literal} brace').test('a {literal} brace'),
    );
    assert.ok(expressionToRegExp('either\\/or').test('either/or'));
  });

  it('preserves multi-space runs rather than collapsing them', () => {
    const re = expressionToRegExp('two  spaces');
    assert.ok(re.test('two  spaces'));
    assert.ok(!re.test('two spaces'));
  });
});

describe('parseStepDefinitions', () => {
  it('extracts every registrar keyword with its line number', () => {
    const source = [
      "Given('a first step', noop);",
      'When("a second step", noop);',
      'Then(`a third step`, noop);',
      "And('a fourth step', noop);",
      "But('a fifth step', noop);",
      "Step('a sixth step', noop);",
      "defineStep('a seventh step', noop);",
    ].join('\n');
    const entries = parseStepDefinitions(source, '/steps/a.js');
    assert.equal(entries.length, 7);
    assert.deepEqual(
      entries.map((e) => e.line),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.equal(entries[0].file, '/steps/a.js');
  });

  it('compiles a regular-expression literal, stripping stateful flags', () => {
    const entries = parseStepDefinitions(
      'Given(/^I have (\\d+) cukes$/gi, noop);',
      '/steps/a.js',
    );
    assert.equal(entries.length, 1);
    // `g` makes `.test()` stateful — consulting the index twice would then
    // return different answers for the same step.
    assert.ok(!entries[0].regex.flags.includes('g'));
    assert.ok(entries[0].regex.test('I have 3 cukes'));
    assert.ok(entries[0].regex.test('i HAVE 3 CUKES'));
  });

  it('skips a definition whose regular expression will not compile', () => {
    const entries = parseStepDefinitions('Given(/[unclosed/, noop);', '/a.js');
    assert.deepEqual(entries, []);
  });

  it('ignores calls that are not step registrations', () => {
    const source = "describe('a suite', () => {});\nit('a case', () => {});";
    assert.deepEqual(parseStepDefinitions(source, '/a.js'), []);
  });
});

describe('listStepFiles', () => {
  it('walks recursively, honours the extension set, and skips vendor dirs', () => {
    const root = makeTmpDir();
    mkdirSync(path.join(root, 'nested'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    writeFileSync(path.join(root, 'a.steps.js'), '');
    writeFileSync(path.join(root, 'nested', 'b.steps.ts'), '');
    writeFileSync(path.join(root, 'notes.md'), '');
    writeFileSync(path.join(root, 'node_modules', 'vendor.js'), '');

    const found = listStepFiles([root]).map((f) => path.relative(root, f));
    assert.deepEqual(found, ['a.steps.js', path.join('nested', 'b.steps.ts')]);
  });

  it('returns an empty list for a missing root rather than throwing', () => {
    assert.deepEqual(listStepFiles(['/definitely/not/here']), []);
    assert.deepEqual(listStepFiles(undefined), []);
  });
});

describe('buildStepIndex / matchStep', () => {
  it('indexes every readable file and resolves a step to its definition', () => {
    const readFile = (p) =>
      p === '/a.js'
        ? "Given('I am signed in', noop);"
        : "Then('I see {int} results', noop);";
    const index = buildStepIndex({ files: ['/a.js', '/b.js'], readFile });
    assert.equal(index.entries.length, 2);
    assert.equal(matchStep(index, 'I am signed in').file, '/a.js');
    assert.equal(matchStep(index, 'I see 12 results').file, '/b.js');
    assert.equal(matchStep(index, 'I see nothing at all'), null);
  });

  it('skips an unreadable file instead of aborting the scan', () => {
    const readFile = (p) => {
      if (p === '/missing.js') throw new Error('ENOENT');
      return "Given('a survivor', noop);";
    };
    const index = buildStepIndex({
      files: ['/missing.js', '/ok.js'],
      readFile,
    });
    assert.equal(index.entries.length, 1);
    assert.ok(matchStep(index, 'a survivor'));
  });

  it('tolerates an absent index without throwing', () => {
    assert.equal(matchStep(null, 'anything'), null);
    assert.deepEqual(buildStepIndex({ files: undefined }).entries, []);
  });
});
