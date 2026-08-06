/**
 * knip-entry-sync.js — derive which top-level `.agents/scripts/*.js` CLIs are
 * actually invoked, and diff that set against `knip.json`'s `entry` array.
 *
 * Why this exists (Story #5001 → the #5012 near-miss):
 *
 * #5001 replaced the blanket `.agents/scripts/*.js!` entry glob with an
 * explicit list, precisely so that a top-level CLI **nothing invokes** stops
 * being declared live by the glob and surfaces as dead. It simultaneously
 * promoted knip's `files` rule to `error`, so whole-file death now produces
 * `{ file, symbol: '*' }` baseline rows.
 *
 * That pairing has a silent failure mode. A CLI added *after* #5001 is not in
 * the hand-written list, so knip reads it as unreachable and emits a whole-file
 * row for it — plus transitive rows for every lib module only that CLI imports.
 * During #5012's delivery this produced 5 false rows (`check-baseline-scope.js`,
 * `prune-baseline-orphans.js`, and their three `lib/baselines/*` modules). The
 * natural remedy — accept the ratchet's diff — would have permanently recorded
 * live, working operator CLIs as expected-dead, blinding the ratchet to their
 * real death later. It was caught only because a base-sync conflict forced a
 * manual read of the diff.
 *
 * The fix is to stop depending on a human remembering to edit `knip.json`.
 * #5001's own wording already names the derivation rule — entries are derived
 * "from what package.json scripts, husky hooks, .github/workflows, and the
 * .agents workflow/skill markdown actually invoke". This module mechanizes
 * exactly that rule and asserts it in both directions:
 *
 *   missing — invoked by a real caller but absent from `entry`. This is the
 *     #5012 bug: knip will call it dead and the ratchet will offer to record
 *     the lie.
 *   stale — listed in `entry` but invoked by nothing. This is the blind spot
 *     #5001 closed: a declared entry point is immortal, so its death can never
 *     surface.
 *
 * Deliberately NOT a filesystem-derived list. Restoring `.agents/scripts/*.js!`
 * — or regenerating the array from `readdirSync` — would make every file live
 * by construction and undo #5001's AC-2. Liveness here means *invoked*, not
 * *present*.
 *
 * Deliberately NOT conferred by documentation prose. `.agents/docs/**` and
 * `docs/**` describe operator-run commands; a paragraph naming a CLI is not a
 * caller. Three CLIs are named only in prose today
 * (`check-baseline-drift.js`, `post-structured-comment.js`,
 * `provision-git-hooks.js`) and #5001 recorded all of them as whole-file dead
 * rows on purpose. Counting prose would silently resurrect them.
 *
 * A CLI that is only *imported* by another script (`cleanup-repo-test-temp.js`,
 * imported by `run-tests.js` and `run-coverage.js`) is correctly neither: it is
 * reachable through the module graph from a real entry, so knip already sees it
 * and it must not be declared an entry point of its own.
 */

import fs from 'node:fs';
import path from 'node:path';

// Only `resolveEntrySync` and `renderEntrySyncReport` are public — they are
// what `check-knip-entries.js` calls. Everything else is module-private and
// reached by the suite through the `__testing` bundle at the foot of this file,
// the same seam `source-classifier.js` and five sibling modules use. Exporting
// the internals individually would put seven test-only symbols on the
// production dead-export baseline and make private helpers look like API.

/** Top-level CLI directory, repo-relative. */
const SCRIPTS_DIR = path.join('.agents', 'scripts');

/**
 * Executable surfaces — a mention of a CLI here is an instruction to run it.
 *
 * `dirs` entries are walked recursively and filtered by `test`. `files` are
 * read directly. Documentation trees are absent by design (see module header).
 *
 * @type {ReadonlyArray<{ kind: 'file' | 'dir', at: string, test?: RegExp }>}
 */
const INVOCATION_SURFACES = Object.freeze([
  { kind: 'file', at: 'package.json' },
  { kind: 'dir', at: '.husky', test: /^(?!.*[/\\]_[/\\]).*$/ },
  { kind: 'dir', at: path.join('.github', 'workflows'), test: /\.ya?ml$/ },
  { kind: 'dir', at: path.join('.agents', 'workflows'), test: /\.md$/ },
  { kind: 'dir', at: path.join('.agents', 'skills'), test: /\.md$/ },
  { kind: 'dir', at: path.join('.agents', 'agents'), test: /\.md$/ },
  { kind: 'dir', at: path.join('.agents', 'rules'), test: /\.md$/ },
  { kind: 'dir', at: SCRIPTS_DIR, test: /\.js$/ },
]);

/**
 * Strip line and block comments from JavaScript source, preserving string and
 * template literals so a `'https://…'` or a `` `${x}//y` `` is not mangled.
 *
 * Comments are stripped before scanning `.js` surfaces so a JSDoc paragraph
 * that merely *names* a CLI ("superseded by `node .agents/scripts/foo.js`")
 * cannot confer liveness on it. Several such mentions exist today; every one
 * of them is prose about a script's internals, not a call.
 *
 * Replaces comment bodies with equivalent whitespace rather than deleting
 * them, so byte offsets and line numbers survive for any future caller that
 * wants to report a position.
 *
 * @param {string} source
 * @returns {string}
 */
function stripJsComments(source) {
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else {
      const ch = text[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === '\\') {
            j += 2;
            continue;
          }
          if (text[j] === ch) break;
          j += 1;
        }
        const stop = Math.min(j + 1, text.length);
        out += text.slice(i, stop);
        i = stop;
      } else {
        out += ch;
        i += 1;
      }
    }
  }
  return out;
}

/**
 * Recursively list files under `dir`, skipping `node_modules` and `.git`.
 *
 * @param {string} dir absolute path
 * @param {typeof fs} fsImpl
 * @param {string[]} [acc]
 * @returns {string[]} absolute file paths
 */
function walk(dir, fsImpl, acc = []) {
  let entries;
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, fsImpl, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Read every executable surface under `repoRoot`.
 *
 * `.js` surfaces arrive comment-stripped; every other surface arrives verbatim.
 * Test files are excluded: a test importing or naming a CLI does not make it
 * invoked, which is the same test-only-importer discount `--production` applies
 * to the dead-exports ratchet itself.
 *
 * @param {{ repoRoot: string, fsImpl?: typeof fs }} opts
 * @returns {Array<{ path: string, text: string }>} repo-relative path + content
 */
function collectInvocationSurfaces({ repoRoot, fsImpl = fs }) {
  const surfaces = [];
  const push = (absolute) => {
    const rel = path.relative(repoRoot, absolute);
    if (rel.includes('__tests__') || /\.test\.[cm]?js$/.test(rel)) return;
    let text;
    try {
      text = fsImpl.readFileSync(absolute, 'utf8');
    } catch {
      return;
    }
    surfaces.push({
      path: rel.split(path.sep).join('/'),
      text: rel.endsWith('.js') ? stripJsComments(text) : text,
    });
  };

  for (const surface of INVOCATION_SURFACES) {
    const absolute = path.join(repoRoot, surface.at);
    if (surface.kind === 'file') {
      push(absolute);
      continue;
    }
    for (const file of walk(absolute, fsImpl)) {
      const rel = path.relative(repoRoot, file);
      if (surface.test && !surface.test.test(rel)) continue;
      push(file);
    }
  }
  return surfaces;
}

/**
 * Build the two recognizers for one CLI basename.
 *
 * `pathLiteral` — the CLI named by its repo path (`.agents/scripts/foo.js`),
 *   in either separator style. This is how package.json scripts, husky hooks,
 *   workflow `run:` blocks and workflow markdown spell an invocation.
 *
 * `joinedSpawn` — the CLI named by bare basename as the tail of a
 *   `path.join(…, 'scripts', 'foo.js')` construction, which is how
 *   `lib/bootstrap/project-bootstrap.js` spawns `check-windows-git-perf.js`
 *   into a consumer checkout. Requiring the `'scripts'` sibling argument is
 *   what separates a real spawn from the several *data* inventories that list
 *   the same basenames as plain array elements (`source-classifier.js`'s
 *   `FRAMEWORK_SCRIPT_BASENAMES`, `check-lifecycle-lint.js`'s allowlist) —
 *   those are catalogues of names, not calls.
 *
 * @param {string} cli basename, e.g. `check-dead-exports.js`
 * @returns {{ pathLiteral: RegExp, joinedSpawn: RegExp }}
 */
function buildInvocationPatterns(cli) {
  const escaped = cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    pathLiteral: new RegExp(`\\.agents[/\\\\]scripts[/\\\\]${escaped}`),
    joinedSpawn: new RegExp(
      `['"\`]scripts['"\`]\\s*,\\s*['"\`]${escaped}['"\`]`,
    ),
  };
}

/**
 * List the top-level CLI basenames actually present in `.agents/scripts/`.
 *
 * @param {{ repoRoot: string, fsImpl?: typeof fs }} opts
 * @returns {string[]} sorted basenames
 */
function listTopLevelClis({ repoRoot, fsImpl = fs }) {
  let entries;
  try {
    entries = fsImpl.readdirSync(path.join(repoRoot, SCRIPTS_DIR), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();
}

/**
 * Read the top-level `.agents/scripts/*.js` basenames declared in `knip.json`'s
 * `entry` array. Glob-bearing patterns are ignored — this reads the explicit
 * enumeration only, which is the surface #5001 made authoritative.
 *
 * @param {{ repoRoot: string, fsImpl?: typeof fs }} opts
 * @returns {{ entries: string[], error: string | null }}
 */
function readKnipEntries({ repoRoot, fsImpl = fs }) {
  const configPath = path.join(repoRoot, 'knip.json');
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return { entries: [], error: `cannot read knip.json: ${error.message}` };
  }
  if (!Array.isArray(parsed?.entry)) {
    return { entries: [], error: 'knip.json has no "entry" array' };
  }
  const prefix = '.agents/scripts/';
  const entries = parsed.entry
    .filter((e) => typeof e === 'string' && e.startsWith(prefix))
    .map((e) => e.replace(/!$/, ''))
    .filter((e) => !e.includes('*'))
    .map((e) => e.slice(prefix.length))
    .filter((e) => !e.includes('/'));
  return { entries: [...new Set(entries)].sort(), error: null };
}

/**
 * Resolve the full entry-sync report for a repository.
 *
 * @param {{ repoRoot: string, fsImpl?: typeof fs }} opts
 * @returns {{
 *   error: string | null,
 *   clis: string[],
 *   declared: string[],
 *   missing: Array<{ cli: string, invokers: string[] }>,
 *   stale: string[],
 *   phantom: string[],
 * }}
 *   `missing` — invoked but not declared (the #5012 bug).
 *   `stale` — declared but invoked by nothing.
 *   `phantom` — declared but no such file on disk (a rename left the list behind).
 */
export function resolveEntrySync({ repoRoot, fsImpl = fs }) {
  const { entries: declared, error } = readKnipEntries({ repoRoot, fsImpl });
  const empty = { clis: [], declared, missing: [], stale: [], phantom: [] };
  if (error) return { error, ...empty };

  const clis = listTopLevelClis({ repoRoot, fsImpl });
  if (clis.length === 0) {
    return { error: `no CLIs found under ${SCRIPTS_DIR}`, ...empty };
  }
  const surfaces = collectInvocationSurfaces({ repoRoot, fsImpl });
  const declaredSet = new Set(declared);

  const missing = [];
  const stale = [];
  for (const cli of clis) {
    const self = `${SCRIPTS_DIR.split(path.sep).join('/')}/${cli}`;
    const { pathLiteral, joinedSpawn } = buildInvocationPatterns(cli);
    const invokers = surfaces
      .filter(
        (s) =>
          s.path !== self &&
          (pathLiteral.test(s.text) ||
            (s.path.endsWith('.js') && joinedSpawn.test(s.text))),
      )
      .map((s) => s.path);
    const isDeclared = declaredSet.has(cli);
    if (invokers.length > 0 && !isDeclared) missing.push({ cli, invokers });
    if (invokers.length === 0 && isDeclared) stale.push(cli);
  }

  const onDisk = new Set(clis);
  const phantom = declared.filter((cli) => !onDisk.has(cli));

  return { error: null, clis, declared, missing, stale, phantom };
}

/**
 * Render the human-readable report. Each divergence names its own remedy —
 * the whole point of the gate is that the *wrong* remedy (accepting the
 * dead-exports ratchet's diff) is the tempting one.
 *
 * @param {ReturnType<typeof resolveEntrySync>} report
 * @returns {string}
 */
export function renderEntrySyncReport(report) {
  const lines = [];
  for (const { cli, invokers } of report.missing) {
    lines.push(
      `+ ${cli} — invoked by ${invokers.slice(0, 3).join(', ')}${
        invokers.length > 3 ? ` (+${invokers.length - 3} more)` : ''
      }`,
    );
    lines.push(
      `    add ".agents/scripts/${cli}!" to knip.json "entry" — until you do, knip`,
    );
    lines.push(
      '    reads it as unreachable and check-dead-exports will offer a false whole-file row.',
    );
  }
  for (const cli of report.stale) {
    lines.push(
      `- ${cli} — declared in knip.json "entry" but nothing invokes it`,
    );
    lines.push(
      '    remove the entry so its death can surface, or wire up the caller.',
    );
  }
  for (const cli of report.phantom) {
    lines.push(`? ${cli} — declared in knip.json "entry" but not on disk`);
    lines.push('    drop the stale path (the file was renamed or removed).');
  }
  const total =
    report.missing.length + report.stale.length + report.phantom.length;
  lines.push(
    `[knip-entries] clis=${report.clis.length} declared=${report.declared.length} ` +
      `missing=${report.missing.length} stale=${report.stale.length} ` +
      `phantom=${report.phantom.length} ${total > 0 ? '(gate fail)' : '(ok)'}`,
  );
  return lines.join('\n');
}

/**
 * Test-only seam. Not API: these helpers are exercised directly by
 * `tests/check-knip-entries.test.js` so the recognizers can be pinned
 * independently of a full fixture tree.
 */
export const __testing = Object.freeze({
  buildInvocationPatterns,
  collectInvocationSurfaces,
  INVOCATION_SURFACES,
  listTopLevelClis,
  readKnipEntries,
  SCRIPTS_DIR,
  stripJsComments,
});
