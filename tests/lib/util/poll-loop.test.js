import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  pollUntil,
  sleep,
} from '../../../.agents/scripts/lib/util/poll-loop.js';

function quietLogger() {
  return { warn: () => {} };
}

describe('pollUntil', () => {
  it('returns the first result that satisfies the predicate (happy path)', async () => {
    let calls = 0;
    const result = await pollUntil({
      fn: () => ++calls,
      predicate: (n) => n >= 3,
      intervalMs: 1,
    });
    assert.equal(result, 3);
    assert.equal(calls, 3);
  });

  it('matches on the first call when predicate is immediately true', async () => {
    let calls = 0;
    const result = await pollUntil({
      fn: () => {
        calls++;
        return 'ready';
      },
      predicate: (v) => v === 'ready',
      intervalMs: 100,
    });
    assert.equal(result, 'ready');
    assert.equal(calls, 1);
  });

  it('throws when the timeout elapses before predicate matches', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const promise = pollUntil({
        fn: async () => 'not-ready',
        predicate: (v) => v === 'ready',
        intervalMs: 50,
        timeoutMs: 100,
      });
      // Advance past the deadline. Predicate never matches, so pollUntil
      // should throw on the next deadline check.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        mock.timers.tick(50);
      }
      await assert.rejects(promise, /timed out after 100ms/);
    } finally {
      mock.timers.reset();
    }
  });

  it('swallows fn errors and keeps polling', async () => {
    let calls = 0;
    const warnings = [];
    const result = await pollUntil({
      fn: async () => {
        calls++;
        if (calls < 3) throw new Error(`transient-${calls}`);
        return 'ok';
      },
      predicate: (v) => v === 'ok',
      intervalMs: 1,
      logger: { warn: (m) => warnings.push(m) },
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /transient-1/);
  });

  it('returns undefined when the signal aborts before predicate matches', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await pollUntil({
      fn: async () => 'never-ready',
      predicate: () => false,
      intervalMs: 5,
      signal: controller.signal,
      logger: quietLogger(),
    });
    assert.equal(result, undefined);
  });

  it('rejects invalid arguments', async () => {
    await assert.rejects(
      () => pollUntil({ predicate: () => true, intervalMs: 1 }),
      /fn required/,
    );
    await assert.rejects(
      () => pollUntil({ fn: () => 1, intervalMs: 1 }),
      /predicate required/,
    );
    await assert.rejects(
      () => pollUntil({ fn: () => 1, predicate: () => true, intervalMs: -1 }),
      /intervalMs/,
    );
  });
});

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(20);
    assert.ok(Date.now() - start >= 15);
  });

  it('resolves immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await sleep(10_000, controller.signal);
    assert.ok(Date.now() - start < 50);
  });

  it('resolves early when the signal aborts mid-sleep', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const start = Date.now();
    await sleep(5000, controller.signal);
    assert.ok(Date.now() - start < 100);
  });
});
