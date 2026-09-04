/**
 * concurrentMap — bounded-concurrency async map.
 *
 * Semantics:
 *   - Preserves input order in the returned array (result[i] == mapper(items[i])).
 *   - Cap of at most `concurrency` `mapper` invocations in flight at a time.
 *   - First rejection wins: the returned promise rejects with the first thrown
 *     error. Later rejections from drain-through work are swallowed so the
 *     caller observes a single deterministic failure.
 *   - Drain-on-rejection: workers that are already mid-await finish naturally
 *     (we do not cancel). Only dispatch of *new* items stops after the first
 *     error. This matches fetch-style callers that have no cancellation token
 *     and would leak otherwise.
 */

/**
 * The one bound every independent-write fan-out over the GitHub API uses
 * (Story #4952 raised those loops off serial; Story #4961 made this the single
 * owner of the number they share). Imported by the `/mandrel-plan` context gathers,
 * the persist checkpoint fan-out, the `agent::ready` flips and the supersede
 * close loop, so re-tuning the policy is one edit rather than six.
 *
 * **Why bounded and not unbounded.** Every unit in those fan-outs is its own
 * API round-trip, so an unbounded map over an N-Story plan dispatches N writes
 * at once — and GitHub answers a burst with a secondary rate limit rather than
 * with throughput. The goal is overlapping unrelated waits, not saturating the
 * API, and four is enough to collapse the latency the serial loops paid while
 * staying well under the burst threshold. Callers whose ordering is
 * load-bearing (`createStoryIssues`) stay serial instead of importing this.
 */
export const FANOUT_CONCURRENCY = 4;

/**
 * @template T, R
 * @param {ReadonlyArray<T>} items
 * @param {(item: T, index: number) => Promise<R> | R} mapper
 * @param {{ concurrency?: number }} [opts]
 * @returns {Promise<R[]>}
 */
export async function concurrentMap(items, mapper, opts = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError('concurrentMap: items must be an array');
  }
  if (typeof mapper !== 'function') {
    throw new TypeError('concurrentMap: mapper must be a function');
  }
  const concurrency = Number.isFinite(opts.concurrency)
    ? Math.max(1, Math.floor(opts.concurrency))
    : items.length;

  const n = items.length;
  const results = new Array(n);
  let cursor = 0;
  let firstError = null;

  async function worker() {
    while (firstError === null) {
      const idx = cursor++;
      if (idx >= n) return;
      try {
        results[idx] = await mapper(items[idx], idx);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
    }
  }

  const workerCount = Math.min(concurrency, n);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);

  if (firstError !== null) throw firstError;
  return results;
}
