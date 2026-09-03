/**
 * lib/cpu-pool.js — Generic worker_threads pool for CPU-bound work.
 *
 * `runOnPool(workerScript, items, opts)` spawns up to
 * `resolvePoolConcurrency(opts.concurrency)` persistent workers — an
 * explicit option, else `MANDREL_POOL_CONCURRENCY`, else a clamp of 4 under
 * `node:test`, else `os.availableParallelism()` —
 * dispatches `items` to whichever worker is idle, and resolves with an
 * array of per-item results in input order. The queue is bounded by
 * worker count — we only have N items in flight at once, where N =
 * concurrency, so back-pressure is implicit.
 *
 * Determinism:
 *   - The returned `results` array is indexed by input position. Workers
 *     race on dispatch but each result lands at its source index, so
 *     callers that need deterministic output order can either consume
 *     `results` directly (already in input order) or apply a stable
 *     sort by file path / id of their choosing after the pool drains.
 *
 * Failure handling:
 *   - The worker contract is: emit `{ ok: true, result }` per item, or
 *     `{ ok: false, error: string }` for a per-item failure. The default
 *     is to capture per-item failures as `{ __cpuPoolError: true,
 *     message }` entries at the corresponding result index so one bad
 *     input does not abort the run. Pass `opts.throwOnItemError === true`
 *     (an explicit `true`, not just truthy) to flip to the abort-on-first
 *     mode, which rejects the whole `runOnPool` call.
 *   - A worker that crashes (`error` event) or exits non-zero rejects
 *     the whole pool — that is not a per-item failure, it is a host-level
 *     fault and must surface.
 *
 * Worker-side contract:
 *   - The worker entry receives `workerData` (passed once at spawn).
 *   - It listens on `parentPort` for messages of shape `{ item }` for
 *     work dispatch, or `{ exit: true }` to drain and exit cleanly.
 *   - It must `parentPort.postMessage({ ok, result | error })` exactly
 *     once per `{ item }` it receives.
 *
 * No project config or git access is loaded here — the pool itself is
 * a thin scheduler so workers stay cheap to spawn.
 *
 * Worker injection (testability):
 *   - The worker handle is produced by `opts.workerFactory(script, options)`,
 *     defaulting to `(script, options) => new Worker(script, options)`. The
 *     factory must return an EventEmitter-shaped handle exposing the subset
 *     of the `worker_threads.Worker` surface the scheduler uses: `on`,
 *     `off`, `once`, `postMessage`, and a thenable `terminate()`. Injecting
 *     a synchronous fake factory lets unit tests drive the scheduling,
 *     ordering, and exit-race branches in-process without spawning a real
 *     OS thread.
 */

import os from 'node:os';
import { Worker } from 'node:worker_threads';

/** Default factory: spawn a real `worker_threads.Worker`. */
const defaultWorkerFactory = (script, options) => new Worker(script, options);

/**
 * Pool-vs-serial cutover for `runOnPool` callers.
 *
 * Below this batch size the pool's worker spawn overhead dominates, so
 * callers fall back to in-process serial scoring. Single-sourced here so the
 * maintainability baseline scan (`maintainability-utils.js`), the CRAP
 * scanner (`crap-utils.js`), and the native review provider
 * (`review-providers/native.js`) cannot silently desynchronize on a retune.
 *
 * **Retuned from 8 to 256 in Story #5109.** The original 8 was set against
 * tmpdir fixtures and never measured against a real batch, so every
 * pre-commit preview — the most frequent path in the framework — paid for a
 * pool it could not amortise. Measured on this repository (18 logical cores,
 * `.agents/scripts` + `bin` + `lib`, MI scoring):
 *
 * ```text
 *   n=16   serial  125 ms   pooled  444 ms
 *   n=64   serial  175 ms   pooled  535 ms
 *   n=128  serial  241 ms   pooled  422 ms
 *   n=256  serial  440 ms   pooled  707 ms   <- still serial-favourable
 *   n=384  serial  943 ms   pooled  782 ms   <- crossover
 *   n=619  serial 1054 ms   pooled  710 ms
 * ```
 *
 * The crossover sits between 256 and 384, so 256 is the last power-of-two
 * step the serial path provably wins. A whole-tree baseline refresh
 * (n≈619) still takes the pool; a diff-scoped preview (n≈50) no longer
 * spawns a worker at all. Scoring output is identical on either path — the
 * worker runs the same scorer — so this is a cost retune, never a verdict
 * change.
 */
export const POOL_SERIAL_THRESHOLD = 256;

/**
 * Hard ceiling on pool width when the process is a `node:test` child.
 *
 * Node's test runner already fans test *files* out across processes, so a
 * pool inside one of them multiplies against that fan-out and can oversubscribe
 * the host by an order of magnitude. Four is wide enough to keep the pooled
 * code path genuinely concurrent (so the scheduling branches under test stay
 * exercised) without letting a suite of parallel test processes each claim
 * every core.
 */
const NODE_TEST_CONCURRENCY_CLAMP = 4;

/**
 * True when this process was spawned by Node's own test runner, which sets
 * `NODE_TEST_CONTEXT` in every test child.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function inNodeTestContext(env) {
  return (
    typeof env.NODE_TEST_CONTEXT === 'string' && env.NODE_TEST_CONTEXT !== ''
  );
}

/**
 * Resolve the requested pool width, in strict precedence order:
 *
 *   1. an explicit `opts.concurrency` — the caller knows its own budget;
 *   2. `MANDREL_POOL_CONCURRENCY` — the operator/CI override, so a
 *      constrained runner can bound every pool in the process tree at once;
 *   3. `NODE_TEST_CONCURRENCY_CLAMP` when running under `node:test`;
 *   4. `os.availableParallelism()`.
 *
 * Only *finite, positive* values are honoured at each step; anything else
 * falls through to the next, so a typo in the env var degrades to the
 * default rather than collapsing the pool to a single worker.
 *
 * Module-private on purpose: `runOnPool` is the only caller, and the
 * precedence is pinned through its observable worker count rather than by
 * an export whose sole importer would be a test.
 *
 * @param {number|undefined} explicit
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function resolvePoolConcurrency(explicit, env = process.env) {
  const positive = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  };
  return (
    positive(explicit) ??
    positive(env.MANDREL_POOL_CONCURRENCY) ??
    (inNodeTestContext(env) ? NODE_TEST_CONCURRENCY_CLAMP : null) ??
    os.availableParallelism()
  );
}

/**
 * @template TItem, TResult
 * @param {string|URL} workerScript - File URL or path to the worker entry.
 * @param {TItem[]} items
 * @param {{
 *   concurrency?: number,
 *   workerData?: unknown,
 *   throwOnItemError?: boolean,
 *   workerFactory?: (
 *     script: string|URL,
 *     options: { workerData?: unknown },
 *   ) => import('node:events').EventEmitter & {
 *     postMessage: (msg: unknown) => void,
 *     terminate: () => Promise<unknown> | unknown,
 *   },
 * }} [opts]
 * @returns {Promise<Array<TResult | { __cpuPoolError: true, message: string }>>}
 */
export async function runOnPool(workerScript, items, opts = {}) {
  const itemsArr = [...items];
  if (itemsArr.length === 0) return [];

  const requested = resolvePoolConcurrency(opts.concurrency);
  const concurrency = Math.max(1, Math.min(requested, itemsArr.length));
  const workerData = opts.workerData;
  const throwOnItemError = opts.throwOnItemError === true;
  const workerFactory = opts.workerFactory ?? defaultWorkerFactory;

  const results = new Array(itemsArr.length);
  let nextIndex = 0;
  let firstFatalError = null;

  async function runWorker() {
    const worker = workerFactory(workerScript, { workerData });
    // Track exit at worker scope so the finally block can short-circuit
    // when the worker has already gone away (e.g. mid-dispatch
    // process.exit). Registering a single persistent listener here also
    // sidesteps the race where worker.once('exit', ...) added inside
    // finally arrives after the 'exit' event has already fired and
    // therefore never resolves.
    let workerExited = false;
    worker.on('exit', () => {
      workerExited = true;
    });
    try {
      while (firstFatalError === null) {
        const myIndex = nextIndex++;
        if (myIndex >= itemsArr.length) break;
        const item = itemsArr[myIndex];
        // eslint-disable-next-line no-await-in-loop
        const outcome = await dispatchOne(worker, item);
        if (outcome.kind === 'ok') {
          results[myIndex] = outcome.result;
        } else if (outcome.kind === 'item-error') {
          if (throwOnItemError) {
            firstFatalError = new Error(
              `cpu-pool item failure: ${outcome.message}`,
            );
            break;
          }
          results[myIndex] = {
            __cpuPoolError: true,
            message: outcome.message,
          };
        } else {
          // host-level fault: worker crashed or emitted bad shape.
          if (firstFatalError === null) firstFatalError = outcome.error;
          break;
        }
      }
    } finally {
      if (!workerExited) {
        try {
          worker.postMessage({ exit: true });
        } catch {
          // worker may already be terminating
        }
        // Wait briefly for clean exit, then force-terminate. Re-check
        // workerExited because the dispatch loop may have observed the
        // exit between the guard above and here.
        if (!workerExited) {
          const exited = new Promise((resolve) => {
            if (workerExited) resolve();
            else worker.once('exit', resolve);
          });
          // Do NOT .unref() the fallback timer: an unrefed timer lets
          // the event loop appear idle while this promise is pending,
          // which trips Node's test runner cancellation under cold-CI
          // conditions.
          await Promise.race([
            exited,
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ]);
        }
      }
      try {
        await worker.terminate();
      } catch {
        // already gone
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  if (firstFatalError !== null) throw firstFatalError;
  return results;
}

/**
 * Round-trip a single item through `worker`, resolving to a tagged
 * outcome. Never throws: a host-level fault is reported as
 * `{ kind: 'fatal', error }` so `runOnPool` can record it as the first
 * fatal error and stop dispatching.
 */
function dispatchOne(worker, item) {
  return new Promise((resolve) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (msg) => {
      cleanup();
      if (msg && msg.ok === true) {
        resolve({ kind: 'ok', result: msg.result });
        return;
      }
      if (msg && msg.ok === false) {
        resolve({
          kind: 'item-error',
          message: typeof msg.error === 'string' ? msg.error : 'unknown',
        });
        return;
      }
      resolve({
        kind: 'fatal',
        error: new Error(
          `cpu-pool: malformed worker message: ${JSON.stringify(msg)}`,
        ),
      });
    };
    const onError = (err) => {
      cleanup();
      resolve({ kind: 'fatal', error: err });
    };
    const onExit = (code) => {
      cleanup();
      if (code !== 0) {
        resolve({
          kind: 'fatal',
          error: new Error(`cpu-pool: worker exited with code ${code}`),
        });
        return;
      }
      // Clean exit mid-dispatch: treat as fatal so the item is not silently lost.
      resolve({
        kind: 'fatal',
        error: new Error('cpu-pool: worker exited mid-dispatch'),
      });
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage({ item });
  });
}
