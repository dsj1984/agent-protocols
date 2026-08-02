/**
 * weights.js — the three ranking multipliers, and their degradations
 * (Story #4902).
 *
 * A hotspot's severity says how bad the code measures. These three say how
 * much that badness costs: how often the file changes (churn), how much of
 * the repository depends on it (import in-degree), and how often agents have
 * actually tripped over it (friction signals).
 *
 * All three are **optional inputs**. A shallow clone has no git history, a
 * fresh checkout has no friction ledger, and a consumer whose sources live
 * outside the scanned roots has no resolvable import graph. Each degrades to
 * a neutral multiplier of exactly 1.0 — never 0 (which would erase the
 * hotspot) and never a guess. The engine exits 0 in every degraded case.
 *
 * @module lib/audit-baselines/weights
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { computeInDegree, resolveRepoGraph } from '../import-graph.js';

/** Neutral multiplier every degraded weight collapses to. */
const NEUTRAL_WEIGHT = 1.0;

/**
 * Saturating count → multiplier in `[1, 2)`. Zero observations gives exactly
 * `NEUTRAL_WEIGHT`, so "no signal" and "signal says nothing notable" are the
 * same number — the degradation is indistinguishable from an honest zero,
 * which is the point: neither should move the ranking.
 *
 * @param {number} count
 * @param {number} half count at which the multiplier reaches 1.5
 * @returns {number}
 */
function saturate(count, half) {
  if (!Number.isFinite(count) || count <= 0) return NEUTRAL_WEIGHT;
  return NEUTRAL_WEIGHT + count / (count + half);
}

/**
 * Count commits touching each file in the recent history window.
 *
 * @param {{ cwd: string, windowDays?: number, run?: Function }} args
 * @returns {{ counts: Map<string, number>, degraded: boolean }}
 *   `degraded` is true when git could not answer at all — not a git work
 *   tree, no commits yet, or the binary is unavailable.
 */
export function readChurn({ cwd, windowDays = 180, run = execFileSync }) {
  let stdout;
  try {
    stdout = run(
      'git',
      [
        'log',
        `--since=${windowDays}.days.ago`,
        '--name-only',
        '--pretty=format:',
        '--no-renames',
      ],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // git narrates "not a git repository" on stderr; the degradation is
        // reported in the envelope, not shouted at the operator.
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return { counts: new Map(), degraded: true };
  }
  const counts = new Map();
  for (const line of String(stdout).split('\n')) {
    const file = line.trim();
    if (file.length === 0) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return { counts, degraded: false };
}

/**
 * Import in-degree per module, keyed by repo-relative posix path.
 *
 * @param {{ cwd: string, graph?: Map<string, string[]> | null }} args
 * @returns {{ degrees: Map<string, number>, degraded: boolean }}
 */
export function readCentrality({ cwd, graph }) {
  const resolved = graph === undefined ? resolveRepoGraph(cwd) : graph;
  if (!resolved) return { degrees: new Map(), degraded: true };
  return { degrees: computeInDegree(resolved), degraded: false };
}

/** Path tokens that look like repository files, harvested from signal text. */
const PATH_TOKEN_RE = /[\w@][\w./@-]*\.(?:js|mjs|cjs|ts|tsx|json|md)\b/g;

/**
 * Collect every `signals.ndjson` under `tempRoot`. Absent tree → empty list.
 *
 * @param {string} tempRootAbs
 * @returns {string[]} absolute paths
 */
function findSignalStreams(tempRootAbs) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child, depth + 1);
      else if (entry.name === 'signals.ndjson') out.push(child);
    }
  };
  walk(tempRootAbs, 0);
  return out.sort();
}

/**
 * Count friction signals blaming each file.
 *
 * Signal records carry no dedicated path field — the blamed file surfaces
 * inside free-form `details` / `emitter.command` text — so paths are
 * harvested by token scan over each record's serialized form. A malformed
 * line is skipped, never fatal.
 *
 * @param {{ tempRootAbs: string, kinds?: Set<string> }} args
 * @returns {{ counts: Map<string, number>, degraded: boolean, streams: number }}
 */
export function readFriction({
  tempRootAbs,
  kinds = new Set(['friction', 'hotspot', 'rework', 'churn', 'retry']),
}) {
  const streams = findSignalStreams(tempRootAbs);
  if (streams.length === 0) {
    return { counts: new Map(), degraded: true, streams: 0 };
  }
  const counts = new Map();
  for (const stream of streams) {
    let raw;
    try {
      raw = fs.readFileSync(stream, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!kinds.has(record?.kind)) continue;
      const text =
        JSON.stringify(record.details ?? {}) + (record?.emitter?.command ?? '');
      for (const token of text.match(PATH_TOKEN_RE) ?? []) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  return { counts, degraded: false, streams: streams.length };
}

/**
 * Bundle the three weight lookups into one resolver the hotspot builder can
 * call per cluster id, plus the degradation flags the envelope reports.
 *
 * @param {{
 *   churn: { counts: Map<string, number>, degraded: boolean },
 *   centrality: { degrees: Map<string, number>, degraded: boolean },
 *   friction: { counts: Map<string, number>, degraded: boolean },
 * }} sources
 * @returns {(id: string) => { churnWeight: number, centralityWeight: number, frictionWeight: number }}
 */
export function makeWeightResolver({ churn, centrality, friction }) {
  return (id) => ({
    churnWeight: churn.degraded
      ? NEUTRAL_WEIGHT
      : saturate(churn.counts.get(id) ?? 0, 12),
    centralityWeight: centrality.degraded
      ? NEUTRAL_WEIGHT
      : saturate(centrality.degrees.get(id) ?? 0, 8),
    frictionWeight: friction.degraded
      ? NEUTRAL_WEIGHT
      : saturate(friction.counts.get(id) ?? 0, 4),
  });
}
