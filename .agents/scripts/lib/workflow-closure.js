/**
 * Workflow read-tier closure resolver (Story #4752).
 *
 * `.agents/workflows/**` is the largest body of instruction Mandrel ships, and
 * until this module it sat in none of the five doc read-tiers `doc-tiers.js`
 * resolves — measured only by a per-file spine ceiling that is satisfied by
 * moving prose into a linked helper. Workflows are a **graph**, not a flat set,
 * so this module resolves each entry point's transitive markdown-link closure
 * into two numbers:
 *
 *   - **mandatory closure** — the entry point plus the transitive closure of
 *     its `mandatoryReads:` frontmatter edges. This is what a session is
 *     *forced* to read, and it is what `check-context-budget.js` ratchets.
 *   - **reachable closure** — the entry point plus every workflow markdown file
 *     transitively linked from it. Recorded as a drift signal, never gated.
 *
 * **The marker is source-side and per-edge.** A workflow declares the reads it
 * requires in its own frontmatter (`mandatoryReads: [path, …]`, flow or block
 * style, resolved relative to the declaring file). Tier is not intrinsic to a
 * helper — the same file is mandatory from one workflow and on-demand from
 * another — so it cannot live in the target. The key is optional: an absent
 * key means zero mandatory edges and is never an error. Every reachable link
 * not named in `mandatoryReads` is classified on-demand.
 *
 * **Entry points** are the workflows a session can be invoked on: every
 * top-level `.agents/workflows/*.md`, plus any `helpers/*.md` whose H1 declares
 * a slash command named after the file itself (`helpers/deliver-story.md` →
 * `# /deliver-story …`) — a command-shaped helper is invoked directly, so it
 * owns a closure of its own. Plain helpers and appendices are reachable, never
 * entry points; counting every file as an entry point would collapse the
 * mandatory/on-demand distinction into "all workflow bytes".
 *
 * **Failure modes are loud** — a ratchet that silently shrinks its own closure
 * is worse than none:
 *   - a `mandatoryReads` entry that does not resolve to a workflow markdown
 *     file throws, naming the declaring workflow and the offending path;
 *   - a cycle among `mandatoryReads` edges throws, naming the cycle.
 * The **reachable** walk is deliberately cycle-*tolerant* rather than fatal:
 * bidirectional prose cross-references are normal and correct authoring (a
 * spine points at its digest, the digest points back at the spine), so that
 * walk terminates via a visited set and counts each file exactly once — it
 * neither loops nor truncates. Only the gated mandatory graph, where a loop is
 * a genuine authoring error, fails closed.
 *
 * The walk is confined to `.agents/workflows/**`: links out to
 * `.agents/rules/**` or `.agents/skills/**` are neither followed nor recorded,
 * because those are already tiered as flat sets by `doc-tiers.js` and
 * following them would double-count them.
 *
 * Security (security-baseline § Data Leakage & Logging): every value returned
 * or thrown is a repo-relative path or a byte count — never file contents.
 */

import nodeFs from 'node:fs';
import path from 'node:path';

/**
 * Repo-relative root of the workflow tree. The closure never escapes it.
 * @type {string}
 */
const WORKFLOWS_ROOT = '.agents/workflows';

/** Path-segment count of a top-level workflow (`.agents/workflows/x.md`). */
const TOP_LEVEL_DEPTH = 3;

// All RegExp instances are built via the constructor (rather than literal
// `/.../`) so the maintainability engine's AST walker (typhonjs-escomplex) can
// score this file — it crashes on `RegExpLiteral` nodes. Same workaround as
// lib/audit-suite/frontmatter.js.
// biome-ignore-start lint/complexity/useRegexLiterals: typhonjs-escomplex MI workaround
const FRONTMATTER_RE = new RegExp(String.raw`^---\r?\n([\s\S]*?)\r?\n---`);
const NEWLINE_RE = new RegExp(String.raw`\r?\n`);
const MANDATORY_KEY_RE = new RegExp(String.raw`^mandatoryReads\s*:(.*)$`);
const BLOCK_ITEM_RE = new RegExp(String.raw`^\s*-\s*(.+)$`);
const MD_LINK_RE = new RegExp(String.raw`\]\(\s*([^)\s]+)`, 'g');
const COMMAND_H1_RE = new RegExp(String.raw`^#\s+/([A-Za-z0-9._-]+)`, 'm');
// biome-ignore-end lint/complexity/useRegexLiterals: typhonjs-escomplex MI workaround

/**
 * Default fs surface — the same injectable subset `doc-tiers.js` uses.
 * @typedef {{
 *   readdirSync: (p: string, o?: object) => any[],
 *   readFileSync: (p: string, enc: string) => string,
 *   statSync: (p: string) => { size: number },
 * }} FsLike
 */

/**
 * A loaded workflow document.
 * @typedef {{ rel: string, bytes: number, source: string }} WorkflowDoc
 */

/**
 * Strip surrounding quotes and whitespace from a scalar YAML value.
 *
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const t = String(value ?? '').trim();
  const quoted =
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")));
  return quoted ? t.slice(1, -1).trim() : t;
}

/**
 * Convert a path to posix separators.
 *
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Return the raw frontmatter block of a markdown source (`''` when absent).
 *
 * @param {string} source
 * @returns {string}
 */
function frontmatterBlock(source) {
  const m = FRONTMATTER_RE.exec(String(source ?? ''));
  return m ? m[1] : '';
}

/**
 * Collect a YAML block-sequence (`- item`) starting at `start`. Blank lines are
 * skipped; the first non-item, non-blank line ends the sequence.
 *
 * @param {string[]} lines
 * @param {number} start
 * @returns {string[]}
 */
function blockSequence(lines, start) {
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    const item = BLOCK_ITEM_RE.exec(lines[i]);
    if (item) {
      const value = unquote(item[1]);
      if (value) out.push(value);
    } else if (lines[i].trim() !== '') {
      break;
    }
  }
  return out;
}

/**
 * Split a YAML flow sequence (`[a.md, b.md]`) into its scalar items.
 *
 * @param {string} inline
 * @returns {string[]}
 */
function flowSequence(inline) {
  const body = inline.replace('[', '').replace(']', '');
  return body
    .split(',')
    .map(unquote)
    .filter((v) => v.length > 0);
}

/**
 * Parse the optional `mandatoryReads:` frontmatter list from a workflow source.
 * Supports the flow (`[a.md, b.md]`), block (`- a.md` lines), and single-scalar
 * forms. An absent key resolves to `[]` — zero mandatory edges, never an error.
 *
 * @param {string} source
 * @returns {string[]} raw specifiers, relative to the declaring file
 */
function parseMandatoryReads(source) {
  const lines = frontmatterBlock(source).split(NEWLINE_RE);
  const idx = lines.findIndex((line) => MANDATORY_KEY_RE.test(line));
  if (idx < 0) return [];
  const inline = unquote(MANDATORY_KEY_RE.exec(lines[idx])[1]);
  if (inline.startsWith('[')) return flowSequence(inline);
  if (inline.length > 0) return [inline];
  return blockSequence(lines, idx + 1);
}

/**
 * Harvest every markdown link target in a source, anchors stripped.
 *
 * @param {string} source
 * @returns {string[]}
 */
function parseLinkTargets(source) {
  const out = [];
  for (const m of String(source ?? '').matchAll(MD_LINK_RE)) {
    const target = m[1].split('#')[0].trim();
    if (target.length > 0) out.push(target);
  }
  return out;
}

/**
 * Resolve a link/`mandatoryReads` specifier declared in `fromRel` to a known
 * workflow doc, or `null` when it is external, non-markdown, or outside the
 * workflow tree.
 *
 * @param {string} fromRel repo-relative posix path of the declaring file
 * @param {string} spec
 * @param {Map<string, WorkflowDoc>} docs
 * @returns {string | null}
 */
function resolveSpec(fromRel, spec, docs) {
  if (!spec.endsWith('.md')) return null;
  if (spec.includes('://') || spec.startsWith('mailto:')) return null;
  const rel = path.posix.join(path.posix.dirname(fromRel), spec);
  return docs.has(rel) ? rel : null;
}

/**
 * Resolve a workflow's declared mandatory edges. Throws when an entry does not
 * resolve to a workflow markdown file — a mandatory read pointing at nothing is
 * a silent hole in the ratchet, so it fails loudly, naming both the declaring
 * workflow and the offending path.
 *
 * @param {WorkflowDoc} doc
 * @param {Map<string, WorkflowDoc>} docs
 * @returns {string[]}
 */
function mandatoryEdges(doc, docs) {
  const out = [];
  for (const spec of parseMandatoryReads(doc.source)) {
    const rel = resolveSpec(doc.rel, spec, docs);
    if (!rel) {
      throw new Error(
        `[workflow-closure] ${doc.rel} declares mandatoryReads "${spec}", which does not resolve to a markdown file under ${WORKFLOWS_ROOT}`,
      );
    }
    out.push(rel);
  }
  return out;
}

/**
 * Depth-first walk of the mandatory-edge graph. Cycle-fatal: a `mandatoryReads`
 * loop is an authoring error, so it throws naming the cycle rather than looping
 * or silently truncating the closure.
 *
 * @param {string} rel
 * @param {Map<string, WorkflowDoc>} docs
 * @param {string[]} stack in-progress DFS path
 * @param {Set<string>} seen finished nodes
 * @returns {Set<string>} `seen`
 */
function walkMandatory(rel, docs, stack, seen) {
  if (stack.includes(rel)) {
    throw new Error(
      `[workflow-closure] mandatoryReads cycle: ${[...stack, rel].join(' -> ')}`,
    );
  }
  if (seen.has(rel)) return seen;
  seen.add(rel);
  stack.push(rel);
  for (const next of mandatoryEdges(docs.get(rel), docs)) {
    walkMandatory(next, docs, stack, seen);
  }
  stack.pop();
  return seen;
}

/**
 * Breadth-first walk of the markdown-link graph. Cycle-tolerant by design:
 * bidirectional cross-references between a spine and its helper are correct
 * authoring, so the visited set makes the walk terminate with each file counted
 * exactly once.
 *
 * @param {string} rel
 * @param {Map<string, WorkflowDoc>} docs
 * @returns {Set<string>}
 */
function walkReachable(rel, docs) {
  const seen = new Set();
  const queue = [rel];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const spec of parseLinkTargets(docs.get(current).source)) {
      const next = resolveSpec(current, spec, docs);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/**
 * Recursively collect repo-relative posix paths of every `.md` file under an
 * absolute directory. An unreadable directory yields nothing (silent skip).
 *
 * @param {FsLike} fs
 * @param {string} dirAbs
 * @param {string} root
 * @param {string[]} out
 * @returns {string[]} `out`
 */
function listMarkdown(fs, dirAbs, root, out) {
  let dirents;
  try {
    dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const dirent of dirents) {
    const abs = path.join(dirAbs, dirent.name);
    if (dirent.isDirectory()) listMarkdown(fs, abs, root, out);
    else if (dirent.name.endsWith('.md'))
      out.push(toPosix(path.relative(root, abs)));
  }
  return out;
}

/**
 * Load every workflow markdown file into a `rel -> { rel, bytes, source }` map.
 *
 * @param {string} root absolute repo root
 * @param {FsLike} fs
 * @returns {Map<string, WorkflowDoc>}
 */
function loadDocs(root, fs) {
  const dirAbs = path.resolve(root, WORKFLOWS_ROOT);
  const docs = new Map();
  for (const rel of listMarkdown(fs, dirAbs, root, []).sort()) {
    const abs = path.resolve(root, rel);
    try {
      docs.set(rel, {
        rel,
        bytes: fs.statSync(abs).size,
        source: fs.readFileSync(abs, 'utf8'),
      });
    } catch {
      // Unreadable file — skipped silently, like the sibling tier resolvers.
    }
  }
  return docs;
}

/**
 * True when a workflow is invocable in its own right: a top-level workflow, or
 * a helper whose H1 declares a slash command **named after the file itself**
 * (`helpers/deliver-story.md` → `# /deliver-story …`). The self-naming test is
 * what separates an invocable helper from an appendix that merely titles itself
 * after the command it documents (`helpers/deliver-reference.md` →
 * `# /deliver — reference appendix`), which is read on demand, never invoked.
 *
 * @param {WorkflowDoc} doc
 * @returns {boolean}
 */
function isEntryPoint(doc) {
  if (doc.rel.split('/').length === TOP_LEVEL_DEPTH) return true;
  const h1 = COMMAND_H1_RE.exec(doc.source);
  return h1 ? h1[1] === path.posix.basename(doc.rel, '.md') : false;
}

/**
 * Materialize a path set as sorted `{ path, bytes }` entries.
 *
 * @param {Iterable<string>} rels
 * @param {Map<string, WorkflowDoc>} docs
 * @returns {Array<{ path: string, bytes: number }>}
 */
function toEntries(rels, docs) {
  return [...rels]
    .map((rel) => ({ path: rel, bytes: docs.get(rel)?.bytes ?? 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Sum the on-disk bytes of a path set.
 *
 * @param {Iterable<string>} rels
 * @param {Map<string, WorkflowDoc>} docs
 * @returns {number}
 */
function sumBytes(rels, docs) {
  let total = 0;
  for (const rel of rels) total += docs.get(rel)?.bytes ?? 0;
  return total;
}

/**
 * Resolve the workflow tier: every entry point's transitive markdown-link
 * closure, partitioned into the gated mandatory set and the recorded on-demand
 * remainder. Returns empty collections when `.agents/workflows` is absent — an
 * entry point resolving empty is skipped silently.
 *
 * @param {string} root absolute repo root
 * @param {{ fs?: FsLike }} [opts]
 * @returns {{
 *   entryPoints: Array<{ path: string, mandatoryBytes: number, reachableBytes: number }>,
 *   mandatoryFiles: Array<{ path: string, bytes: number }>,
 *   onDemandFiles: Array<{ path: string, bytes: number }>,
 *   mandatoryTotalBytes: number,
 *   reachableTotalBytes: number,
 * }}
 * @throws {Error} on an unresolvable `mandatoryReads` entry or a mandatory cycle
 */
export function resolveWorkflowClosures(root, { fs = nodeFs } = {}) {
  const docs = loadDocs(root, fs);
  const entryPoints = [];
  const mandatoryUnion = new Set();
  const reachableUnion = new Set();

  for (const doc of docs.values()) {
    if (!isEntryPoint(doc)) continue;
    const mandatory = walkMandatory(doc.rel, docs, [], new Set());
    const reachable = walkReachable(doc.rel, docs);
    for (const rel of mandatory) mandatoryUnion.add(rel);
    for (const rel of reachable) reachableUnion.add(rel);
    entryPoints.push({
      path: doc.rel,
      mandatoryBytes: sumBytes(mandatory, docs),
      reachableBytes: sumBytes(reachable, docs),
    });
  }

  const onDemandUnion = [...reachableUnion].filter(
    (rel) => !mandatoryUnion.has(rel),
  );
  return {
    entryPoints: entryPoints.sort((a, b) => a.path.localeCompare(b.path)),
    mandatoryFiles: toEntries(mandatoryUnion, docs),
    onDemandFiles: toEntries(onDemandUnion, docs),
    mandatoryTotalBytes: sumBytes(mandatoryUnion, docs),
    reachableTotalBytes: sumBytes(reachableUnion, docs),
  };
}
