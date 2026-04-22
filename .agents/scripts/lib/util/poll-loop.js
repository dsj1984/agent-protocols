/**
 * pollUntil — run `fn` on an interval until `predicate(result)` is truthy,
 * the optional `signal` aborts, or `timeoutMs` elapses.
 *
 * Returns the first `fn` result that satisfies `predicate`. If the signal
 * aborts first, resolves to `undefined`. If the timeout elapses, throws.
 *
 * Errors thrown by `fn` are logged via `logger.warn` (if provided) and
 * treated as a non-match — the loop continues until predicate, abort, or
 * timeout. This mirrors the hand-rolled wait loops we replaced, where a
 * single transient fetch error should not terminate the poll.
 *
 * `sleep` is exported as the cancellable delay primitive used internally;
 * callers that already have their own cadence (e.g. a continuous ticker)
 * can import it directly.
 */

/**
 * @param {{
 *   fn: () => any | Promise<any>,
 *   predicate: (result: any) => boolean,
 *   intervalMs: number,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   logger?: { warn?: Function },
 * }} opts
 * @returns {Promise<any | undefined>}
 */
export async function pollUntil(opts) {
  const { fn, predicate, intervalMs, timeoutMs, signal, logger } = opts;
  if (typeof fn !== 'function') throw new TypeError('pollUntil: fn required');
  if (typeof predicate !== 'function') {
    throw new TypeError('pollUntil: predicate required');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new TypeError('pollUntil: intervalMs must be a non-negative number');
  }

  const deadline =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : null;

  while (!signal?.aborted) {
    let result;
    let errored = false;
    try {
      result = await fn();
    } catch (err) {
      errored = true;
      logger?.warn?.(`[pollUntil] fn error: ${err?.message ?? err}`);
    }
    if (!errored && predicate(result)) return result;
    if (deadline !== null && Date.now() >= deadline) {
      throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs, signal);
  }
  return undefined;
}

/**
 * Cancellable sleep. Resolves after `ms` or immediately when `signal` aborts.
 *
 * The timer is intentionally NOT `unref`'d — unref'd timers caused Node 22's
 * test runner to cancel subtests that awaited `sleep` with `cancelledByParent`
 * / "Promise resolution is still pending but the event loop has already
 * resolved". Callers that need a clean shutdown should abort the `signal`
 * instead of relying on unref.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
