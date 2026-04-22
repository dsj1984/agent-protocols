/**
 * Tests for providers/github/cache-manager.js.
 *
 * Exercises the ticket-shaped API that wraps lib/CacheLayer: primeIfAbsent
 * (only seeds on miss), primeMany, invalidate, and getOrLoad.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { createTicketCacheManager } = await import(
  pathToFileURL(
    path.join(
      ROOT,
      '.agents',
      'scripts',
      'providers',
      'github',
      'cache-manager.js',
    ),
  ).href
);

describe('cache-manager — has / set / peek', () => {
  it('starts empty and reports miss', () => {
    const cache = createTicketCacheManager();
    assert.equal(cache.has(1), false);
    assert.equal(cache.peek(1), undefined);
  });

  it('stores and returns tickets after set', () => {
    const cache = createTicketCacheManager();
    const ticket = { id: 42, title: 't' };
    cache.set(42, ticket);
    assert.equal(cache.has(42), true);
    assert.equal(cache.peek(42), ticket);
  });

  it('invalidate removes a specific entry', () => {
    const cache = createTicketCacheManager();
    cache.set(1, { id: 1 });
    cache.set(2, { id: 2 });
    cache.invalidate(1);
    assert.equal(cache.has(1), false);
    assert.equal(cache.has(2), true);
  });

  it('clear drops everything', () => {
    const cache = createTicketCacheManager();
    cache.set(1, { id: 1 });
    cache.set(2, { id: 2 });
    cache.clear();
    assert.equal(cache.has(1), false);
    assert.equal(cache.has(2), false);
  });
});

describe('cache-manager — primeIfAbsent', () => {
  it('seeds on miss', () => {
    const cache = createTicketCacheManager();
    const ticket = { id: 5, title: 'a', labels: ['x'] };
    cache.primeIfAbsent(ticket);
    assert.equal(cache.peek(5), ticket);
  });

  it('does not overwrite a fresher entry — preserves newer value post-mutation', () => {
    const cache = createTicketCacheManager();
    const initial = { id: 5, title: 'old' };
    const fresh = { id: 5, title: 'new' };
    cache.set(5, fresh);
    cache.primeIfAbsent(initial);
    assert.equal(cache.peek(5).title, 'new');
  });

  it('fills missing labelSet from labels array', () => {
    const cache = createTicketCacheManager();
    const ticket = { id: 7, labels: ['a', 'b'] };
    cache.primeIfAbsent(ticket);
    const stored = cache.peek(7);
    assert.ok(stored.labelSet instanceof Set);
    assert.ok(stored.labelSet.has('a'));
    assert.ok(stored.labelSet.has('b'));
  });

  it('ignores tickets without a numeric id', () => {
    const cache = createTicketCacheManager();
    cache.primeIfAbsent(null);
    cache.primeIfAbsent(undefined);
    cache.primeIfAbsent({ title: 'no id' });
    cache.primeIfAbsent({ id: 'NaN' });
    assert.equal(cache.has('NaN'), false);
  });
});

describe('cache-manager — primeMany', () => {
  it('seeds every ticket exactly once', () => {
    const cache = createTicketCacheManager();
    cache.primeMany([{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.equal(cache.has(1), true);
    assert.equal(cache.has(2), true);
    assert.equal(cache.has(3), true);
  });

  it('tolerates null/undefined input', () => {
    const cache = createTicketCacheManager();
    assert.doesNotThrow(() => cache.primeMany(null));
    assert.doesNotThrow(() => cache.primeMany(undefined));
  });
});

describe('cache-manager — getOrLoad', () => {
  it('invokes loader exactly once on miss, then serves from cache', async () => {
    const cache = createTicketCacheManager();
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls++;
      return { id: 99, title: 'loaded' };
    };
    const first = await cache.getOrLoad(99, loader);
    const second = await cache.getOrLoad(99, loader);
    assert.equal(loaderCalls, 1);
    assert.equal(first, second);
  });

  it('reloads after invalidate', async () => {
    const cache = createTicketCacheManager();
    let v = 1;
    const loader = async () => ({ id: 1, v: v++ });
    const a = await cache.getOrLoad(1, loader);
    cache.invalidate(1);
    const b = await cache.getOrLoad(1, loader);
    assert.equal(a.v, 1);
    assert.equal(b.v, 2);
  });
});
