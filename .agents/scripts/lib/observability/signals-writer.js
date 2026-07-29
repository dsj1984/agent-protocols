/**
 * Append-only signals/trace writer (Epic #1030 Story #1041).
 *
 * Centralizes the per-(epic, story) NDJSON streams under
 * `temp/run-<id>/stories/story-<sid>/signals.ndjson` (and a sibling
 * `traces.ndjson` for trace-shaped records). Detector modules and the
 * runtime trace hook all funnel through this writer so the on-disk
 * shape stays under one schema and one set of robustness guarantees.
 *
 * Robustness contract (Tech Spec #1032 §observability):
 *   - **Best-effort.** Every entry point swallows fs / JSON failures
 *     after logging via `Logger.warn`. Observability MUST NOT take down
 *     the runner — a failed write is a missing signal, not a halted
 *     wave.
 *   - **No buffering.** Each `appendSignal` / `appendTrace` opens the
 *     target file, writes one newline-terminated JSON line, and closes.
 *     The Tech Spec explicitly forbids in-process buffering: detectors
 *     fire from inside per-Story sub-agents that may exit abruptly, and
 *     a buffered tail would silently disappear on `process.exit`.
 *   - **Lazy directory creation.** The first write to a fresh Story
 *     creates `temp/run-<id>/stories/story-<sid>/` via `fs.mkdir(..., { recursive: true })`.
 *     `epicId` / `storyId` are required positive integers — the
 *     `temp-paths.js` helpers assert this before we touch the disk.
 *
 * Reader contract:
 *   - `forEachLine(epicId, storyId, cb)` streams `signals.ndjson` line
 *     by line, parses each line as JSON, and invokes `cb(parsed, lineNumber)`.
 *     Malformed lines are skipped with a `Logger.warn`; a missing file
 *     returns `{ linesRead: 0, linesParsed: 0, missing: true }` rather
 *     than throwing. This matches how the analyzer wants to consume
 *     partial streams from in-flight Stories.
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import {
  resolvedTempRoot,
  SIGNALS_BASENAME,
  STANDALONE_DIRNAME,
  STORIES_DIRNAME,
  signalsFile,
  storyTempDir,
} from '../config/temp-paths.js';
import { Logger } from '../Logger.js';
import { recordSignalReject, validateSignal } from './signal-validator.js';
import { classifySignalSource } from './source-classifier.js';

const TRACES_BASENAME = 'traces.ndjson';

/**
 * Async traces-file path (kept private — consumers thread through
 * `appendTrace`). Mirrors `signalsFile` but with the `traces.ndjson`
 * sibling so the analyzer can scan signals and traces independently.
 */
function tracesFile(eid, sid, config) {
  return path.join(storyTempDir(eid, sid, config), TRACES_BASENAME);
}

/**
 * Best-effort decoration of a signal record with a `source` field
 * (`"framework"` or `"consumer"`) produced by `classifyPathSource`.
 *
 * Post the Epic #4406 cutover `source` is reserved **exclusively** for
 * this framework/consumer classification — a record's originating tool
 * lives in `emitter`, never `source`. That freed the classifier to run
 * for every friction record (pre-cutover a provenance object under the
 * `source` key blocked it via `Object.hasOwn`).
 *
 * Rules:
 *   - If the record is not a plain object (string, number, null,
 *     undefined), return it unchanged.
 *   - If the caller pre-set `source` to exactly `"framework"` or
 *     `"consumer"`, preserve it verbatim — some detectors classify
 *     upstream and we MUST NOT overwrite their intentional tag.
 *   - Otherwise (absent, or any other value — defense in depth against a
 *     stray non-canonical `source`), invoke `classifySignalSource` against
 *     the whole record and inject/overwrite `source` with the result.
 *
 * Story #4824 moved the field extraction into the classifier. The writer
 * used to hand it only `failingPath` / `command`, which meant every
 * runtime-emitted record — which populates neither — took the `consumer`
 * default and the framework limb of the feedback loop was unreachable. The
 * classifier now sees the `category` and `details` it needs to resolve those.
 *
 * @param {unknown} signal
 * @returns {unknown}
 */
function tagSignalSource(signal) {
  if (signal === null || typeof signal !== 'object' || Array.isArray(signal)) {
    return signal;
  }
  const record = /** @type {Record<string, unknown>} */ (signal);
  if (record.source === 'framework' || record.source === 'consumer') {
    return record;
  }
  try {
    return { ...record, source: classifySignalSource(record) };
  } catch (err) {
    Logger.warn(
      `signals-writer: source classifier failed (${
        err instanceof Error ? err.message : String(err)
      }); falling back to original signal without source tag`,
    );
    return signal;
  }
}

/**
 * Validate a record against the canonical `signal-event.schema.json`
 * before it is appended. On failure the record is **dropped** (never
 * appended), a `Logger.warn` names the violating field, and the per-Epic
 * reject tally is incremented under the Epic temp tree. Never throws —
 * the writer's best-effort contract is preserved.
 *
 * @param {unknown} record
 * @param {{ epicId?: number|null, config?: object, label: string }} ctx
 * @returns {Promise<boolean>} true when the record is valid (safe to append).
 */
async function validateOrDrop(record, { epicId, config, label }) {
  const { valid, violatingField, message } = validateSignal(record);
  if (valid) return true;
  Logger.warn(
    `signals-writer: dropping schema-invalid ${label} record — violating field '${violatingField}' (${message}).`,
  );
  await recordSignalReject({ epicId, config, field: violatingField });
  return false;
}

/**
 * Best-effort append of a single record as one newline-terminated JSON
 * line. Caller-supplied record must be JSON-serialisable; circular refs
 * or BigInt fields are reported via `Logger.warn` and dropped.
 *
 * @param {string} targetPath
 * @param {unknown} record
 * @returns {Promise<boolean>} true on success, false on any swallowed failure.
 */
async function appendOne(targetPath, record) {
  let line;
  try {
    line = `${JSON.stringify(record)}\n`;
  } catch (err) {
    Logger.warn(
      `signals-writer: failed to serialise record for ${targetPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.appendFile(targetPath, line, 'utf8');
    return true;
  } catch (err) {
    Logger.warn(
      `signals-writer: append failed for ${targetPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

/**
 * Append one signal record to `temp/run-<id>/stories/story-<sid>/signals.ndjson`.
 *
 * The `signal` is written verbatim — callers (detectors) own its shape
 * (kind, severity, message, etc.). The writer adds nothing. Errors are
 * logged via `Logger.warn` and never thrown.
 *
 * @param {{ epicId: number, storyId: number, signal: unknown, config?: object }} args
 * @returns {Promise<boolean>}
 */
export async function appendSignal(args) {
  const { epicId, storyId, signal, config } = args ?? {};
  let target;
  try {
    target = signalsFile(epicId, storyId, config);
  } catch (err) {
    Logger.warn(
      `signals-writer: invalid epicId/storyId for appendSignal: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
  const tagged = tagSignalSource(signal);
  const ok = await validateOrDrop(tagged, {
    epicId: Number.isInteger(epicId) ? epicId : null,
    config,
    label: 'signal',
  });
  if (!ok) return false;
  return appendOne(target, tagged);
}

/**
 * Append one trace record to `temp/run-<id>/stories/story-<sid>/traces.ndjson`.
 * Same robustness contract as `appendSignal` — never throws.
 *
 * @param {{ epicId: number, storyId: number, trace: unknown, config?: object }} args
 * @returns {Promise<boolean>}
 */
export async function appendTrace(args) {
  const { epicId, storyId, trace, config } = args ?? {};
  let target;
  try {
    target = tracesFile(epicId, storyId, config);
  } catch (err) {
    Logger.warn(
      `signals-writer: invalid epicId/storyId for appendTrace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
  const ok = await validateOrDrop(trace, {
    epicId: Number.isInteger(epicId) ? epicId : null,
    config,
    label: 'trace',
  });
  if (!ok) return false;
  return appendOne(target, trace);
}

/**
 * Stream any NDJSON `target` file line by line, invoking
 * `cb(parsed, lineNumber)` for each successfully parsed JSON line.
 * `lineNumber` is 1-based to match operator log expectations. Malformed
 * lines are skipped with a `Logger.warn`. A missing file resolves with
 * `missing: true` rather than throwing.
 *
 * Shared spine for `forEachLine`
 * (per-Epic stream) so the two readers cannot drift in their
 * malformed-line / missing-file / cb-throw handling.
 *
 * @param {string} target
 * @param {(parsed: unknown, lineNumber: number) => unknown | Promise<unknown>} cb
 * @param {string} label   Reader name used in warn messages.
 * @returns {Promise<{ linesRead: number, linesParsed: number, missing: boolean }>}
 */
async function forEachLineIn(target, cb, label) {
  try {
    await fs.access(target);
  } catch {
    return { linesRead: 0, linesParsed: 0, missing: true };
  }

  let linesRead = 0;
  let linesParsed = 0;
  const stream = createReadStream(target, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const rawLine of rl) {
      linesRead += 1;
      // Skip empty lines (trailing newline at EOF, accidental blanks).
      if (rawLine.length === 0) continue;
      let parsed;
      try {
        parsed = JSON.parse(rawLine);
      } catch (err) {
        Logger.warn(
          `signals-writer: malformed JSON at ${target}:${linesRead} (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
        continue;
      }
      linesParsed += 1;
      try {
        await cb(parsed, linesRead);
      } catch (err) {
        Logger.warn(
          `signals-writer: ${label} cb threw at ${target}:${linesRead}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  } catch (err) {
    Logger.warn(
      `signals-writer: ${label} read failed for ${target}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return { linesRead, linesParsed, missing: false };
}

/**
 * Stream a per-Story `signals.ndjson` line by line, invoking
 * `cb(parsed, lineNumber)` for each successfully parsed JSON line. A
 * missing file resolves with `missing: true` rather than throwing — the
 * analyzer treats absence as "no signals yet" and keeps walking.
 *
 * @param {number} epicId
 * @param {number} storyId
 * @param {(parsed: unknown, lineNumber: number) => unknown | Promise<unknown>} cb
 * @param {object} [config]
 * @returns {Promise<{ linesRead: number, linesParsed: number, missing: boolean }>}
 */
export async function forEachLine(epicId, storyId, cb, config) {
  if (typeof cb !== 'function') {
    Logger.warn('signals-writer: forEachLine called without a callback');
    return { linesRead: 0, linesParsed: 0, missing: false };
  }

  let target;
  try {
    target = signalsFile(epicId, storyId, config);
  } catch (err) {
    Logger.warn(
      `signals-writer: invalid epicId/storyId for forEachLine: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { linesRead: 0, linesParsed: 0, missing: false };
  }

  return forEachLineIn(target, cb, 'forEachLine');
}

/** Matches an Epic run directory (`run-<eid>`) directly under `tempRoot`. */
const RUN_DIR_RE = /^run-\d+$/;

/** Matches a per-Story directory (`story-<sid>`) under a `stories/` parent. */
const STORY_DIR_RE = /^story-(\d+)$/;

/**
 * List directory entries, or `[]` when the directory is absent/unreadable.
 * Absence is the common case (a fresh checkout has no temp tree at all) and
 * must not throw — the discovery walk feeds a roll-up that may not fail the
 * land.
 *
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function readDirEntries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Discover every per-Story `signals.ndjson` surviving under the configured
 * temp root (Story #4824).
 *
 * Both canonical layouts are walked — `<tempRoot>/standalone/stories/story-<sid>/`
 * (v2 standalone Stories, where every close writes) and
 * `<tempRoot>/run-<eid>/stories/story-<sid>/` (Epic-attached streams). The
 * walk is the **recurrence window** the follow-up composer reduces over: a
 * defect that fires exactly once per Story is invisible inside a single
 * Story's stream and only becomes a recurrence across the surviving ones.
 *
 * Sorted by absolute path so a given tree always yields the same order and
 * the composed proposals stay byte-identical.
 *
 * @param {object} [config]
 * @returns {Promise<Array<{ storyId: number, file: string }>>}
 */
async function listStorySignalStreams(config) {
  let root;
  try {
    root = resolvedTempRoot(config);
  } catch (err) {
    Logger.warn(
      `signals-writer: cannot resolve tempRoot for stream discovery: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  const storiesDirs = [];
  for (const entry of await readDirEntries(root)) {
    if (!entry.isDirectory()) continue;
    if (entry.name !== STANDALONE_DIRNAME && !RUN_DIR_RE.test(entry.name)) {
      continue;
    }
    storiesDirs.push(path.join(root, entry.name, STORIES_DIRNAME));
  }

  const streams = [];
  for (const storiesDir of storiesDirs) {
    for (const entry of await readDirEntries(storiesDir)) {
      if (!entry.isDirectory()) continue;
      const match = STORY_DIR_RE.exec(entry.name);
      if (match === null) continue;
      streams.push({
        storyId: Number(match[1]),
        file: path.join(storiesDir, entry.name, SIGNALS_BASENAME),
      });
    }
  }
  return streams.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Stream **every** surviving per-Story `signals.ndjson` under the configured
 * temp root, invoking `cb(parsed, context)` per parsed row (Story #4824).
 *
 * `context` carries `{ storyId, file, lineNumber }` — `storyId` is the
 * **stream owner** (from the directory name), used only as the fallback when
 * a row carries no `storyId` of its own; `file` + `lineNumber` identify the
 * physical row, which is what lets a caller de-duplicate a legacy row that
 * predates `eventId`.
 *
 * Same robustness contract as `forEachLine`: a missing tree, an unreadable
 * directory, a malformed line, or a throwing callback each degrade to a
 * warning rather than a rejection.
 *
 * @param {(parsed: unknown, context: { storyId: number, file: string, lineNumber: number }) => unknown | Promise<unknown>} cb
 * @param {object} [config]
 * @returns {Promise<{ streams: number, linesParsed: number }>}
 */
export async function forEachSignalStreamLine(cb, config) {
  if (typeof cb !== 'function') {
    Logger.warn(
      'signals-writer: forEachSignalStreamLine called without a callback',
    );
    return { streams: 0, linesParsed: 0 };
  }
  const streams = await listStorySignalStreams(config);
  let linesParsed = 0;
  for (const { storyId, file } of streams) {
    const result = await forEachLineIn(
      file,
      (parsed, lineNumber) => cb(parsed, { storyId, file, lineNumber }),
      'forEachSignalStreamLine',
    );
    linesParsed += result.linesParsed;
  }
  return { streams: streams.length, linesParsed };
}
