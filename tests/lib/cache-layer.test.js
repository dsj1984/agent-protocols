/**
 * CacheLayer — TTL cache tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTtlCache } from '../../.agents/scripts/lib/CacheLayer.js';

function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

describe('createTtlCache', () => {
  it('caches the loader result within ttl', async () => {
    let calls = 0;
    const cache = createTtlCache({ ttlMs: 100 });
    const loader = async () => ++calls;
    assert.equal(await cache.get('k', loader), 1);
    assert.equal(await cache.get('k', loader), 1);
    assert.equal(calls, 1);
  });

  it('re-invokes loader after expiration', async () => {
    let calls = 0;
    const clock = fakeClock();
    const cache = createTtlCache({ ttlMs: 100, now: clock.now });
    const loader = async () => ++calls;
    await cache.get('k', loader);
    clock.advance(101);
    await cache.get('k', loader);
    assert.equal(calls, 2);
  });

  it('keys are independent', async () => {
    const cache = createTtlCache({ ttlMs: 100 });
    let a = 0;
    let b = 0;
    await cache.get('a', () => ++a);
    await cache.get('b', () => ++b);
    await cache.get('a', () => ++a);
    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  it('invalidate removes a single entry', async () => {
    const cache = createTtlCache({ ttlMs: 100 });
    let calls = 0;
    await cache.get('k', () => ++calls);
    cache.invalidate('k');
    await cache.get('k', () => ++calls);
    assert.equal(calls, 2);
  });

  it('clear empties the cache', async () => {
    const cache = createTtlCache({ ttlMs: 100 });
    await cache.get('a', () => 1);
    await cache.get('b', () => 2);
    cache.clear();
    assert.equal(cache._size(), 0);
  });

  it('ttlMs=0 disables caching', async () => {
    const cache = createTtlCache({ ttlMs: 0 });
    let calls = 0;
    await cache.get('k', () => ++calls);
    await cache.get('k', () => ++calls);
    assert.equal(calls, 2);
    assert.equal(cache._size(), 0);
  });

  it('supports synchronous loaders', async () => {
    const cache = createTtlCache({ ttlMs: 100 });
    const result = await cache.get('k', () => 'sync-value');
    assert.equal(result, 'sync-value');
  });

  it('rejects non-function loader', async () => {
    const cache = createTtlCache({ ttlMs: 100 });
    await assert.rejects(cache.get('k', null), /loader must be a function/);
  });

  it('rejects bad ttl values at construction', () => {
    assert.throws(() => createTtlCache({ ttlMs: -1 }), /non-negative/);
    assert.throws(() => createTtlCache({ ttlMs: Number.NaN }), /non-negative/);
    assert.throws(() => createTtlCache({ ttlMs: 'a' }), /non-negative/);
  });

  it('does not re-call loader on concurrent waits served by cache', async () => {
    let calls = 0;
    const cache = createTtlCache({ ttlMs: 1000 });
    const loader = async () => {
      calls++;
      return 'v';
    };
    await cache.get('k', loader);
    await Promise.all([
      cache.get('k', loader),
      cache.get('k', loader),
      cache.get('k', loader),
    ]);
    assert.equal(calls, 1);
  });
});
