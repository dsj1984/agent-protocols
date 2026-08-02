/**
 * lib/workers/serve-worker-messages.js — the shared CPU-pool worker skeleton.
 *
 * Every worker under `lib/workers/` is a pure message handler plus the same
 * eight-line `parentPort` wiring: subscribe, run the handler, close on an
 * `exit` verdict, post the reply otherwise. That wiring was copied into all
 * four workers; it lives here once instead (Story #4926).
 *
 * The handler contract is unchanged — see `lib/cpu-pool.js`:
 *   IN  : `{ item: … }` — one unit of work
 *         `{ exit: true }` — drain & terminate
 *   OUT : `{ kind: 'exit' }` | `{ kind: 'reply', message: object }`
 */

/**
 * Wire a pure worker message handler onto a `worker_threads` port.
 *
 * A falsy `port` is a no-op, so a worker module imported directly by a unit
 * test (where `parentPort` is `null`) installs no listener and stays pure.
 *
 * @param {import('node:worker_threads').MessagePort|null|undefined} port
 * @param {(msg: unknown) => {kind: 'exit'} | {kind: 'reply', message: object}} handle
 * @returns {void}
 */
export function serveWorkerMessages(port, handle) {
  if (!port) return;
  port.on('message', (msg) => {
    const out = handle(msg);
    if (out.kind === 'exit') {
      port.close();
      return;
    }
    port.postMessage(out.message);
  });
}
