/**
 * StatePoller — polls Epic and child-Story labels at `pollIntervalSec`.
 *
 * Emits events via a minimal EventEmitter-like interface:
 *   - `story-closed` : { storyId }
 *   - `story-failed` : { storyId, reason }
 *   - `blocker-raised` : { source: 'epic' | 'story', storyId? }
 *   - `cancel-requested` : {}
 *
 * Backoff: on GitHub 403/429 (rate limit), delay doubles up to a cap. Normal
 * poll intervals reset the backoff. Consumers start the loop via `start()`
 * and stop it via `stop()`. Poll cycles are non-overlapping — a slow GitHub
 * response defers the next tick rather than running concurrent polls.
 */

import { EventEmitter } from 'node:events';
import { sleep } from '../../util/poll-loop.js';

const BLOCKED_LABEL = 'agent::blocked';
const EXECUTING_LABEL = 'agent::executing';
const DISPATCHING_LABEL = 'agent::dispatching';
const DONE_LABEL = 'agent::done';

export class StatePoller extends EventEmitter {
  /**
   * @param {{
   *   provider: import('../../ITicketingProvider.js').ITicketingProvider,
   *   epicId: number,
   *   pollIntervalMs: number,
   *   backoffCapMs?: number,
   *   storyIds?: number[],
   *   logger?: { warn: Function, error: Function }
   * }} opts
   */
  constructor(opts = {}) {
    super();
    const ctx = opts.ctx;
    const provider = opts.provider ?? ctx?.provider;
    if (!provider) throw new TypeError('StatePoller requires a provider');
    this.provider = provider;
    this.epicId = opts.epicId ?? ctx?.epicId;
    const pollDefault =
      ctx?.pollIntervalSec != null ? ctx.pollIntervalSec * 1000 : 30_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? pollDefault;
    this.backoffCapMs = opts.backoffCapMs ?? 5 * 60_000;
    this.storyIds = new Set(opts.storyIds ?? []);
    this.logger = opts.logger ?? ctx?.logger ?? console;
    this._stopped = true;
    this._currentBackoff = this.pollIntervalMs;
    this._seenStates = new Map(); // storyId/epicId → previous labels set
    this._abortController = null;
  }

  trackStories(ids) {
    for (const id of ids) this.storyIds.add(id);
  }

  untrackStory(id) {
    this.storyIds.delete(id);
  }

  start() {
    if (!this._stopped) return;
    this._stopped = false;
    this._abortController = new AbortController();
    this.#runLoop();
  }

  stop() {
    this._stopped = true;
    this._abortController?.abort();
    this._abortController = null;
  }

  async pollOnce() {
    await this.#pollEpic();
    for (const id of [...this.storyIds]) {
      await this.#pollStory(id);
    }
  }

  async #pollEpic() {
    const labels = await this.#labelSet(this.epicId);
    if (labels === null) return;
    const prev = this._seenStates.get(this.epicId) ?? new Set();

    if (labels.has(BLOCKED_LABEL) && !prev.has(BLOCKED_LABEL)) {
      this.emit('blocker-raised', { source: 'epic' });
    }
    if (
      !labels.has(EXECUTING_LABEL) &&
      !labels.has(DISPATCHING_LABEL) &&
      !labels.has(BLOCKED_LABEL)
    ) {
      // Operator dropped the execution label entirely — cancel.
      this.emit('cancel-requested', {});
    }
    this._seenStates.set(this.epicId, labels);
  }

  async #pollStory(storyId) {
    const labels = await this.#labelSet(storyId);
    if (labels === null) return;
    const prev = this._seenStates.get(storyId) ?? new Set();

    if (labels.has(DONE_LABEL) && !prev.has(DONE_LABEL)) {
      this.emit('story-closed', { storyId });
      this.storyIds.delete(storyId);
    } else if (labels.has(BLOCKED_LABEL) && !prev.has(BLOCKED_LABEL)) {
      this.emit('blocker-raised', { source: 'story', storyId });
    }
    this._seenStates.set(storyId, labels);
  }

  async #labelSet(ticketId) {
    try {
      const ticket = await this.provider.getTicket(ticketId);
      return new Set(ticket.labels ?? []);
    } catch (err) {
      if (this.#isRateLimited(err)) {
        this._currentBackoff = Math.min(
          this._currentBackoff * 2,
          this.backoffCapMs,
        );
        this.logger.warn?.(
          `[StatePoller] rate-limited reading #${ticketId}; backing off to ${this._currentBackoff}ms`,
        );
      } else {
        this.logger.warn?.(
          `[StatePoller] provider error reading #${ticketId}: ${err?.message ?? err}`,
        );
      }
      return null;
    }
  }

  #isRateLimited(err) {
    const msg = String(err?.message ?? err ?? '');
    return /(403|429|rate[-\s]?limit)/i.test(msg);
  }

  async #runLoop() {
    const signal = this._abortController?.signal;
    while (!this._stopped) {
      await this.pollOnce();
      // Reset backoff on a clean cycle.
      if (this._currentBackoff > this.pollIntervalMs) {
        this._currentBackoff = this.pollIntervalMs;
      }
      await sleep(this._currentBackoff, signal);
    }
  }
}
