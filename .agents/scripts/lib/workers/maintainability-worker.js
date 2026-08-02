/**
 * lib/workers/maintainability-worker.js — CPU-pool worker entry for
 * `calculateAll`. One file in, one score out. No project config, no git,
 * no provider — just typhonjs-escomplex (via maintainability-engine) and
 * the in-memory TS transpile shim.
 *
 * Message contract — see lib/cpu-pool.js:
 *   IN  : { item: string }      — absolute file path to score
 *         { exit: true }        — drain & terminate
 *   OUT : { ok: true, result: { filePath, score, unscorable?, reason? } }
 *
 * `score` is `null` only when the file genuinely cannot be read (ENOENT
 * or other I/O error).
 *
 * A file the kernel cannot analyse comes back as `unscorable: true` with the
 * kernel's own `reason`, rather than as a bare `0`. The `0` is still carried in
 * `score` for wire compatibility, but it is no longer the only signal — the
 * point of the flag is that the caller can *report* the file instead of
 * silently dropping it (see `maintainability-engine.js`'s `UNSCORABLE`).
 */

import { parentPort } from 'node:worker_threads';
import { scoreFile } from '../maintainability-engine.js';
import { serveWorkerMessages } from './serve-worker-messages.js';

/**
 * Pure handler for a single inbound worker message. Exported so unit
 * tests can drive each branch (exit, malformed item, success, error)
 * without spawning a real `Worker` thread.
 *
 * @param {unknown} msg
 * @param {{ score?: (filePath: string) => { score: number, unscorable: boolean, reason: string|null } }} [deps]
 * @returns {{kind: 'exit'} | {kind: 'reply', message: object}}
 */
export function handleMaintainabilityWorkerMessage(msg, deps = {}) {
  if (msg && msg.exit === true) return { kind: 'exit' };

  if (!msg || typeof msg.item !== 'string') {
    return {
      kind: 'reply',
      message: {
        ok: false,
        error: `bad worker message: ${JSON.stringify(msg)}`,
      },
    };
  }
  const filePath = msg.item;
  const scoreFn = deps.score ?? scoreFile;
  try {
    // `scoreFn` returns `{ score, unscorable, reason }` — spread so the flag
    // and its reason reach the pool caller intact.
    return {
      kind: 'reply',
      message: { ok: true, result: { filePath, ...scoreFn(filePath) } },
    };
  } catch (err) {
    // I/O or other unexpected error — surface as a per-item null score
    // so the run keeps going. The pool layer maps this to a missing
    // entry in the final scores map, matching the serial path's
    // existing "log-and-continue" behaviour.
    return {
      kind: 'reply',
      message: {
        ok: true,
        result: {
          filePath,
          score: null,
          error:
            err && typeof err.message === 'string' ? err.message : String(err),
        },
      },
    };
  }
}

serveWorkerMessages(parentPort, (msg) =>
  handleMaintainabilityWorkerMessage(msg),
);
