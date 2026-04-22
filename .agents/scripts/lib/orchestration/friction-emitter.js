/**
 * friction-emitter.js — per-ticket friction-comment emitter with rate-limit.
 *
 * Wraps `upsertStructuredComment(provider, ticketId, 'friction', body)` with an
 * in-process LRU map keyed on `ticketId + markerKey`. A second emission for
 * the same key within `cooldownMs` is suppressed so a stuck caller (e.g. a hot
 * polling loop hitting a persistent GraphQL error) cannot spam a ticket.
 *
 * The emitter is deliberately scoped to a single Node process — cross-process
 * dedup is out of scope; the 60s window is tuned for a single runner.
 *
 * @see Tech Spec #443 §1.2 (Auto-posted friction structured comments)
 */

import { upsertStructuredComment } from './ticketing.js';

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_LRU_CAP = 256;

/**
 * @param {{
 *   provider: import('../ITicketingProvider.js').ITicketingProvider,
 *   cooldownMs?: number,
 *   lruCap?: number,
 *   now?: () => number,
 *   logger?: { warn?: Function, debug?: Function },
 * }} opts
 */
export function createFrictionEmitter(opts = {}) {
  const provider = opts.provider;
  if (!provider) {
    throw new TypeError('createFrictionEmitter requires a provider');
  }
  const cooldownMs = Number.isFinite(opts.cooldownMs)
    ? opts.cooldownMs
    : DEFAULT_COOLDOWN_MS;
  const lruCap = Number.isInteger(opts.lruCap) ? opts.lruCap : DEFAULT_LRU_CAP;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const logger = opts.logger ?? console;

  // Map preserves insertion order — on hit we delete+set to move to the tail,
  // so the first key returned by `keys()` is always the LRU eviction candidate.
  const last = new Map();

  function keyOf(ticketId, markerKey) {
    return `${Number(ticketId)}::${markerKey}`;
  }

  function touch(key, value) {
    if (last.has(key)) last.delete(key);
    last.set(key, value);
    while (last.size > lruCap) {
      const oldest = last.keys().next().value;
      last.delete(oldest);
    }
  }

  /**
   * @param {{ ticketId: number, markerKey: string, body: string }} args
   * @returns {Promise<{ emitted: boolean, reason?: string, error?: Error }>}
   */
  async function emit(args) {
    const ticketId = Number(args?.ticketId);
    const markerKey = args?.markerKey;
    const body = args?.body;
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new TypeError('emit requires a positive integer ticketId');
    }
    if (typeof markerKey !== 'string' || markerKey.length === 0) {
      throw new TypeError('emit requires a non-empty markerKey');
    }
    if (typeof body !== 'string' || body.length === 0) {
      throw new TypeError('emit requires a non-empty body');
    }
    const key = keyOf(ticketId, markerKey);
    const t = now();
    const prev = last.get(key);
    if (prev != null && t - prev < cooldownMs) {
      logger.debug?.(
        `[FrictionEmitter] suppressed (cooldown) ticketId=${ticketId} key=${markerKey}`,
      );
      return { emitted: false, reason: 'cooldown' };
    }
    try {
      await upsertStructuredComment(provider, ticketId, 'friction', body);
      touch(key, t);
      return { emitted: true };
    } catch (err) {
      logger.warn?.(
        `[FrictionEmitter] post failed ticketId=${ticketId} key=${markerKey}: ${err?.message ?? err}`,
      );
      return { emitted: false, reason: 'post-failed', error: err };
    }
  }

  return {
    emit,
    get cooldownMs() {
      return cooldownMs;
    },
    _stateForTests: () => new Map(last),
  };
}
