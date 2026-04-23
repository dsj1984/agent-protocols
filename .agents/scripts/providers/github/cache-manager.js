/**
 * Per-provider ticket cache manager.
 *
 * Wraps `lib/CacheLayer.createTtlCache` with a ticket-shaped API so the
 * GitHub facade no longer has to reach into a bare `Map` for cache
 * bookkeeping. Scoped to the lifetime of a single provider instance — one
 * dispatcher / close-out run shares fetched tickets across the
 * dispatcher, reconciler, and cascade without redundant REST round-trips.
 *
 * TTL defaults to 1 hour, which is well above any realistic orchestration
 * run. Mutations call `invalidate(ticketId)` explicitly.
 */

import { createTtlCache } from '../../lib/CacheLayer.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * @param {{ ttlMs?: number }} [opts]
 * @returns {{
 *   has(ticketId: number): boolean,
 *   peek(ticketId: number): object|undefined,
 *   set(ticketId: number, ticket: object): void,
 *   primeIfAbsent(ticket: object): void,
 *   primeMany(tickets: Array<object>): void,
 *   getOrLoad(ticketId: number, loader: () => Promise<object>): Promise<object>,
 *   invalidate(ticketId: number): void,
 *   clear(): void,
 * }}
 */
export function createTicketCacheManager({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const cache = createTtlCache({ ttlMs });

  function primeIfAbsent(ticket) {
    if (!ticket || typeof ticket.id !== 'number') return;
    if (cache.has(ticket.id)) return;
    if (!ticket.labelSet && Array.isArray(ticket.labels)) {
      ticket.labelSet = new Set(ticket.labels);
    }
    cache.set(ticket.id, ticket);
  }

  return {
    has(ticketId) {
      return cache.has(ticketId);
    },

    peek(ticketId) {
      return cache.peek(ticketId);
    },

    set(ticketId, ticket) {
      cache.set(ticketId, ticket);
    },

    primeIfAbsent,

    primeMany(tickets) {
      for (const t of tickets ?? []) primeIfAbsent(t);
    },

    async getOrLoad(ticketId, loader) {
      if (cache.has(ticketId)) return cache.peek(ticketId);
      const ticket = await loader();
      cache.set(ticketId, ticket);
      return ticket;
    },

    invalidate(ticketId) {
      cache.invalidate(ticketId);
    },

    clear() {
      cache.clear();
    },
  };
}
