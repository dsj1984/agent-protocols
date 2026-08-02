/**
 * lib/workers/combined-mi-crap-worker.js — CPU-pool worker entry for the
 * combined MI + CRAP single-pass scan (`scanAndScoreCombined`).
 *
 * One file in, BOTH the maintainability score and the per-method CRAP rows
 * out — derived from a SINGLE `escomplex.analyzeModule` parse via
 * `analyzeOnce`. This collapses the two independent worker-pool passes the
 * full-tree baseline regenerator used to run (the MI worker parsed the AST
 * once for the module score, the CRAP worker parsed the same file's AST
 * again for the method rows) into one parse per file.
 *
 * The MI score and the CRAP rows have independent skip policies, mirroring
 * the two separate passes this worker replaces:
 *   - **MI** never requires coverage. The module score is emitted for every
 *     file that reads + transpiles + parses. A read failure yields
 *     `miScore: null` (the host drops the file from the MI map, matching
 *     `calculateAll`'s `score === null` filter). A transpile failure or a
 *     parse error yields `miScore: 0` (matching `calculateForFile` /
 *     `calculateForSource`, which return 0 on transpile-null / parse-error).
 *   - **CRAP** honours `requireCoverage`. A file with no coverage entry is
 *     reported as `skippedFileNoCoverage: true` (the host increments its own
 *     counter and emits no CRAP rows for it) — but the MI score is STILL
 *     computed and returned, because the MI pass would have scored it.
 *
 * Message contract — see lib/cpu-pool.js:
 *   IN  : { item: { abs: string, relPath: string, requireCoverage: boolean,
 *                   coverageAvailable?: boolean, coverageEntry: object | null } }
 *         { exit: true }
 *   OUT : { ok: true, result: {
 *           relPath,
 *           miScore: number | null,
 *           skippedFileNoCoverage: boolean,
 *           crapRows: Array<{ method, startLine, cyclomatic, coverage, crap }> | null,
 *           skippedMethodsNoCoverage: number,
 *           hasCoverageEntry: boolean,
 *           resolvedMethods: number,
 *           totalMethods: number,
 *         } }
 *
 * A read/transpile/parse failure surfaces as `crapRows: null` so the host
 * loop drops the file's CRAP contribution (matching the crap-worker's
 * `rows: null` contract) — never aborts the whole scan. On a read failure
 * `miScore` is `null`; on a transpile/parse failure `miScore` is `0`.
 */

import { parentPort } from 'node:worker_threads';
import { finalizeMethodRows } from '../crap-engine.js';
import { analyzeOnce } from '../crap-utils.js';
import { prepareSourceForScoring } from '../transpile.js';
import { serveWorkerMessages } from './serve-worker-messages.js';

/**
 * Pure handler for a single inbound worker message. Exported so unit tests
 * can exercise every branch (bad-shape rejection, coverage gate, read /
 * transpile / parse failures, success rows, skipped methods, and the
 * MI-computed-even-when-coverage-skipped invariant) without spawning a real
 * `Worker` thread.
 *
 * Side effects (fs, transpile, analyzeOnce) are wired through `deps` so
 * tests pass deterministic stubs.
 *
 * @param {unknown} msg
 * @param {{
 *   readFile?: (abs: string) => string,
 *   transpile?: (abs: string, source: string, opts?: object) => unknown,
 *   prepare?: (abs: string, deps: object) => object,
 *   analyze?: (source: string, entry: object|null, mapLine: Function|null) => {
 *     miScore: number,
 *     crapRows: Array<object>,
 *     parseError: boolean,
 *   },
 * }} [deps]
 * @returns {{kind: 'exit'} | {kind: 'reply', message: object}}
 */
export function handleCombinedMiCrapWorkerMessage(msg, deps = {}) {
  if (msg && msg.exit === true) return { kind: 'exit' };

  const item = msg?.item;
  if (
    !item ||
    typeof item.abs !== 'string' ||
    typeof item.relPath !== 'string'
  ) {
    return {
      kind: 'reply',
      message: {
        ok: false,
        error: `bad worker message: ${JSON.stringify(msg)}`,
      },
    };
  }
  const { abs, relPath, requireCoverage, coverageAvailable = true } = item;
  const prepare = deps.prepare ?? prepareSourceForScoring;
  const analyze = deps.analyze ?? analyzeOnce;

  // Coverage entry is pre-resolved on the host and attached to the item.
  // `item.coverageEntry` may be explicitly `null` when the file has no
  // coverage, or `undefined` when the caller did not supply it (treat as null).
  const entry = item.coverageEntry ?? null;

  const reply = (result) => ({
    kind: 'reply',
    message: {
      ok: true,
      result: {
        relPath,
        skippedFileNoCoverage: false,
        skippedMethodsNoCoverage: 0,
        hasCoverageEntry: entry !== null,
        resolvedMethods: 0,
        totalMethods: 0,
        ...result,
      },
    },
  });

  // Read + transpile once, carrying the transpiled -> original-source line
  // map the per-method coverage join needs (Story #4775). A read failure
  // means neither MI nor CRAP can be computed (MI drops as null, matching
  // `calculateAll`'s filter); a transpile failure scores MI 0 (matching
  // `calculateForFile`). CRAP drops the file either way.
  const prepared = prepare(abs, deps);
  if (prepared.error) {
    return reply({
      miScore: prepared.error === 'read' ? null : 0,
      crapRows: null,
    });
  }

  // ONE parse: analyzeOnce derives both the module MI score and the raw
  // per-method CRAP rows from a single escomplex report. On a parse error it
  // returns miScore 0 and an empty crapRows with parseError true.
  const {
    miScore,
    crapRows: rawCrapRows,
    parseError,
  } = analyze(prepared.code, entry, prepared.mapLine);
  if (parseError) {
    // Parse error: MI scores 0 (parity with calculateForSource's catch ->
    // returns 0), CRAP drops the file (rows null, parity with the crap
    // worker's calculateCrap-throw branch).
    return reply({ miScore: 0, crapRows: null });
  }

  // CRAP coverage gate runs AFTER the parse so the MI score is always
  // available. When the file has no coverage under requireCoverage, the CRAP
  // pass would have skipped it at the file level (no rows, counted) — but the
  // MI pass would still have scored it, so miScore is returned regardless.
  if (requireCoverage && entry === null) {
    return reply({ miScore, skippedFileNoCoverage: true, crapRows: [] });
  }

  const { rows, skippedMethodsNoCoverage, resolvedMethods, totalMethods } =
    finalizeMethodRows(rawCrapRows, {
      requireCoverage,
      coverageAvailable,
    });
  return reply({
    miScore,
    crapRows: rows,
    skippedMethodsNoCoverage,
    resolvedMethods,
    totalMethods,
  });
}

serveWorkerMessages(parentPort, (msg) =>
  handleCombinedMiCrapWorkerMessage(msg),
);
