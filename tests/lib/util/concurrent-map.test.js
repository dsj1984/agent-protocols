import assert from 'node:assert/strict';
import test from 'node:test';

import { concurrentMap } from '../../../.agents/scripts/lib/util/concurrent-map.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('concurrentMap: preserves input order even when later items resolve first', async () => {
  const items = [30, 10, 20];
  const results = await concurrentMap(
    items,
    (ms) => new Promise((res) => setTimeout(() => res(ms * 2), ms)),
    { concurrency: 3 },
  );
  assert.deepEqual(results, [60, 20, 40]);
});

test('concurrentMap: caps in-flight to `concurrency`', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  let inFlight = 0;
  let peak = 0;

  const results = await concurrentMap(
    items,
    async (v) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return v * 10;
    },
    { concurrency: 3 },
  );

  assert.deepEqual(
    results,
    items.map((v) => v * 10),
  );
  assert.ok(peak <= 3, `expected peak ≤ 3, got ${peak}`);
  assert.equal(inFlight, 0);
});

test('concurrentMap: surfaces first rejection and stops dispatching new items', async () => {
  const calls = [];
  const err = new Error('boom');
  await assert.rejects(
    concurrentMap(
      [1, 2, 3, 4, 5, 6, 7, 8],
      async (v) => {
        calls.push(v);
        if (v === 2) throw err;
        await new Promise((r) => setTimeout(r, 1));
        return v;
      },
      { concurrency: 2 },
    ),
    (e) => e === err,
  );
  // With concurrency=2, items 1 and 2 start; 2 rejects immediately. Worker
  // that handled item 1 will drain, but no new dispatch after firstError.
  assert.ok(
    calls.length < 8,
    `expected fewer than all 8 items dispatched, got ${calls.length}: ${calls.join(',')}`,
  );
});

test('concurrentMap: drains in-flight work before rejecting', async () => {
  // Two slow tasks start. Task A is in-flight. Task B rejects. We expect A
  // to finish (drain) before concurrentMap's returned promise rejects.
  const aDone = deferred();
  const bRejected = deferred();
  let aSettled = false;

  const runP = concurrentMap(
    ['A', 'B'],
    async (v) => {
      if (v === 'A') {
        await aDone.promise;
        aSettled = true;
        return v;
      }
      await bRejected.promise;
      throw new Error('B failed');
    },
    { concurrency: 2 },
  );

  // Let B reject first.
  bRejected.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(aSettled, false, 'A should still be in flight');

  // Now let A settle. concurrentMap should only then reject.
  aDone.resolve();
  await assert.rejects(runP, /B failed/);
  assert.equal(aSettled, true);
});

test('concurrentMap: later rejections do not override the first error', async () => {
  const firstErr = new Error('first');
  const laterErr = new Error('later');
  const laterGate = deferred();

  const runP = concurrentMap(
    ['first', 'later'],
    async (v) => {
      if (v === 'first') throw firstErr;
      await laterGate.promise;
      throw laterErr;
    },
    { concurrency: 2 },
  );

  // Let the in-flight worker drain with its own rejection.
  laterGate.resolve();
  await assert.rejects(runP, (e) => e === firstErr);
});

test('concurrentMap: empty input returns []', async () => {
  const out = await concurrentMap([], async () => {
    throw new Error('should not run');
  });
  assert.deepEqual(out, []);
});

test('concurrentMap: works with sync mapper', async () => {
  const out = await concurrentMap([1, 2, 3], (x) => x + 1, { concurrency: 2 });
  assert.deepEqual(out, [2, 3, 4]);
});

test('concurrentMap: defaults concurrency to items.length when unspecified', async () => {
  let inFlight = 0;
  let peak = 0;
  await concurrentMap([1, 2, 3, 4], async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
  });
  assert.ok(peak >= 2, 'expected parallelism without concurrency cap');
});
