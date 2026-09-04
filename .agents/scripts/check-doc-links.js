#!/usr/bin/env node

// .agents/scripts/check-doc-links.js
//
// Story #2662 — Internal-link and slash-command resolver for active docs.
//
// Scans every `*.md` under `docs/` and `.agents/` (excluding
// `docs/CHANGELOG.md`) and validates:
//
//   1. Every Markdown relative-path link `[text](relative/path[#anchor])`
//      resolves to a real file on disk (anchors are not validated, only
//      stripped). Absolute URLs (http(s)://, mailto:, etc.) and pure
//      in-document anchors (`#section`) are skipped.
//
//   2. Every `/<slash-command>` token in prose resolves to
//      `.agents/workflows/<command>.md`. A small allowlist tolerates
//      non-slash-command tokens such as `/temp/`, `/dev/`, and common URL
//      path fragments (e.g. `/issues/`, `/blob/`, `/pulls/`).
//
//   3. No active doc mentions any retired slash command. The retired-command
//      blocklist is seeded with `agents-bootstrap-github`,
//      `single-story-plan` (renamed to `/mandrel-plan`), and `mandrel`
//      (retired in favor of the generated `.agents/docs/workflows.md`
//      catalog) and takes precedence over the workflow-resolution check —
//      a retired token is always a non-zero exit even if a stale workflow
//      file happens to exist.
//
//   4. Story #4801 — every relative link originating under `.agents/**`
//      resolves to a target that still exists once the tree is materialized
//      into a *consumer* project. See `escapesPayload` for the boundary rule.
//
// Exit codes:
//   0  every link and slash-command token resolves cleanly.
//   1  at least one violation; details are written to stderr (file:line).
//
// Helpers (region scanner, token tokenizer, etc.) are intentionally inlined
// per the parent Story's design constraint.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { parseStandardCliArgs } from './lib/cli/standard-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { Logger } from './lib/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// --- Static config ---------------------------------------------------------

// Retired slash-command tokens that MUST NOT appear in any active doc.
// Tokens are stored WITHOUT the leading slash.
export const RETIRED_COMMANDS = new Set([
  'agents-bootstrap-github',
  'single-story-plan',
  'mandrel',
  // #4482 — dead workflow surface retired (host-native equivalents).
  'explain',
  'git-merge-pr',
]);

// Command spellings a *historical* record may still name, keyed by the file
// allowed to name them. A decisions log that cannot quote the name a command
// had is a broken record: an ADR describes the world as it was, so freezing
// its prose is the point. Scoped per-file and per-token rather than
// allowlisted globally — everywhere else these are simply wrong, and a typo
// like `/mandrl-plan` must still fail here. Story #5126 renamed `/plan` →
// `/mandrel-plan` and `/deliver` → `/mandrel-deliver`; the ADRs that decided
// the Story-only model still name them as they were called then.
export const SUPERSEDED_COMMAND_SPELLINGS = new Map([
  ['docs/decisions.md', new Set(['plan', 'deliver'])],
]);

// Tokens that look like `/foo` in prose but are not slash commands. Tokens
// are stored WITHOUT the leading slash. The list focuses on common URL path
// fragments and on-disk path roots that appear in tutorial prose. The
// scanner additionally suppresses tokens whose surrounding context makes
// them obviously non-command (see `isCodeFence` and the URL-context heuristic
// in `extractSlashTokens`).
export const SLASH_ALLOWLIST = new Set([
  // workspace/conventional roots
  'temp',
  'dev',
  'tmp',
  'var',
  'etc',
  'usr',
  'opt',
  'home',
  'root',
  'mnt',
  'srv',
  'bin',
  'sbin',
  'proc',
  'sys',
  'c',
  // common GitHub / git URL path fragments
  'issues',
  'pull',
  'pulls',
  'blob',
  'tree',
  'commit',
  'commits',
  'compare',
  'releases',
  'actions',
  'wiki',
  'settings',
  'repos',
  'orgs',
  'users',
  'api',
  'raw',
  'archive',
  'discussions',
  'labels',
  'milestones',
  'projects',
  'tags',
  // generic URL path fragments
  'docs',
  'guide',
  'reference',
  'search',
  'login',
  'logout',
  'admin',
  'static',
  'assets',
  'images',
  'public',
  'src',
  'lib',
  'node_modules',
  // common framework / tool URL roots
  'workflows',
  'features',
  'main',
]);

// --- Payload boundary (Story #4801) ----------------------------------------

// `mandrel sync` materializes ONLY the package's `.agents/` payload into a
// consumer's project, at `<projectRoot>/.agents` (see `lib/cli/sync.js`:
// `destRoot = path.join(projectRoot, '.agents')`). `bin/` and `lib/` ship
// inside the npm tarball but stay under `node_modules/mandrel/`, and the
// framework's own `tests/`, `docs/` (bar the CHANGELOG) and `.claude/` trees
// ship nowhere at all. So a relative link that escapes `.agents/` resolves
// cleanly in THIS repo and dangles in every consumer — which is exactly why
// the checker cannot catch this class by `fs.existsSync` alone.
//
// This is why the boundary is `.agents/` and NOT `package.json#files`: the
// latter lists `lib/` and `bin/`, which are packaged but never materialized
// at a consumer's repo root.
export const MATERIALIZED_ROOT = '.agents';

// Repo-root-relative paths OUTSIDE `.agents/` that a Mandrel *consumer*
// legitimately owns, so a doc under `.agents/**` may still link to them.
// Deliberately explicit rather than pattern-derived: whether a given repo-root
// path is consumer-owned or framework-only is a judgment per path, not a rule.
// A new escaping link fails closed until it is justified and added here.
export const CONSUMER_OWNED_PATHS = new Set([
  'package.json',
  '.agentrc.json',
  '.c8rc.cjs',
  'docs/architecture.md',
  'docs/decisions.md',
]);

// Directory prefixes (repo-root-relative, trailing slash) whose whole subtree
// is consumer-owned.
export const CONSUMER_OWNED_PREFIXES = Object.freeze(['baselines/']);

/**
 * True when `relTarget` is unreachable from a materialized consumer tree.
 *
 * Only links whose SOURCE lives under `.agents/**` are subject to the rule —
 * `docs/**` is framework-repo-only, ships nowhere, and keeps today's
 * existence-only semantics.
 *
 * @param {string} relFile   repo-relative POSIX path of the linking document
 * @param {string} relTarget repo-relative POSIX path the link resolves to
 */
export function escapesPayload(relFile, relTarget) {
  if (!relFile.startsWith(`${MATERIALIZED_ROOT}/`)) return false;
  if (
    relTarget === MATERIALIZED_ROOT ||
    relTarget.startsWith(`${MATERIALIZED_ROOT}/`)
  ) {
    return false;
  }
  if (CONSUMER_OWNED_PATHS.has(relTarget)) return false;
  if (CONSUMER_OWNED_PREFIXES.some((p) => relTarget.startsWith(p)))
    return false;
  return true;
}

// --- File discovery --------------------------------------------------------

function isExcludedRelPath(relPath) {
  if (relPath === 'docs/CHANGELOG.md') return true;
  return false;
}

function walkMarkdown(dirAbs, repoRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (_err) {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkMarkdown(abs, repoRoot, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      if (!isExcludedRelPath(rel)) out.push(abs);
    }
  }
}

/**
 * Collect every non-excluded `*.md` under each `scanRoots` entry.
 *
 * @param {string}   rootAbs     absolute repo root
 * @param {string[]} scanRoots   repo-relative subtrees to walk
 * @param {string[]} [exclude]   minimatch globs; a repo-relative POSIX path
 *                               matching any of them is dropped from the scan
 */
export function discoverMarkdown(rootAbs, scanRoots, exclude = []) {
  const out = [];
  for (const sub of scanRoots) {
    const subAbs = path.join(rootAbs, sub);
    if (fs.existsSync(subAbs)) walkMarkdown(subAbs, rootAbs, out);
  }
  const filtered = exclude.length
    ? out.filter((abs) => {
        const rel = path.relative(rootAbs, abs).split(path.sep).join('/');
        return !exclude.some((g) => minimatch(rel, g, { dot: true }));
      })
    : out;
  filtered.sort();
  return filtered;
}

// --- Region masking --------------------------------------------------------

// Returns a copy of `source` where the contents of every fenced code block
// and every inline code span are replaced by spaces. Newlines are preserved
// so that line numbers stay aligned for downstream tokenizers. Fenced blocks
// are matched on `` ``` `` or `~~~` openers at column 0 (with optional
// indentation) and the closing fence MUST match the opener marker.
export function maskCodeRegions(source) {
  const lines = source.split('\n');
  const out = new Array(lines.length);
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (inFence) {
      // Blank the line; keep an empty string so newline survives the join.
      out[i] = '';
      if (
        fenceMatch?.[2].startsWith(fenceMarker[0]) &&
        fenceMatch[2].length >= fenceMarker.length
      ) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[2];
      out[i] = '';
      continue;
    }
    // Strip inline code spans (`...`). We do not need to honor escaped
    // backticks for this checker — slash tokens inside inline code are not
    // command references regardless.
    out[i] = line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  }
  return out.join('\n');
}

// --- Link extraction -------------------------------------------------------

// Returns absolute char offset → 1-indexed line number lookup.
function offsetToLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

// Match Markdown inline links `[text](target)`. We deliberately keep the
// regex simple: `text` may not contain `]`, and `target` may not contain
// whitespace or `)`. Reference-style links are out of scope for this
// checker (the repo uses inline links exclusively).
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;

export function extractLinks(masked) {
  const out = [];
  LINK_RE.lastIndex = 0;
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = LINK_RE.exec(masked)) !== null) {
    out.push({
      target: m[2],
      line: offsetToLine(masked, m.index),
    });
  }
  return out;
}

function isExternalOrInternalAnchor(target) {
  if (target.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return true; // http:, https:, mailto:, etc.
  if (target.startsWith('//')) return true; // protocol-relative
  return false;
}

function stripAnchorAndQuery(target) {
  let t = target;
  const hash = t.indexOf('#');
  if (hash !== -1) t = t.slice(0, hash);
  const q = t.indexOf('?');
  if (q !== -1) t = t.slice(0, q);
  return t;
}

// Percent-decode a link target's path portion (Story #5090). A correctly
// encoded Markdown destination escapes URL-reserved characters — a
// file-based router's `[token]` segment is written `%5Btoken%5D`, the form
// CommonMark renderers require — but the filesystem knows only the decoded
// name. The decode is one-way and total: a malformed escape (`%zz`) degrades
// to the raw string instead of throwing `URIError`, so an undecodable target
// is resolved exactly as it was before.
function decodeLinkPath(pathOnly) {
  if (!pathOnly.includes('%')) return pathOnly;
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    return pathOnly;
  }
}

// --- Slash-token extraction ------------------------------------------------

// Tokens look like `/<lowercase-alphanum-with-hyphens>`. We exclude tokens
// preceded by a word character or another slash (URL paths, `http://...`),
// and tokens immediately followed by a word/`-` character (so we match the
// whole command, not a prefix).
// A slash token is `/<name>` where:
//   - the preceding char is NOT a word char, `/`, `:`, `.`, `>`, `]`, `)`,
//     so we don't match URL path segments or fragments embedded in paths
//     like `temp/run-<id>/lifecycle.ndjson` (preceded by `>`) or
//     `temp/run-[ID]/tickets.json` (preceded by `]`).
//   - the following char is NOT a word char, `-`, or `.`, so file
//     extensions like `/tickets.json` and identifier suffixes don't match.
// The optional `(?::[a-z][a-z0-9-]*)?` tail captures the namespaced
// `/loops:<name>` command form (Story #4289). Without it the matcher would
// stop at `loops` and try to resolve `.agents/workflows/loops.md`, which does
// not exist — loop units live under `loops/<name>.md`. The resolver below
// splits the captured `loops:<name>` token on the `:` to resolve the
// namespaced path.
const SLASH_TOKEN_RE =
  /(?<![\w/:.>\])])\/([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)(?![\w.-])/g;

export function extractSlashTokens(masked) {
  const out = [];
  SLASH_TOKEN_RE.lastIndex = 0;
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = SLASH_TOKEN_RE.exec(masked)) !== null) {
    out.push({
      token: m[1],
      line: offsetToLine(masked, m.index),
    });
  }
  return out;
}

// --- Per-file check --------------------------------------------------------

/**
 * The slash tokens `relFile` may name without resolving to a workflow: the
 * global allowlist, plus any superseded spelling this particular file is
 * allowed to quote.
 *
 * @param {string} relFile Repo-relative path of the file being checked.
 * @returns {Set<string>} Tokens to skip, stored without the leading slash.
 */
function slashAllowlistFor(relFile) {
  const superseded = SUPERSEDED_COMMAND_SPELLINGS.get(relFile);
  if (!superseded) return SLASH_ALLOWLIST;
  return new Set([...SLASH_ALLOWLIST, ...superseded]);
}

export function checkFile(absPath, repoRoot) {
  const violations = [];
  const source = fs.readFileSync(absPath, 'utf8');
  const masked = maskCodeRegions(source);
  const fileDir = path.dirname(absPath);
  const relFile = path.relative(repoRoot, absPath).split(path.sep).join('/');
  const workflowsDir = path.join(repoRoot, '.agents', 'workflows');

  // Tokenize the masked source once and reuse the array across both the
  // retired-command sweep and the slash-command resolution pass below.
  const slashTokens = extractSlashTokens(masked);

  // 1. Retired-command sweep — runs against the masked source so command
  //    references inside fenced examples don't trip us, but we still catch
  //    every prose mention. Retired-command checks ALWAYS take precedence:
  //    even if the token would otherwise be allowlisted or resolved, a hit
  //    here is a non-zero exit.
  for (const { token, line } of slashTokens) {
    if (RETIRED_COMMANDS.has(token)) {
      violations.push({
        file: relFile,
        line,
        kind: 'retired-command',
        message: `retired slash command /${token} is not allowed in active docs`,
      });
    }
  }

  // 2. Relative-link resolution.
  for (const { target, line } of extractLinks(masked)) {
    if (isExternalOrInternalAnchor(target)) continue;
    const rawPathOnly = stripAnchorAndQuery(target);
    if (!rawPathOnly) continue; // pure anchor that survived earlier check
    // Decode AFTER anchor/query stripping — so an escaped `%23` cannot
    // collapse into an anchor delimiter and truncate the target — and BEFORE
    // resolution, so the payload-boundary branch below reports the decoded
    // path rather than the escaped one.
    const pathOnly = decodeLinkPath(rawPathOnly);
    let resolved;
    if (pathOnly.startsWith('/')) {
      // Treat root-absolute paths as repo-root relative.
      resolved = path.join(repoRoot, pathOnly);
    } else {
      resolved = path.resolve(fileDir, pathOnly);
    }
    // Payload boundary (Story #4801) takes precedence over existence: a link
    // that escapes the materialized tree is a defect even when the target
    // exists here, and reporting both kinds for one link would double-count.
    const relTarget = path
      .relative(repoRoot, resolved)
      .split(path.sep)
      .join('/');
    if (escapesPayload(relFile, relTarget)) {
      violations.push({
        file: relFile,
        line,
        kind: 'payload-boundary',
        message:
          `link escapes the materialized payload: ${target} → ${relTarget}. ` +
          `Only '${MATERIALIZED_ROOT}/' is materialized into a consumer project, ` +
          'so this resolves here but dangles for every consumer. Use an absolute ' +
          'GitHub URL or a non-link code span.',
      });
      continue;
    }
    if (!fs.existsSync(resolved)) {
      violations.push({
        file: relFile,
        line,
        kind: 'broken-link',
        message: `broken relative link: ${target}`,
      });
    }
  }

  // 3. Slash-command resolution. Skip retired hits (already reported),
  //    allowlisted tokens, and a superseded spelling in the one file allowed
  //    to quote it (SUPERSEDED_COMMAND_SPELLINGS). A command is valid if it resolves to a top-level
  //    workflow file OR to a helpers/ module (helpers are not projected into
  //    the `.claude/commands/` tree but are still legitimate named workflows
  //    that parent workflows invoke by prose reference).
  const slashAllowlist = slashAllowlistFor(relFile);
  for (const { token, line } of slashTokens) {
    if (RETIRED_COMMANDS.has(token)) continue;
    if (slashAllowlist.has(token)) continue;
    // Namespaced loop commands (`/loops:<name>`, Story #4289) resolve to a
    // loop unit under `.agents/workflows/loops/<name>.md`. Split on the `:`
    // and resolve the namespaced path rather than a flat `loops:<name>.md`.
    if (token.includes(':')) {
      const [ns, name] = token.split(':');
      const nsFile = path.join(workflowsDir, ns, `${name}.md`);
      if (!fs.existsSync(nsFile)) {
        violations.push({
          file: relFile,
          line,
          kind: 'unknown-command',
          message: `slash command /${token} does not resolve to .agents/workflows/${ns}/${name}.md`,
        });
      }
      continue;
    }
    const workflowFile = path.join(workflowsDir, `${token}.md`);
    const helperFile = path.join(workflowsDir, 'helpers', `${token}.md`);
    if (!fs.existsSync(workflowFile) && !fs.existsSync(helperFile)) {
      violations.push({
        file: relFile,
        line,
        kind: 'unknown-command',
        message: `slash command /${token} does not resolve to .agents/workflows/${token}.md`,
      });
    }
  }

  return violations;
}

// --- Public entry point ----------------------------------------------------

export const DEFAULT_SCAN_ROOTS = Object.freeze(['docs', '.agents']);

/**
 * Run the checker programmatically. Returns `{ exitCode, violations }`.
 * `exitCode` is 0 when every doc is clean, 1 otherwise.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot] Defaults to the framework repo root.
 * @param {string[]} [options.scanRoots] Defaults to `['docs', '.agents']`.
 * @param {string[]} [options.exclude] minimatch globs dropped from the scan.
 */
export function runCheck(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const scanRoots = options.scanRoots ?? [...DEFAULT_SCAN_ROOTS];
  const exclude = options.exclude ?? [];
  const files = discoverMarkdown(repoRoot, scanRoots, exclude);
  const violations = [];
  for (const abs of files) {
    const fileViolations = checkFile(abs, repoRoot);
    violations.push(...fileViolations);
  }
  return {
    exitCode: violations.length === 0 ? 0 : 1,
    violations,
    scanned: files.length,
  };
}

function formatViolation(v) {
  return `${v.file}:${v.line}: [${v.kind}] ${v.message}`;
}

/**
 * Translate argv into `runCheck` options. Repeatable `--scan-root` replaces
 * the default scan set entirely; repeatable `--exclude` filters whatever was
 * scanned. Absent flags reproduce the pre-#4801 defaults exactly.
 */
export function parseArgs(argv) {
  const { values } = parseStandardCliArgs({
    argv,
    extras: {
      'scan-root': { type: 'string-multi', alias: 'scanRoot' },
      exclude: { type: 'string-multi', alias: 'exclude' },
    },
  });
  const scanRoots = values.scanRoot?.length
    ? values.scanRoot
    : [...DEFAULT_SCAN_ROOTS];
  return { scanRoots, exclude: values.exclude ?? [] };
}

async function main() {
  const { scanRoots, exclude } = parseArgs(process.argv.slice(2));
  const result = runCheck({ scanRoots, exclude });
  if (result.violations.length === 0) {
    Logger.info(
      `[check-doc-links] OK — scanned ${result.scanned} active markdown file(s); no violations.`,
    );
    process.exit(0);
    return;
  }
  for (const v of result.violations) {
    process.stderr.write(`${formatViolation(v)}\n`);
  }
  process.stderr.write(
    `\n[check-doc-links] FAILED — ${result.violations.length} violation(s) across ${result.scanned} file(s).\n`,
  );
  process.exit(1);
}

runAsCli(import.meta.url, main, {
  source: 'check-doc-links',
  usage: {
    invocation:
      'node .agents/scripts/check-doc-links.js [--scan-root <path>] [--exclude <glob>]',
    summary:
      'Validate every relative Markdown link and /slash-command token across docs/ and .agents/, reject mentions of retired commands, and reject links that escape the materialized .agents/ payload.',
    flags: [
      [
        '--scan-root <path>',
        'Repeatable. Repo-relative subtree to scan. Replaces the default set (docs, .agents).',
      ],
      [
        '--exclude <glob>',
        'Repeatable. minimatch glob; matching files are dropped from the scan.',
      ],
    ],
    notes: [
      'Consumers materialize only .agents/, so a relative link from .agents/**\nto a framework-repo-only path (tests/, lib/, .claude/, framework docs)\nis reported as a payload-boundary violation even though it resolves here.',
      'Exit codes:\n  0  every link and command token resolves\n  1  at least one violation (file:line on stderr)',
    ],
  },
});
