/**
 * CacheLayer.js — Tiny TTL cache for orchestration helpers.
 *
 * Provides `createTtlCache({ ttlMs })` returning an object with:
 *
 *   - `get(key, loader)`: returns the cached value if it exists and is not
 *     past its TTL; otherwise invokes `loader()`, stores the result, and
 *     returns it. `loader` may be sync or async.
 *
 *   - `invalidate(key)`: removes a single entry. No-op if missing.
 *
 *   - `clear()`: removes all entries.
 *
 * Migration is out of scope for this task — the existing `_ticketCache` in
 * providers/github.js stays put until the provider-split Story.
 */

/**
 * @template V
 * @param {{ ttlMs: number, now?: () => number }} opts
 *   - `ttlMs`: entry lifetime. `0` disables caching (every `get` calls loader).
 *   - `now`: testing seam — defaults to `Date.now`.
 */
export function createTtlCache({ ttlMs, now = Date.now } = {}) {
  if (typeof ttlMs !== 'number' || ttlMs < 0 || !Number.isFinite(ttlMs)) {
    throw new Error(
      `createTtlCache: ttlMs must be a non-negative finite number, got ${ttlMs}`,
    );
  }
  /** @type {Map<unknown, { value: V, expires: number }>} */
  const store = new Map();

  function isFresh(entry) {
    return entry.expires > now();
  }

  return {
    async get(key, loader) {
      if (typeof loader !== 'function') {
        throw new Error('createTtlCache#get: loader must be a function');
      }
      if (ttlMs > 0) {
        const entry = store.get(key);
        if (entry && isFresh(entry)) return entry.value;
      }
      const value = await loader();
      if (ttlMs > 0) {
        store.set(key, { value, expires: now() + ttlMs });
      }
      return value;
    },

    /** Synchronous presence check — fresh entries only. */
    has(key) {
      if (ttlMs === 0) return false;
      const entry = store.get(key);
      return Boolean(entry && isFresh(entry));
    },

    /** Synchronous fresh-read. Returns `undefined` on miss/expired. */
    peek(key) {
      if (ttlMs === 0) return undefined;
      const entry = store.get(key);
      return entry && isFresh(entry) ? entry.value : undefined;
    },

    /** Synchronous overwrite. No-op when ttl is 0. */
    set(key, value) {
      if (ttlMs === 0) return;
      store.set(key, { value, expires: now() + ttlMs });
    },

    invalidate(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },

    /** Test-only: number of entries currently held (including expired). */
    _size() {
      return store.size;
    },
  };
}
