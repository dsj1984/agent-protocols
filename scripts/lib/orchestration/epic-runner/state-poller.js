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
import { AGENT_LABELS } from '../../label-constants.js';
import { sleep } from '../../util/poll-loop.js';

const BLOCKED_LABEL = AGENT_LABELS.BLOCKED;
const EXECUTING_LABEL = AGENT_LABELS.EXECUTING;
const DISPATCHING_LABEL = AGENT_LABELS.DISPATCHING;
const DONE_LABEL = AGENT_LABELS.DONE;

const DEFAULT_BULK_THRESHOLD = 5;
const BULK_LABEL_QUERY = 'agent::*';

/**
 * Sentinel thrown by `#bulkLabelPoll` when the GitHub response contains an
 * issue whose shape is unexpected. Instructs the caller to demote the
 * current tick to the per-ticket fallback; subsequent ticks retry bulk.
 */
class MalformedBulkResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedBulkResponseError';
  }
}

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
    this.bulkThreshold = opts.bulkThreshold ?? DEFAULT_BULK_THRESHOLD;
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
    const labelMap = await this.#tryBulkLabelPoll();
    await this.#pollEpic(labelMap);
    for (const id of [...this.storyIds]) {
      await this.#pollStory(id, labelMap);
    }
  }

  /**
   * Attempt bulk label poll when the tracked-story set is large enough.
   * Returns a `Map<number, Set<string>>` on success, or `null` when the
   * tick should use the per-ticket fallback (either bulk was not selected,
   * the response was malformed, or the call threw).
   */
  async #tryBulkLabelPoll() {
    if (!this.#shouldUseBulk()) return null;
    try {
      return await this.#bulkLabelPoll();
    } catch (err) {
      if (err instanceof MalformedBulkResponseError) {
        this.logger.warn?.(
          `[StatePoller] bulk response malformed; falling back this tick: ${err.message}`,
        );
      } else if (this.#isRateLimited(err)) {
        this._currentBackoff = Math.min(
          this._currentBackoff * 2,
          this.backoffCapMs,
        );
        this.logger.warn?.(
          `[StatePoller] rate-limited on bulk poll; backing off to ${this._currentBackoff}ms`,
        );
      } else {
        this.logger.warn?.(
          `[StatePoller] bulk poll failed; falling back this tick: ${err?.message ?? err}`,
        );
      }
      return null;
    }
  }

  async #pollEpic(labelMap) {
    const labels = await this.#resolveLabels(this.epicId, labelMap);
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

  async #pollStory(storyId, labelMap) {
    const labels = await this.#resolveLabels(storyId, labelMap);
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

  /**
   * Bulk-read every open `agent::*`-labelled issue in one paginated request
   * and return `Map<issueNumber, Set<labelName>>`. Throws
   * `MalformedBulkResponseError` on any issue missing `number` or `labels`
   * so the caller can demote this tick to the per-ticket fallback.
   */
  async #bulkLabelPoll() {
    if (typeof this.provider.listIssuesByLabel !== 'function') {
      throw new MalformedBulkResponseError(
        'provider does not support listIssuesByLabel',
      );
    }
    const issues = await this.provider.listIssuesByLabel({
      state: 'open',
      labels: BULK_LABEL_QUERY,
    });
    const map = new Map();
    for (const issue of issues ?? []) {
      if (!issue || typeof issue.number !== 'number') {
        throw new MalformedBulkResponseError(
          'bulk response contains issue without a numeric `number`',
        );
      }
      if (!Array.isArray(issue.labels)) {
        throw new MalformedBulkResponseError(
          `bulk response issue #${issue.number} missing \`labels\` array`,
        );
      }
      const names = issue.labels
        .map((l) => (typeof l === 'string' ? l : l?.name))
        .filter((name) => typeof name === 'string');
      map.set(issue.number, new Set(names));
    }
    return map;
  }

  /**
   * Decide whether this tick should use the bulk path. Bulk is selected when
   * the tracked-story set is at or above `bulkThreshold`; small sets use the
   * per-ticket path (fewer HTTP calls than a full repo scan).
   */
  #shouldUseBulk() {
    return this.storyIds.size >= this.bulkThreshold;
  }

  /**
   * Return the label set for a ticket, preferring the bulk `labelMap` when
   * it contains an entry and falling back to a per-ticket fetch otherwise.
   * A ticket absent from the bulk map is treated as "no agent::* labels" —
   * matching the semantics of the GitHub query.
   */
  async #resolveLabels(ticketId, labelMap) {
    if (labelMap) {
      return labelMap.get(ticketId) ?? new Set();
    }
    return this.#labelSet(ticketId);
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
