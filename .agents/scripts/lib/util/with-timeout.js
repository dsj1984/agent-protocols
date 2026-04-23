/**
 * Race a promise against a wall-clock timeout.
 *
 * If `ms` elapses before the input settles, the returned promise rejects with
 * an `Error` whose `code === 'ETIMEDOUT'`. Callers discriminate on `code` to
 * handle timeouts distinctly from the input's own rejections.
 *
 * Non-Promise inputs are wrapped via `Promise.resolve`, so `withTimeout(value, ms)`
 * is always safe.
 *
 * The timer is cleared on settle (success, failure, or timeout) so callers
 * never leak a pending `setTimeout`.
 *
 * @template T
 * @param {Promise<T> | T} input
 * @param {number} ms - Timeout in milliseconds. Must be a non-negative integer.
 * @param {{ label?: string }} [opts] - `label` is embedded in the timeout message.
 * @returns {Promise<T>}
 */
export function withTimeout(input, ms, { label = 'operation' } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms} ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(input), timeout]).finally(() => {
    clearTimeout(timer);
  });
}
