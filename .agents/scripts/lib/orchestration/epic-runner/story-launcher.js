/**
 * StoryLauncher — fans out executor sub-agents per wave.
 *
 * Concurrency is bounded by `concurrencyCap`. Each story gets its own
 * provisioned worktree (created by `sprint-story-init.js`) and runs
 * `/sprint-execute-story <storyId>` via the supplied `spawn` adapter.
 *
 * The adapter is injected so the orchestrator can swap the real
 * Claude-Agent-tool invocation for a fake in tests without reaching for
 * module mocks.
 */

const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6h — aligns with GitHub Actions ceiling

export class StoryLauncher {
  /**
   * @param {{
   *   concurrencyCap: number,
   *   spawn: (args: { storyId: number, worktree?: string, signal: AbortSignal }) => Promise<{ status: 'done'|'failed'|'blocked', detail?: string }>,
   *   worktreeResolver?: (storyId: number) => string,
   *   timeoutMs?: number,
   *   logger?: { info: Function, warn: Function, error: Function }
   * }} opts
   */
  constructor(opts) {
    if (!opts || typeof opts.spawn !== 'function') {
      throw new TypeError('StoryLauncher requires a spawn adapter');
    }
    if (!Number.isInteger(opts.concurrencyCap) || opts.concurrencyCap < 1) {
      throw new RangeError('concurrencyCap must be a positive integer');
    }
    this.concurrencyCap = opts.concurrencyCap;
    this.spawn = opts.spawn;
    this.worktreeResolver = opts.worktreeResolver;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = opts.logger ?? console;
  }

  /**
   * Launches stories in the given wave, bounded by `concurrencyCap`. Resolves
   * with one result per input story, preserving order.
   *
   * @param {object[]} stories
   * @param {AbortSignal} [signal]
   * @returns {Promise<Array<{ storyId: number, status: string, detail?: string }>>}
   */
  async launchWave(stories, signal) {
    const queue = stories.map((s, i) => ({ index: i, story: s }));
    const results = new Array(stories.length);
    const workers = new Array(Math.min(this.concurrencyCap, queue.length))
      .fill(0)
      .map(() => this.#worker(queue, results, signal));
    await Promise.all(workers);
    return results;
  }

  async #worker(queue, results, signal) {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const item = queue.shift();
      if (!item) return;
      const { index, story } = item;
      const storyId = story.id ?? story.storyId ?? story;
      const worktree = this.worktreeResolver?.(storyId);
      try {
        const result = await this.#runOne(storyId, worktree, signal);
        results[index] = { storyId, ...result };
      } catch (err) {
        results[index] = {
          storyId,
          status: 'failed',
          detail: err?.message ?? String(err),
        };
      }
    }
  }

  async #runOne(storyId, worktree, parentSignal) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`story ${storyId} timed out`)),
      this.timeoutMs,
    );
    const onParentAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener?.('abort', onParentAbort, { once: true });
    try {
      return await this.spawn({
        storyId,
        worktree,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', onParentAbort);
    }
  }
}
