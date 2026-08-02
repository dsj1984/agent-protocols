/**
 * import-graph.js — the shared static-import graph seam (Story #4902).
 *
 * Extracted verbatim from `check-arch-cycles.js`, which owned the only
 * import-graph builder in the repository and kept it private to its own
 * cycle ratchet. A second consumer now needs the same graph for a very
 * different question — `audit-baselines.js` ranks hotspot files by import
 * in-degree — and re-deriving "which module imports which" a second time
 * would guarantee the two answers drift.
 *
 * Note this is a **module** graph, not the task/DAG graph in `lib/Graph.js`;
 * the two are unrelated despite the shared word.
 *
 * The extraction is behaviour-preserving: `check-arch-cycles.js` imports
 * these helpers and re-exports them, so its public surface (and the ratchet's
 * output) is unchanged.
 *
 * @module lib/import-graph
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Default scan roots making up the project's distributed surface — the
 * directories published to npm via `package.json` `files[]`. Resolving
 * them into one graph (relativized against the repo root) means a cycle
 * crossing two roots is visible to consumers of the graph.
 *
 * @type {string[]}
 */
export const DEFAULT_ROOTS = [path.join('.agents', 'scripts'), 'bin', 'lib'];

/**
 * Recursively collect `.js` files under `rootDir`, skipping
 * `node_modules`. Returns absolute paths, sorted for determinism.
 *
 * @param {string} rootDir
 * @returns {string[]}
 */
export function collectJsFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

const IMPORT_RE = /from\s+['"](\.\.?\/[^'"]+\.js)['"]/g;

/**
 * Pure helper: extract relative static-import specifiers from source text.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function parseRelativeImports(source) {
  const specs = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    specs.push(m[1]);
  }
  return specs;
}

/**
 * Build a directed import graph over the given files. Node identity is the
 * file path relative to `rootDir`, posix-separated, so the graph (and any
 * cycles found in it) serializes identically across platforms. Edges that
 * resolve outside the scanned file set are dropped.
 *
 * @param {string[]} files absolute paths
 * @param {string} rootDir
 * @param {{ readFile?: (p: string) => string }} [opts]
 * @returns {Map<string, string[]>}
 */
export function buildGraph(files, rootDir, { readFile } = {}) {
  const read = readFile ?? ((p) => fs.readFileSync(p, 'utf-8'));
  const toId = (abs) => path.relative(rootDir, abs).split(path.sep).join('/');
  const idSet = new Set(files.map(toId));
  const graph = new Map();
  for (const file of files) {
    const id = toId(file);
    let source;
    try {
      source = read(file);
    } catch {
      graph.set(id, []);
      continue;
    }
    const edges = [];
    for (const spec of parseRelativeImports(source)) {
      const target = path
        .relative(rootDir, path.resolve(path.dirname(file), spec))
        .split(path.sep)
        .join('/');
      if (idSet.has(target) && target !== id) edges.push(target);
    }
    graph.set(id, [...new Set(edges)].sort());
  }
  return graph;
}

/**
 * Build the whole-repository import graph by scanning the roots that exist
 * under `cwd`. Returns `null` when none of the roots is present — the
 * "no resolvable import graph" degradation every consumer must tolerate
 * rather than treating an absent graph as a graph with no edges.
 *
 * @param {string} cwd repository root the ids are relativized against
 * @param {{ roots?: string[] }} [opts]
 * @returns {Map<string, string[]> | null}
 */
export function resolveRepoGraph(cwd, { roots = DEFAULT_ROOTS } = {}) {
  const present = roots
    .map((dir) => path.resolve(cwd, dir))
    .filter((dir) => fs.existsSync(dir));
  if (present.length === 0) return null;
  const files = present.flatMap((dir) => collectJsFiles(dir));
  if (files.length === 0) return null;
  return buildGraph(files, path.resolve(cwd));
}

/**
 * Count inbound edges per node. Nodes with no inbound edge are present in
 * the result with a count of 0, so callers never have to distinguish
 * "unknown module" from "module nothing imports".
 *
 * @param {Map<string, string[]> | null} graph
 * @returns {Map<string, number>} empty when `graph` is null
 */
export function computeInDegree(graph) {
  const degrees = new Map();
  if (!graph) return degrees;
  for (const node of graph.keys()) degrees.set(node, 0);
  for (const edges of graph.values()) {
    for (const target of edges) {
      degrees.set(target, (degrees.get(target) ?? 0) + 1);
    }
  }
  return degrees;
}
