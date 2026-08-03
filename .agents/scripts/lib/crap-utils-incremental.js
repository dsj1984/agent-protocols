/**
 * crap-utils-incremental.js — small pure helpers that wire the incremental
 * CRAP join (Story #4981) into `crap-utils.js#scanAndScore`'s per-file work
 * queue. Split into their own file so the wiring lands as new code rather
 * than a same-file expansion of `scanAndScore` / `scoreFileSerial`.
 */
import { indexBaselineRowsByFile } from './crap-baseline-index.js';

/**
 * Resolve `scanAndScore`'s `incremental` option into the two lookup
 * structures the per-file queue build needs. Both are `null` when
 * `incremental` is absent (full-scope, the default) — every downstream
 * consumer treats a `null` context as "not incremental".
 *
 * @param {{ touchedFiles?: Set<string>|string[], baselineRows?: Array<object> } | null} incremental
 * @returns {{ touchedFiles: Set<string>|null, baselineByFile: Map<string, Map<string, object>>|null }}
 */
export function resolveIncrementalContext(incremental) {
  const touchedFiles = incremental?.touchedFiles
    ? incremental.touchedFiles instanceof Set
      ? incremental.touchedFiles
      : new Set(incremental.touchedFiles)
    : null;
  const baselineByFile = incremental
    ? indexBaselineRowsByFile(incremental.baselineRows)
    : null;
  return { touchedFiles, baselineByFile };
}

/**
 * Merge one queued file's `touched` flag and per-file `baselineByKey` map
 * (resolved from the `resolveIncrementalContext` output) onto its base queue
 * item. `touched` defaults to `true` (every file is "touched" outside
 * incremental mode, matching
 * `crap-baseline-join.js#finalizeMethodRowsWithBaseline`'s own default).
 *
 * @param {object} item Base queue item (`{ abs, relPath, requireCoverage, coverageAvailable }`).
 * @param {{ touchedFiles: Set<string>|null, baselineByFile: Map<string, Map<string, object>>|null }} ctx
 * @returns {object} `item` plus `{ touched, baselineByKey }`.
 */
export function resolveQueueIncrementalFields(
  item,
  { touchedFiles, baselineByFile },
) {
  const touched = touchedFiles ? touchedFiles.has(item.relPath) : true;
  const baselineByKey = baselineByFile
    ? (baselineByFile.get(item.relPath) ?? new Map())
    : null;
  return { ...item, touched, baselineByKey };
}

/**
 * True when `scoreFileSerial` should resolve a file's methods from the
 * baseline rather than requiring a fresh coverage entry — an untouched file
 * with at least one indexed baseline row.
 *
 * @param {boolean} touched
 * @param {Map<string, object>|null} baselineByKey
 * @returns {boolean}
 */
function isIncrementalJoinActive(touched, baselineByKey) {
  return !touched && baselineByKey != null && baselineByKey.size > 0;
}

/**
 * `scoreFileSerial`'s file-level skip decision, factored out whole so the
 * incremental exception lives with the rest of this Story's branching
 * rather than inflating the cyclomatic complexity of the pre-#4981 caller.
 *
 * @param {boolean} requireCoverage
 * @param {object|null} entry Istanbul coverage entry for this file.
 * @param {boolean} touched
 * @param {Map<string, object>|null} baselineByKey
 * @returns {boolean}
 */
export function shouldSkipFileForNoCoverage(
  requireCoverage,
  entry,
  touched,
  baselineByKey,
) {
  return (
    requireCoverage &&
    entry === null &&
    !isIncrementalJoinActive(touched, baselineByKey)
  );
}

/**
 * `scanAndScore`'s serial-vs-pool routing decision. Incremental mode always
 * routes serial (see `isIncrementalJoinActive`'s doc for why the baseline
 * lookup Maps don't cross the worker boundary); otherwise unchanged from the
 * pre-#4981 queue-length cutover.
 *
 * @param {number} queueLength
 * @param {unknown} incremental
 * @param {number} serialThreshold
 * @returns {boolean}
 */
export function shouldRunSerial(queueLength, incremental, serialThreshold) {
  return queueLength < serialThreshold || Boolean(incremental);
}

/**
 * Project the `resolvedFromBaseline` marker onto a `scanAndScore` result row
 * — present only when true, so a full-scope scan's rows are unaffected.
 *
 * @param {{ resolvedFromBaseline?: boolean }} mr
 * @returns {{ resolvedFromBaseline: true } | {}}
 */
export function resolvedFromBaselineFlag(mr) {
  return mr.resolvedFromBaseline === true ? { resolvedFromBaseline: true } : {};
}
