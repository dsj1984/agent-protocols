/**
 * trend.js — per-kind rollup deltas read out of each baseline file's own git
 * history (Story #4902).
 *
 * A ratchet only tells you whether today is worse than yesterday. The
 * question a baseline review asks is the other one: which direction has this
 * number been moving, and is the ratchet actually ratcheting? That answer is
 * already committed — every baseline refresh is a commit against the same
 * path — so it is read with `git log` + `git show`, never recomputed by
 * re-running an instrument.
 *
 * Degradation: any git failure (shallow clone, no history for the path, not
 * a work tree) yields an empty `trend[]` and exit 0. A missing history is
 * missing evidence, not an error.
 *
 * @module lib/audit-baselines/trend
 */

import { execFileCapture } from '../child-exec.js';
import { trendRollupOf } from './kinds.js';

/**
 * List the most recent commits touching `relPath`, newest first.
 *
 * @param {{ cwd: string, relPath: string, limit: number, run?: Function }} args
 * @returns {Array<{ sha: string, committedAt: string }>}
 */
function listCommits({ cwd, relPath, limit, run }) {
  let stdout;
  try {
    stdout = execFileCapture(
      'git',
      ['log', `-n${limit}`, '--format=%H %cI', '--', relPath],
      { run, cwd, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return [];
  }
  return String(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(' '))
    .map((line) => {
      const [sha, committedAt] = line.split(' ');
      return { sha, committedAt };
    });
}

/**
 * Read the comparable rollup of a baseline as it existed at `sha`.
 *
 * @param {{ cwd: string, kind: string, sha: string, relPath: string, run?: Function }} args
 * @returns {object | null}
 */
function rollupAt({ cwd, kind, sha, relPath, run }) {
  let stdout;
  try {
    stdout = execFileCapture('git', ['show', `${sha}:${relPath}`], {
      run,
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  try {
    return trendRollupOf(kind, JSON.parse(stdout));
  } catch {
    return null;
  }
}

/**
 * Numeric axis-by-axis difference `to - from`. Axes missing from either side
 * are omitted rather than defaulted — a rollup that gained an axis has no
 * delta on it, and inventing one would read as a regression.
 *
 * @param {object} from
 * @param {object} to
 * @returns {Record<string, number>}
 */
function rollupDelta(from, to) {
  const deltas = {};
  for (const [axis, current] of Object.entries(to ?? {})) {
    const previous = from?.[axis];
    if (typeof current === 'number' && typeof previous === 'number') {
      deltas[axis] = current - previous;
    }
  }
  return deltas;
}

/**
 * Build the `trend[]` section: newest-vs-previous rollup deltas per kind.
 *
 * @param {{
 *   cwd: string, kinds: string[], pathFor: (kind: string) => string,
 *   depth?: number, run?: Function,
 * }} args
 * @returns {Array<object>}
 */
export function buildTrend({ cwd, kinds, pathFor, depth = 5, run }) {
  const out = [];
  for (const kind of kinds) {
    const relPath = pathFor(kind);
    const commits = listCommits({ cwd, relPath, limit: depth, run });
    const samples = [];
    for (const commit of commits) {
      const rollup = rollupAt({ cwd, kind, sha: commit.sha, relPath, run });
      if (rollup) samples.push({ ...commit, rollup });
    }
    if (samples.length < 2) continue;
    const [current, previous] = samples;
    out.push({
      kind,
      baselinePath: relPath,
      sampleCount: samples.length,
      from: { sha: previous.sha, committedAt: previous.committedAt },
      to: { sha: current.sha, committedAt: current.committedAt },
      deltas: rollupDelta(previous.rollup, current.rollup),
    });
  }
  return out;
}
