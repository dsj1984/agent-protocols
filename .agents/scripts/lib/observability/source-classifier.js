/**
 * source-classifier.js — pure classifier that tags a friction signal
 * record as either `"framework"` (the Mandrel framework itself) or
 * `"consumer"` (the host project that consumes the framework via the
 * materialized `.agents/` directory).
 *
 * Used by `signals-writer.js#appendSignal` so every
 * record in `temp/run-<id>/stories/story-<sid>/signals.ndjson` carries an
 * authoritative `source` field, allowing downstream retro consumers to
 * route framework signals back to mandrel and keep consumer signals in
 * the host project (Epic #2547 / Story #2553).
 *
 * Heuristic (Tech Spec #2550):
 *   - A signal is `"framework"` when its `failingPath` or `command`
 *     mentions any path under the framework's own surface area:
 *       - `.agents/`
 *       - `.agentrc.json`
 *       - `.claude/`
 *       - `node .agents/scripts/`
 *   - Anything else (or empty input) defaults to `"consumer"`. The default
 *     is intentional — most friction comes from consumer code touching
 *     framework tooling, and we'd rather under-tag than mis-route a
 *     consumer signal into the framework retro stream.
 *
 * Story #4824 adds {@link classifySignalSource} alongside it — the
 * record-level entry point the writer now calls, which resolves a
 * runtime-emitted record (no `failingPath`, no `command`) instead of letting
 * the `consumer` default win unconditionally. `classifyPathSource` keeps its
 * two-argument signature and behaviour verbatim.
 *
 * The classifier is pure: no I/O, no logging, no throws on weird input.
 * Callers (the writer) are responsible for swallowing classifier-level
 * faults — but the only way this function can throw is via a programmer
 * error in this file, which would surface during unit testing.
 */

/**
 * Framework prefixes, in declaration order. Order is significant only
 * for documentation purposes — any one match returns `"framework"`.
 *
 * @type {readonly string[]}
 */
const FRAMEWORK_PREFIXES = Object.freeze([
  '.agents/',
  '.agentrc.json',
  '.claude/',
  'node .agents/scripts/',
]);

/**
 * Normalise a value to a string for prefix scanning. Anything that is not
 * a string (undefined, null, numbers, objects) becomes the empty string,
 * which scans clean against every framework prefix.
 *
 * @param {unknown} value
 * @returns {string}
 */
function toScanString(value) {
  if (typeof value !== 'string') return '';
  return value;
}

/**
 * Return true when `haystack` contains any framework prefix as a
 * substring. We use `includes` (not `startsWith`) because a command line
 * like `node .agents/scripts/single-story-init.js` carries the prefix in the
 * middle, and a failing-path like `repo/.agents/foo.js` may carry an
 * absolute prefix.
 *
 * @param {string} haystack
 * @returns {boolean}
 */
function containsFrameworkPrefix(haystack) {
  if (haystack.length === 0) return false;
  for (const prefix of FRAMEWORK_PREFIXES) {
    if (haystack.includes(prefix)) return true;
  }
  return false;
}

/**
 * Classify a friction signal as `"framework"` or `"consumer"`.
 *
 * Both arguments are best-effort: pass whatever the detector already has
 * (the failing file path, the failing command line, or both). When both
 * are empty / non-string, returns `"consumer"` — the safe default for
 * routing.
 *
 * Framework-wins: if either input matches a framework prefix, the result
 * is `"framework"` even when the other input looks consumer-shaped. This
 * matters for mixed cases like a consumer test invoking
 * `node .agents/scripts/single-story-init.js` — that's framework friction even
 * though the failing test path lives under the consumer.
 *
 * @param {unknown} failingPath  The path of the file or directory the
 *                               signal blames (e.g. `"tests/foo.test.js"`).
 * @param {unknown} command       The command line the signal blames
 *                                (e.g. `"node .agents/scripts/single-story-init.js"`).
 * @returns {"framework"|"consumer"}
 */
export function classifyPathSource(failingPath, command) {
  const path = toScanString(failingPath);
  const cmd = toScanString(command);
  if (containsFrameworkPrefix(path)) return 'framework';
  if (containsFrameworkPrefix(cmd)) return 'framework';
  return 'consumer';
}

/**
 * The one friction category that is definitionally a framework-surface
 * failure (Story #4824).
 *
 * Kept as a local literal rather than imported from
 * `RUNTIME_FRICTION_CATEGORIES.TOOL_DEGRADED` because `runtime-friction.js`
 * imports `signals-writer.js`, which imports this module — the import would
 * close a cycle for a single string. The unit test asserts the two spellings
 * agree, so the duplication cannot drift silently.
 *
 * @type {string}
 */
const TOOL_DEGRADED_CATEGORY = 'tool-degraded';

/**
 * Detail keys whose free text names the surface a runtime record blames.
 * Scanned (step 2 below) because a runtime emitter puts the framework path
 * it was executing here, not in `failingPath` / `command`.
 *
 * @type {readonly string[]}
 */
const DETAIL_SCAN_KEYS = Object.freeze(['reason', 'surface', 'phase']);

/**
 * True when `value` is a non-empty string — the test for "the operator (or a
 * detector) actually supplied this field", as opposed to a runtime emitter
 * that leaves it absent.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isSupplied(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Concatenate the scannable free text out of a record's `details` payload.
 *
 * @param {unknown} details
 * @returns {string}
 */
function detailsScanText(details) {
  if (details === null || typeof details !== 'object') return '';
  const record = /** @type {Record<string, unknown>} */ (details);
  const parts = [];
  for (const key of DETAIL_SCAN_KEYS) {
    const value = record[key];
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n');
}

/**
 * Classify a whole signal record as `"framework"` or `"consumer"`
 * (Story #4824).
 *
 * `classifyPathSource` above requires **positive evidence** of a framework
 * prefix in an operator-supplied `failingPath` / `command`. Every
 * runtime-emitted friction record (`runtime-friction.js`) populates neither
 * field, so the `consumer` default always won and the framework limb of the
 * feedback loop was unreachable — 78% of real records mis-tagged.
 *
 * The naive repair — "runtime-emitted means framework" — is measurably
 * **wrong**. `close-failed` records from `single-story-close` carry
 * consumer-owned failures (a base-sync conflict in the consumer's own source
 * tree, a consumer `npm run test:coverage` exiting non-zero); tagging those
 * `framework` would flood the framework repo with consumer test failures,
 * which is worse than the current silence.
 *
 * So the discriminator is resolved in four steps, first match wins:
 *
 * 1. An operator-supplied `failingPath` / `path` / `command` /
 *    `emitter.command` → the existing {@link classifyPathSource} prefix scan,
 *    **unchanged**. A consumer command invoked through `diagnose-friction.js`
 *    stays `consumer`.
 * 2. Else the `details` payload's free text (`reason`, `surface`, `phase`)
 *    naming a framework prefix → `framework`. A runtime emitter blames its
 *    surface here, not in a `command` field.
 * 3. Else `category === "tool-degraded"` → `framework`.
 *    `RUNTIME_FRICTION_CATEGORIES.TOOL_DEGRADED` is defined as a tool that
 *    failed to *execute* — an operational degradation, not a code finding.
 *    The framework's own tooling could not run, which says nothing about
 *    consumer code.
 * 4. Else `consumer` — the existing safe default, unchanged.
 *
 * Steps 1, 2 and 4 leave every currently-exercised input byte-identical;
 * step 3 is the limb that was unreachable. There is deliberately no emitter
 * allowlist: nothing to maintain, nothing to rot.
 *
 * Pure, and never throws — the writer's `tagSignalSource` still guards it.
 *
 * @param {unknown} record One signal record (the `appendSignal` payload).
 * @returns {"framework"|"consumer"}
 */
export function classifySignalSource(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return 'consumer';
  }
  const signal = /** @type {Record<string, unknown>} */ (record);
  const emitter =
    signal.emitter !== null && typeof signal.emitter === 'object'
      ? /** @type {Record<string, unknown>} */ (signal.emitter)
      : null;
  const failingPath = signal.failingPath ?? signal.path;
  const command = signal.command ?? emitter?.command;

  if (isSupplied(failingPath) || isSupplied(command)) {
    return classifyPathSource(failingPath, command);
  }
  if (containsFrameworkPrefix(detailsScanText(signal.details))) {
    return 'framework';
  }
  if (
    typeof signal.category === 'string' &&
    signal.category.trim() === TOOL_DEGRADED_CATEGORY
  ) {
    return 'framework';
  }
  return 'consumer';
}

export const __testing = Object.freeze({
  FRAMEWORK_PREFIXES,
  TOOL_DEGRADED_CATEGORY,
});
