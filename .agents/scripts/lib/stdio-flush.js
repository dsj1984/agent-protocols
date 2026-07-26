// .agents/scripts/lib/stdio-flush.js
/**
 * Stdio drain helper (Story #4783).
 *
 * `process.stdout` / `process.stderr` are only synchronous when they point at
 * a TTY or a regular file. On a **pipe** — every `cmd | consumer`, every
 * `child_process` capture, every `$(...)` substitution — Node writes
 * asynchronously once the 64 KiB kernel pipe buffer fills: `write()` returns
 * `false` and the remaining bytes sit in the stream's internal queue until the
 * reader drains it.
 *
 * `process.exit()` does not wait for that queue. Anything still buffered when
 * the process terminates is discarded, so a CLI that emits more than a pipe
 * buffer's worth of output and then exits eagerly silently truncates — the
 * exit code still reads green, and the consumer parses a half-written
 * envelope. `runAsCli` is the shared boundary where that used to happen for
 * every `.agents/scripts` entry point.
 *
 * The fix is to stop exiting eagerly (set `process.exitCode` and let the loop
 * drain naturally). This helper is the belt-and-braces half: an explicit await
 * on the queued bytes, so the flush is complete before the CLI's last frame
 * unwinds even when something further out terminates the process.
 *
 * @module stdio-flush
 */

/**
 * Await the point at which one writable stream's queued bytes have been handed
 * to the OS. Resolves immediately when the stream has nothing queued, is not
 * writable, or is not a stream at all — a flush must never be the reason a
 * process hangs.
 *
 * Both settle paths are covered: the zero-length `write()` callback (which
 * fires after every previously queued chunk, since writes are ordered) and the
 * `'drain'` event (which fires when a backed-up stream empties). Whichever
 * lands first resolves; the other is detached.
 *
 * @param {NodeJS.WritableStream & { writableLength?: number, writableEnded?: boolean, destroyed?: boolean }} [stream]
 * @returns {Promise<void>}
 */
function drainStream(stream) {
  if (!stream || typeof stream.write !== 'function') return Promise.resolve();
  if (stream.destroyed || stream.writableEnded) return Promise.resolve();
  if ((stream.writableLength ?? 0) === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      stream.removeListener?.('drain', done);
      resolve();
    };
    stream.once?.('drain', done);
    // The write callback fires once this (empty) chunk — and therefore every
    // chunk queued ahead of it — has been flushed to the underlying handle.
    stream.write('', done);
  });
}

/**
 * Await the drain of the process's stdio streams. Never rejects: a stream that
 * errored, closed, or was never writable resolves as already-flushed.
 *
 * @param {Array<NodeJS.WritableStream|undefined>} [streams] Defaults to
 *   `[process.stdout, process.stderr]`.
 * @returns {Promise<void>}
 */
export async function flushStdio(streams = [process.stdout, process.stderr]) {
  await Promise.all(streams.map((stream) => drainStream(stream)));
}
