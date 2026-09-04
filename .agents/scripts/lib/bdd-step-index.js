/**
 * bdd-step-index.js — scoped discovery and matching for BDD step definitions.
 *
 * `check-gherkin-corpus.js` answers one question per Gherkin step: does a step
 * definition **under this step's own scope** claim it? That question has two
 * halves, and this module owns both so the corpus gate never re-implements
 * either inline:
 *
 *   1. **Discovery** — which files under a scope's `stepRoots` hold step
 *      definitions, and which `.feature` files sit under its `featureRoots`.
 *      Feature discovery is delegated to `listFeatureFiles` in
 *      `bdd-scenario-scanner.js` rather than copied: /mandrel-plan's scenario index and
 *      this gate must agree on what counts as a feature file, and two walkers
 *      would eventually disagree.
 *   2. **Matching** — turn each definition's Cucumber expression or regular
 *      expression into one `RegExp`, and test a step's text against the index.
 *
 * ## Heuristic index, exact parser
 *
 * The parser half of the gate is exact: `@cucumber/gherkin` decides what
 * compiles. This half is deliberately **not**. Reading step definitions
 * without executing them means a regex scan over source text, and a scan
 * cannot see a definition assembled at runtime, registered through a wrapper,
 * or parameterised by a custom `defineParameterType`. That asymmetry is why
 * the gate ships a step-waiver list: a false "unbound" must always have an
 * escape that does not require switching the whole gate off.
 *
 * Supported Cucumber-expression constructs are the ones the built-in parameter
 * types and the optional/alternation syntax cover — `{int}`, `{float}`,
 * `{word}`, `{string}`, an anonymous `{}`, `text(s)` optionals, and `a/an`
 * word alternation. An unrecognised `{custom}` degrades to `(.*)` rather than
 * failing to match, because over-matching produces a missed finding while
 * under-matching produces a false one, and a false one blocks a delivery.
 *
 * Nothing here reads configuration or exits a process; the CLI owns both.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { listFeatureFiles } from './bdd-scenario-scanner.js';

export { listFeatureFiles };

/** Extensions a step-definition module may carry. */
const STEP_FILE_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
]);

/** Directory names never walked when looking for step definitions. */
const SKIPPED_DIRECTORIES = Object.freeze(
  new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']),
);

/**
 * Regular expressions for the built-in Cucumber parameter types, keyed by the
 * name inside the braces. The empty key is the anonymous `{}` parameter and
 * doubles as the fallback for a custom type this scan cannot resolve.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PARAMETER_PATTERNS = Object.freeze({
  '': '(.*)',
  int: '(-?\\d+)',
  float: '(-?\\d*\\.?\\d+)',
  word: '([^\\s]+)',
  string: '("[^"]*"|\'[^\']*\')',
});

/**
 * Step-registration call sites this scan recognises. `Step` and `defineStep`
 * cover the generic registrars playwright-bdd and cucumber-js both expose.
 *
 * Group 2/3 capture a quoted expression, group 4/5 a regular-expression
 * literal with its flags.
 */
const STEP_CALL_PATTERN =
  /\b(Given|When|Then|And|But|Step|defineStep)\s*\(\s*(?:(['"`])((?:\\.|(?!\2)[^\\])*)\2|\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/([dgimsuvy]*))/g;

/** Escape one character for literal use inside a regular expression. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render one alternation-free segment of a Cucumber expression: parameter
 * placeholders become capture groups, `(optional)` runs become optional
 * groups, and everything else is escaped literal text.
 *
 * @param {string} segment
 * @returns {string}
 */
function renderSegment(segment) {
  let out = '';
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === '\\' && i + 1 < segment.length) {
      out += escapeRegExp(segment[i + 1]);
      i += 2;
      continue;
    }
    if (ch === '{') {
      const end = segment.indexOf('}', i);
      if (end !== -1) {
        const name = segment.slice(i + 1, end);
        out += PARAMETER_PATTERNS[name] ?? PARAMETER_PATTERNS[''];
        i = end + 1;
        continue;
      }
    }
    if (ch === '(') {
      const end = segment.indexOf(')', i);
      if (end !== -1) {
        out += `(?:${renderSegment(segment.slice(i + 1, end))})?`;
        i = end + 1;
        continue;
      }
    }
    out += escapeRegExp(ch);
    i += 1;
  }
  return out;
}

/**
 * Split a word on unescaped `/` so `a/an` becomes two alternatives. Escaped
 * `\/` stays literal.
 *
 * @param {string} word
 * @returns {string[]}
 */
function splitAlternation(word) {
  const parts = [];
  let current = '';
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i];
    if (ch === '\\' && i + 1 < word.length) {
      current += ch + word[i + 1];
      i += 1;
      continue;
    }
    if (ch === '/') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Compile a Cucumber expression into an anchored `RegExp`.
 *
 * Alternation is resolved per whitespace-separated word, which is what the
 * real expression grammar does. Resolving it across the whole string instead
 * would turn `I have a/an apple` into `^I have a|an apple$` — two anchored
 * alternatives, neither of them the intended step.
 *
 * @param {string} expression
 * @returns {RegExp}
 */
function expressionToRegExp(expression) {
  const tokens = String(expression).split(/(\s+)/);
  const body = tokens
    .map((token) => {
      if (token.length === 0) return '';
      if (/^\s+$/.test(token)) return escapeRegExp(token);
      const alternatives = splitAlternation(token);
      const rendered = alternatives.map(renderSegment);
      return rendered.length > 1 ? `(?:${rendered.join('|')})` : rendered[0];
    })
    .join('');
  return new RegExp(`^${body}$`);
}

/**
 * Recursively list step-definition source files under the given roots.
 *
 * Deliberately not `walkFilesByExtension` from `fs-walk.js`, which is the
 * shared walker for the lint surfaces. That one matches a single extension and
 * walks everything below the root, so reusing it here would mean seven passes
 * — one per accepted extension — each of them descending into a `node_modules`
 * a consumer's step root may well contain. It also rethrows every non-ENOENT
 * `readdir` failure, where this walker must skip an unreadable directory: an
 * unreadable *scope* has to surface as "zero step definitions", the gate's
 * fail-closed path, which names the scope and its step roots.
 *
 * @param {string[]} roots absolute or cwd-relative directories
 * @returns {string[]} absolute paths, sorted
 */
export function listStepFiles(roots) {
  const found = [];
  for (const root of roots ?? []) {
    walkStepDir(path.resolve(root), found);
  }
  return found.sort();
}

function walkStepDir(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // `withFileTypes` reports a symlink as neither file nor directory, so
    // fall back to a stat for those rather than dropping them silently.
    const isDir =
      entry.isDirectory() || (entry.isSymbolicLink() && isDirAt(full));
    if (isDir) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walkStepDir(full, acc);
      continue;
    }
    if (STEP_FILE_EXTENSIONS.includes(path.extname(entry.name))) acc.push(full);
  }
}

function isDirAt(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract every step registration in one source file.
 *
 * @param {string} source file contents
 * @param {string} file absolute path, recorded on each entry
 * @returns {Array<{ file: string, line: number, source: string, regex: RegExp }>}
 */
function parseStepDefinitions(source, file) {
  const entries = [];
  STEP_CALL_PATTERN.lastIndex = 0;
  let match = STEP_CALL_PATTERN.exec(source);
  while (match !== null) {
    const [, , , quoted, pattern, flags] = match;
    const line = source.slice(0, match.index).split('\n').length;
    const regex = compileMatcher({ quoted, pattern, flags });
    if (regex) entries.push({ file, line, source: quoted ?? pattern, regex });
    match = STEP_CALL_PATTERN.exec(source);
  }
  return entries;
}

/**
 * Build one matcher from a captured registration. A malformed regular
 * expression yields `null` — the definition is skipped rather than crashing
 * the scan, and the steps it would have claimed surface as unbound, which is
 * the safe direction.
 */
function compileMatcher({ quoted, pattern, flags }) {
  if (typeof quoted === 'string') {
    try {
      return expressionToRegExp(quoted);
    } catch {
      return null;
    }
  }
  try {
    // `g` and `y` are stateful across `.test()` calls; strip them so the index
    // cannot depend on how many times it has been consulted.
    return new RegExp(pattern, (flags ?? '').replace(/[gy]/g, ''));
  } catch {
    return null;
  }
}

/**
 * Build the step index for one scope.
 *
 * @param {{ files: string[], readFile?: (p: string) => string }} params
 * @returns {{ entries: Array<{ file: string, line: number, source: string, regex: RegExp }>, files: string[] }}
 */
export function buildStepIndex({ files, readFile }) {
  const read = readFile ?? ((p) => readFileSync(p, 'utf8'));
  const entries = [];
  for (const file of files ?? []) {
    let source;
    try {
      source = read(file);
    } catch {
      continue;
    }
    entries.push(...parseStepDefinitions(source, file));
  }
  return { entries, files: [...(files ?? [])] };
}

/**
 * Find the first definition in the index claiming `text`.
 *
 * @param {{ entries: Array<{ regex: RegExp }> }} index
 * @param {string} text the step text, keyword already stripped by the parser
 * @returns {object | null} the matching entry, or `null` when nothing claims it
 */
export function matchStep(index, text) {
  for (const entry of index?.entries ?? []) {
    if (entry.regex.test(text)) return entry;
  }
  return null;
}

/**
 * Module-private helpers the suite drives directly. Bundled rather than
 * exported individually — the same seam `knip-entry-sync.js` and
 * `source-classifier.js` use — so test-only symbols cost one production
 * dead-export row instead of one each, and so private helpers do not read as
 * API.
 */
export const __testing = Object.freeze({
  expressionToRegExp,
  parseStepDefinitions,
});
