/**
 * outliers.js — bounded top-N outlier extraction per gate (Story #4902).
 *
 * `baselines/crap.json` alone is ~650KB of per-method rows. The engine must
 * never embed a whole baseline in its envelope, so every kind is narrowed to
 * at most `topN` rows here, before anything downstream sees them.
 *
 * Narrowing happens in two steps:
 *
 *   1. **Aggregate to the cluster grain.** Baseline rows are per-method
 *      (crap) or per-symbol (dead exports); hotspots are per-file. Each id
 *      keeps its single worst value, plus how many rows it contributed.
 *   2. **Score, then cut.** `severityWeight` is the row's position in its
 *      own kind's distribution, from 0 (the best value present) to 1 (the
 *      worst). Scoring within the kind is what makes CRAP 29 and MI 74
 *      comparable at all — the two axes share no unit, and the whole point
 *      of a cluster is to add them up.
 *
 * @module lib/audit-baselines/outliers
 */

import { KIND_SPECS } from './kinds.js';

/** Default bound on rows extracted per gate. */
export const DEFAULT_TOP_N = 20;

/**
 * Fold `{ id, value }` rows to one entry per id, keeping the worst value.
 *
 * @param {Array<{ id: string, value: number }>} rows
 * @param {'higher' | 'lower'} worse
 * @returns {Array<{ id: string, value: number, rowCount: number }>}
 */
function aggregateById(rows, worse) {
  const byId = new Map();
  for (const { id, value } of rows) {
    const prev = byId.get(id);
    if (prev === undefined) {
      byId.set(id, { id, value, rowCount: 1 });
      continue;
    }
    prev.rowCount += 1;
    const isWorse =
      worse === 'higher' ? value > prev.value : value < prev.value;
    if (isWorse) prev.value = value;
  }
  return [...byId.values()];
}

/**
 * Position of `value` in `[min, max]` normalized so 1 is always the worst
 * end. A degenerate distribution (every value identical) scores 1 for every
 * row: they are all equally the worst, and equally the best.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {'higher' | 'lower'} worse
 * @returns {number} 0..1
 */
function normalizeSeverity(value, min, max, worse) {
  if (!(max > min)) return 1;
  const ratio = (value - min) / (max - min);
  return worse === 'higher' ? ratio : 1 - ratio;
}

/**
 * Extract the bounded worst-N rows for one kind.
 *
 * @param {{ kind: string, baseline: object | null, topN?: number }} args
 * @returns {Array<{
 *   kind: string, id: string, metric: string, value: number,
 *   rowCount: number, severityWeight: number,
 * }>} worst first
 */
export function extractOutliers({ kind, baseline, topN = DEFAULT_TOP_N }) {
  const spec = KIND_SPECS[kind];
  if (!spec || !baseline) return [];
  const aggregated = aggregateById(spec.rows(baseline), spec.worse);
  if (aggregated.length === 0) return [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of aggregated) {
    if (row.value < min) min = row.value;
    if (row.value > max) max = row.value;
  }
  return aggregated
    .map((row) => ({
      kind,
      id: row.id,
      metric: spec.metric,
      value: row.value,
      rowCount: row.rowCount,
      severityWeight: normalizeSeverity(row.value, min, max, spec.worse),
    }))
    .sort(
      (a, b) => b.severityWeight - a.severityWeight || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, topN));
}
