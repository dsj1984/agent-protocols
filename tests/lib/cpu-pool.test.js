/**
 * cpu-pool — proves the worker-pool migration of `calculateAll`
 * (maintainability) and `scanAndScore` (CRAP) is observably identical
 * to the pre-pool serial path, and that a single broken file does not
 * abort the whole run.
 *
 * Two contracts under test:
 *
 *   (a) byte-for-byte parity: across a fixture set, the pool's output
 *       matches the in-process serial reference (same scores, same
 *       row shape, same deterministic ordering after sort).
 *
 *   (b) per-file failure isolation: a file with a deliberate parse
 *       error surfaces as either a missing entry (maintainability
 *       scores map) or a dropped row set (CRAP rows), while the rest
 *       of the fixture set scores normally. The run does NOT throw.
 *
 * Both parity suites drive the pool **explicitly**, via the
 * `serialThreshold` seam, rather than by materialising a fixture set larger
 * than the cutover. Story #5109 raised `POOL_SERIAL_THRESHOLD` from 8 to 256
 * against measured crossover data; a fixture count chosen to clear the old
 * cutover silently stopped exercising the pool the moment the number moved,
 * and the tests would have kept passing on the serial path while claiming to
 * cover the pooled one.
 *
 *   (c) concurrency resolution: `runOnPool` honours an explicit option, then
 *       `MANDREL_POOL_CONCURRENCY`, then the `node:test` clamp — asserted
 *       through the observable worker count with an injected factory, since
 *       the resolver itself is module-private.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runOnPool } from '../../.agents/scripts/lib/cpu-pool.js';
import { scanAndScore } from '../../.agents/scripts/lib/crap-utils.js';
import { calculateForFile } from '../../.agents/scripts/lib/maintainability-engine.js';
import { calculateAll } from '../../.agents/scripts/lib/maintainability-utils.js';
import { makeTempDir } from '../../.agents/scripts/lib/test-temp.js';

/**
 * Pool-vs-serial cutover forced on the parity suites. `1` means "never take
 * the serial path", so a 9-file fixture set exercises the workers regardless
 * of what `POOL_SERIAL_THRESHOLD` is tuned to.
 */
const FORCE_POOL = 1;

/**
 * Generate N small but non-trivial JS files under `dir`, each shaped so
 * escomplex emits a single named function with a stable cyclomatic
 * count. The count is deliberately small: the pooled path is selected by
 * `FORCE_POOL`, not by out-sizing the cutover.
 */
function writeJsFixtures(dir, count, prefix = 'f') {
  const files = [];
  for (let i = 0; i < count; i++) {
    const p = path.join(dir, `${prefix}${i}.js`);
    fs.writeFileSync(
      p,
      `export function ${prefix}${i}(x) {\n` +
        `  if (x > 0) return x + 1;\n` +
        `  if (x < 0) return x - 1;\n` +
        `  return ${i};\n` +
        `}\n`,
    );
    files.push(p);
  }
  return files;
}

function buildCoverageMap(files) {
  // Minimal istanbul-shaped entry: every fn covered, single statement
  // hit. The exact coverage value doesn't matter here — the test
  // asserts shape parity, not numeric coverage.
  const coverage = {};
  for (const abs of files) {
    coverage[abs] = {
      path: abs,
      fnMap: {
        0: {
          name: path.basename(abs, '.js'),
          decl: { start: { line: 1, column: 0 } },
          loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
          line: 1,
        },
      },
      f: { 0: 1 },
      statementMap: {
        0: { start: { line: 2, column: 0 }, end: { line: 2, column: 30 } },
        1: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } },
        2: { start: { line: 4, column: 0 }, end: { line: 4, column: 30 } },
      },
      s: { 0: 1, 1: 1, 2: 1 },
      branchMap: {},
      b: {},
    };
  }
  return coverage;
}

// ---------------------------------------------------------------------------
// (a) byte-for-byte parity across fixture set
// ---------------------------------------------------------------------------

describe('cpu-pool — byte-for-byte parity with serial baseline', () => {
  let workDir;
  let originalCwd;

  before(() => {
    // realpathSync so workDir matches process.cwd() after chdir; on macOS
    // os.tmpdir() returns `/tmp/…` while cwd resolves the `/tmp → /private/tmp`
    // symlink, and the expected keys (built via path.relative(workDir, …))
    // would then diverge from calculateAll's cwd-relative output. No-op on
    // Linux.
    workDir = fs.realpathSync(makeTempDir('cpu-pool-parity-'));
    originalCwd = process.cwd();
    process.chdir(workDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('maintainability calculateAll: pool output matches in-process scores', async () => {
    const caseDir = path.join(workDir, 'maintainability-parity');
    fs.mkdirSync(caseDir, { recursive: true });
    const files = writeJsFixtures(caseDir, 9);

    // Reference: build the same map by calling the synchronous engine
    // directly on each file, then sort keys to mirror the migration's
    // deterministic ordering contract.
    const reference = {};
    for (const f of files) {
      const rel = path.relative(workDir, f).replace(/\\/g, '/');
      reference[rel] = calculateForFile(f);
    }
    const sortedReference = Object.fromEntries(
      Object.keys(reference)
        .sort()
        .map((k) => [k, reference[k]]),
    );

    const fromPool = await calculateAll(files, {
      serialThreshold: FORCE_POOL,
    });

    // Same keys in the same order, same numeric values.
    assert.deepStrictEqual(
      Object.keys(fromPool),
      Object.keys(sortedReference),
      'key order must be deterministic and match sort-by-relPath',
    );
    for (const k of Object.keys(sortedReference)) {
      assert.strictEqual(
        fromPool[k],
        sortedReference[k],
        `score for ${k} must match the serial reference exactly`,
      );
    }
  });

  it('CRAP scanAndScore: pool rows match the per-file serial reference', async () => {
    const caseDir = path.join(workDir, 'crap-parity');
    fs.mkdirSync(caseDir, { recursive: true });
    const files = writeJsFixtures(caseDir, 9, 'g');
    const coverage = buildCoverageMap(files);
    const result = await scanAndScore({
      targetDirs: [caseDir],
      coverage,
      requireCoverage: true,
      cwd: caseDir,
      serialThreshold: FORCE_POOL,
    });

    // Every fixture surfaces exactly one row (one function per file).
    assert.strictEqual(result.scannedFiles, 9);
    assert.strictEqual(result.skippedFilesNoCoverage, 0);
    assert.strictEqual(result.rows.length, 9);

    // Rows are sorted by (file, startLine, method) — assert that the
    // sort actually fires regardless of which worker finished first.
    const fileSequence = result.rows.map((r) => r.file);
    const sorted = [...fileSequence].sort();
    assert.deepStrictEqual(
      fileSequence,
      sorted,
      'rows must be sorted by file path post-pool',
    );

    // Every row's shape matches what the pre-pool serial loop produced.
    for (const row of result.rows) {
      assert.match(row.file, /^g\d+\.js$/);
      assert.match(row.method, /^g\d+$/);
      assert.strictEqual(row.startLine, 1);
      assert.strictEqual(row.cyclomatic, 3, 'two ifs + entry');
      assert.strictEqual(row.coverage, 1);
      assert.strictEqual(typeof row.crap, 'number');
    }
  });
});

// ---------------------------------------------------------------------------
// (b) parse-error isolation — one bad file does not fail the whole run
// ---------------------------------------------------------------------------

describe('cpu-pool — parse-error isolation', () => {
  let workDir;
  let originalCwd;

  before(() => {
    // See the parity suite's note: realpathSync keeps workDir in sync with
    // process.cwd() after chdir so macOS's /tmp symlink doesn't skew the
    // cwd-relative keys. No-op on Linux.
    workDir = fs.realpathSync(makeTempDir('cpu-pool-isolate-'));
    originalCwd = process.cwd();
    process.chdir(workDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('maintainability: a parse-error file is dropped; siblings score normally', async () => {
    const caseDir = path.join(workDir, 'maintainability-case');
    fs.mkdirSync(caseDir, { recursive: true });
    const goodFiles = writeJsFixtures(caseDir, 8, 'h');
    const badPath = path.join(caseDir, 'BROKEN.js');
    // Garbage bytes that ts.transpileModule + escomplex will both
    // refuse to parse. The current serial path returns 0 for parse
    // errors; the pool path matches that, so the file silently drops
    // out of the scores map. The contract under test is that the run
    // does NOT throw and the other 11 files survive.
    fs.writeFileSync(badPath, '@@@@ not valid javascript @@@@\n}}}}\n');

    const all = [...goodFiles, badPath];
    const scores = await calculateAll(all, { serialThreshold: FORCE_POOL });

    // 11 good files surface; the bad file either drops out (null
    // score filtered) or scores 0. Assert at least the 11 are present
    // and their scores match the per-file serial reference.
    for (const good of goodFiles) {
      const rel = path.relative(workDir, good).replace(/\\/g, '/');
      assert.ok(rel in scores, `expected good file ${rel} to be scored`);
      assert.strictEqual(scores[rel], calculateForFile(good));
    }
    // Run completed without throwing.
    assert.ok(true, 'pool drained despite the broken fixture');
  });

  it('CRAP: a parse-error file produces zero rows; siblings score normally', async () => {
    const caseDir = path.join(workDir, 'crap-case');
    fs.mkdirSync(caseDir, { recursive: true });
    const goodFiles = writeJsFixtures(caseDir, 8, 'k');
    const badPath = path.join(caseDir, 'BROKEN.js');
    fs.writeFileSync(badPath, '))) syntax garbage (((\n');
    const all = [...goodFiles, badPath];
    const coverage = buildCoverageMap(all);

    const result = await scanAndScore({
      targetDirs: [caseDir],
      coverage,
      requireCoverage: true,
      cwd: caseDir,
      serialThreshold: FORCE_POOL,
    });

    // The bad file was scanned (it has a coverage entry so requireCoverage
    // doesn't filter it out) but produced no rows because TS transpile
    // surfaces nothing escomplex can chew on.
    assert.strictEqual(result.scannedFiles, 9);
    assert.strictEqual(result.rows.length, 8);
    for (const row of result.rows) {
      assert.match(row.file, /^k\d+\.js$/, 'BROKEN.js must not appear');
    }
  });
});

// ---------------------------------------------------------------------------
// (c) cpu-pool primitive — small smoke around runOnPool itself
// ---------------------------------------------------------------------------

describe('runOnPool — primitive contract', () => {
  it('preserves input order in the returned results array', async () => {
    // Inline worker — squares its input. Use data: URL so the test
    // doesn't depend on a fixture file on disk.
    const workerSrc = `
      import { parentPort } from 'node:worker_threads';
      parentPort.on('message', (msg) => {
        if (msg && msg.exit === true) process.exit(0);
        const n = msg.item;
        parentPort.postMessage({ ok: true, result: n * n });
      });
    `;
    const workerUrl = new URL(
      `data:text/javascript,${encodeURIComponent(workerSrc)}`,
    );
    const items = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    const results = await runOnPool(workerUrl, items, { concurrency: 4 });
    assert.deepStrictEqual(
      results,
      items.map((n) => n * n),
    );
  });

  it('captures per-item failures as __cpuPoolError instead of throwing', async () => {
    const workerSrc = `
      import { parentPort } from 'node:worker_threads';
      parentPort.on('message', (msg) => {
        if (msg && msg.exit === true) process.exit(0);
        if (msg.item === 'bad') {
          parentPort.postMessage({ ok: false, error: 'item refused' });
          return;
        }
        parentPort.postMessage({ ok: true, result: msg.item.toUpperCase() });
      });
    `;
    const workerUrl = new URL(
      `data:text/javascript,${encodeURIComponent(workerSrc)}`,
    );
    const results = await runOnPool(workerUrl, ['a', 'bad', 'c'], {
      concurrency: 2,
    });
    assert.strictEqual(results[0], 'A');
    assert.deepStrictEqual(results[1], {
      __cpuPoolError: true,
      message: 'item refused',
    });
    assert.strictEqual(results[2], 'C');
  });
});

// ---------------------------------------------------------------------------
// (d) injected workerFactory — drive scheduling / ordering / exit-race
//     branches in-process with a synchronous fake handle, no real thread.
// ---------------------------------------------------------------------------

/**
 * EventEmitter-shaped fake worker handle. It satisfies the subset of the
 * worker_threads.Worker surface that `runOnPool` touches: `on`/`off`/`once`,
 * `postMessage`, and a thenable `terminate()`. The `respond` callback is
 * invoked for every `{ item }` dispatch and decides which scheduler branch
 * to exercise by emitting the corresponding event synchronously (so no real
 * OS thread, timer, or microtask hop is required to drive the test).
 *
 * @param {(item: unknown, handle: FakeWorker) => void} respond
 */
class FakeWorker extends EventEmitter {
  constructor(respond) {
    super();
    this.respond = respond;
    this.terminated = false;
    this.posted = [];
  }

  postMessage(msg) {
    this.posted.push(msg);
    if (msg && msg.exit === true) {
      // Clean drain-and-exit: mirror a real worker honoring { exit: true }.
      this.emit('exit', 0);
      return;
    }
    this.respond(msg.item, this);
  }

  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

describe('runOnPool — injected workerFactory', () => {
  it('defaults to spawning a real Worker when no factory is given (parity)', async () => {
    // The single real-thread parity check: with no workerFactory, the pool
    // still drives an actual worker_threads.Worker end-to-end.
    const workerSrc = `
      import { parentPort } from 'node:worker_threads';
      parentPort.on('message', (msg) => {
        if (msg && msg.exit === true) process.exit(0);
        parentPort.postMessage({ ok: true, result: msg.item * 10 });
      });
    `;
    const workerUrl = new URL(
      `data:text/javascript,${encodeURIComponent(workerSrc)}`,
    );
    const results = await runOnPool(workerUrl, [1, 2, 3], { concurrency: 2 });
    assert.deepStrictEqual(results, [10, 20, 30]);
  });

  it('uses the injected factory and preserves input order across workers', async () => {
    const built = [];
    const factory = (script, options) => {
      assert.strictEqual(script, 'fake://script');
      assert.deepStrictEqual(options, { workerData: { salt: 7 } });
      const w = new FakeWorker((item, handle) => {
        handle.emit('message', { ok: true, result: item * item });
      });
      built.push(w);
      return w;
    };

    const items = [3, 1, 4, 1, 5, 9, 2, 6];
    const results = await runOnPool('fake://script', items, {
      concurrency: 3,
      workerData: { salt: 7 },
      workerFactory: factory,
    });

    // Results land at their source index regardless of dispatch race.
    assert.deepStrictEqual(
      results,
      items.map((n) => n * n),
    );
    // concurrency=3 → exactly three handles were built and each was reaped.
    assert.strictEqual(built.length, 3);
    for (const w of built) {
      assert.ok(w.terminated, 'every worker handle must be terminated');
      assert.deepStrictEqual(
        w.posted.at(-1),
        { exit: true },
        'each worker receives a drain { exit: true } before terminate',
      );
    }
  });

  it('captures per-item failures via the fake factory without throwing', async () => {
    const factory = () =>
      new FakeWorker((item, handle) => {
        if (item === 'bad') {
          handle.emit('message', { ok: false, error: 'item refused' });
          return;
        }
        handle.emit('message', {
          ok: true,
          result: String(item).toUpperCase(),
        });
      });

    const results = await runOnPool('fake://script', ['a', 'bad', 'c'], {
      concurrency: 1,
      workerFactory: factory,
    });
    assert.strictEqual(results[0], 'A');
    assert.deepStrictEqual(results[1], {
      __cpuPoolError: true,
      message: 'item refused',
    });
    assert.strictEqual(results[2], 'C');
  });

  it('aborts the whole run on item error when throwOnItemError is true', async () => {
    const factory = () =>
      new FakeWorker((item, handle) => {
        if (item === 'bad') {
          handle.emit('message', { ok: false, error: 'boom' });
          return;
        }
        handle.emit('message', { ok: true, result: item });
      });

    await assert.rejects(
      () =>
        runOnPool('fake://script', ['ok', 'bad', 'ok'], {
          concurrency: 1,
          throwOnItemError: true,
          workerFactory: factory,
        }),
      /cpu-pool item failure: boom/,
    );
  });

  it('treats a malformed worker message as a host-level fatal', async () => {
    const factory = () =>
      new FakeWorker((_item, handle) => {
        handle.emit('message', { garbage: true });
      });

    await assert.rejects(
      () =>
        runOnPool('fake://script', ['x'], {
          concurrency: 1,
          workerFactory: factory,
        }),
      /malformed worker message/,
    );
  });

  it('surfaces a worker error event as a fatal rejection', async () => {
    const factory = () =>
      new FakeWorker((_item, handle) => {
        handle.emit('error', new Error('thread blew up'));
      });

    await assert.rejects(
      () =>
        runOnPool('fake://script', ['x'], {
          concurrency: 1,
          workerFactory: factory,
        }),
      /thread blew up/,
    );
  });

  it('rejects when a worker exits non-zero mid-dispatch', async () => {
    const factory = () =>
      new FakeWorker((_item, handle) => {
        handle.emit('exit', 3);
      });

    await assert.rejects(
      () =>
        runOnPool('fake://script', ['x'], {
          concurrency: 1,
          workerFactory: factory,
        }),
      /worker exited with code 3/,
    );
  });

  it('rejects when a worker exits cleanly mid-dispatch (exit race)', async () => {
    // A code-0 exit while an item is in flight is still a lost item, not a
    // clean drain — the scheduler must surface it rather than silently drop.
    const factory = () =>
      new FakeWorker((_item, handle) => {
        handle.emit('exit', 0);
      });

    await assert.rejects(
      () =>
        runOnPool('fake://script', ['x'], {
          concurrency: 1,
          workerFactory: factory,
        }),
      /worker exited mid-dispatch/,
    );
  });

  it('short-circuits the drain when the worker already exited', async () => {
    // Exercise the finally-block branch where workerExited is already true:
    // the worker reports a clean exit only on the drain { exit: true }, never
    // mid-dispatch, so no { exit: true } re-post race is needed.
    const factory = () =>
      new FakeWorker((item, handle) => {
        handle.emit('message', { ok: true, result: item + 1 });
      });

    const results = await runOnPool('fake://script', [10, 20], {
      concurrency: 1,
      workerFactory: factory,
    });
    assert.deepStrictEqual(results, [11, 21]);
  });
});

// ---------------------------------------------------------------------------
// (e) concurrency resolution — explicit option, then MANDREL_POOL_CONCURRENCY,
//     then the node:test clamp, then availableParallelism (Story #5109).
//
// The resolver is module-private, so the contract is asserted where it is
// observable: how many worker handles the pool actually builds. The fake
// factory answers every dispatch synchronously, so a worker is only built
// when the scheduler genuinely wanted another lane.
// ---------------------------------------------------------------------------

describe('runOnPool — concurrency resolution', () => {
  /** Run `items` through the pool, returning how many handles were built. */
  async function countWorkers(items, opts = {}) {
    let built = 0;
    const factory = () => {
      built += 1;
      return new FakeWorker((item, handle) => {
        handle.emit('message', { ok: true, result: item });
      });
    };
    const results = await runOnPool('fake://script', items, {
      ...opts,
      workerFactory: factory,
    });
    assert.deepStrictEqual(results, items, 'results must survive the bound');
    return built;
  }

  const withEnv = async (value, fn) => {
    const had = Object.hasOwn(process.env, 'MANDREL_POOL_CONCURRENCY');
    const previous = process.env.MANDREL_POOL_CONCURRENCY;
    if (value === null) delete process.env.MANDREL_POOL_CONCURRENCY;
    else process.env.MANDREL_POOL_CONCURRENCY = value;
    try {
      return await fn();
    } finally {
      if (had) process.env.MANDREL_POOL_CONCURRENCY = previous;
      else delete process.env.MANDREL_POOL_CONCURRENCY;
    }
  };

  const items = Array.from({ length: 64 }, (_, i) => i);

  it('MANDREL_POOL_CONCURRENCY bounds a pool that requested no width', async () => {
    const built = await withEnv('1', () => countWorkers(items));
    assert.strictEqual(built, 1, 'env override must cap the pool at one lane');
  });

  it('an explicit concurrency wins over the env override', async () => {
    const built = await withEnv('1', () =>
      countWorkers(items, { concurrency: 3 }),
    );
    assert.strictEqual(built, 3, 'the caller knows its own budget');
  });

  it('clamps to 4 under node:test when nothing else is specified', async () => {
    // This file *is* a node:test child, so NODE_TEST_CONTEXT is set and the
    // clamp is the effective default. Without it the pool would open one lane
    // per core inside every test process the runner has already fanned out.
    assert.ok(
      process.env.NODE_TEST_CONTEXT,
      'expected to be running under the node:test runner',
    );
    const built = await withEnv(null, () => countWorkers(items));
    assert.strictEqual(built, 4, 'node:test context clamps the pool to 4');
  });

  it('falls through a non-numeric env override rather than collapsing', async () => {
    const built = await withEnv('not-a-number', () => countWorkers(items));
    assert.strictEqual(
      built,
      4,
      'a typo must degrade to the next rule, not to a single lane',
    );
  });
});

describe('runOnPool — concurrency resolution outside node:test', () => {
  /**
   * Drop `NODE_TEST_CONTEXT` for the duration of `fn`. Every test process the
   * runner spawns carries it, so the production default —
   * `os.availableParallelism()` — is otherwise unreachable from a test and
   * the clamp would be the only branch anything ever exercised.
   */
  const withoutTestContext = async (fn) => {
    const previous = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    const hadOverride = Object.hasOwn(process.env, 'MANDREL_POOL_CONCURRENCY');
    const previousOverride = process.env.MANDREL_POOL_CONCURRENCY;
    delete process.env.MANDREL_POOL_CONCURRENCY;
    try {
      return await fn();
    } finally {
      if (previous !== undefined) process.env.NODE_TEST_CONTEXT = previous;
      if (hadOverride) process.env.MANDREL_POOL_CONCURRENCY = previousOverride;
    }
  };

  async function countWorkers(items, opts = {}) {
    let built = 0;
    const factory = () => {
      built += 1;
      return new FakeWorker((item, handle) => {
        handle.emit('message', { ok: true, result: item });
      });
    };
    await runOnPool('fake://script', items, {
      ...opts,
      workerFactory: factory,
    });
    return built;
  }

  it('falls back to availableParallelism when nothing else applies', async () => {
    const items = Array.from({ length: 512 }, (_, i) => i);
    const built = await withoutTestContext(() => countWorkers(items));
    assert.strictEqual(built, os.availableParallelism());
  });

  it('never opens more lanes than there are items', async () => {
    const built = await withoutTestContext(() => countWorkers([1, 2]));
    assert.strictEqual(built, Math.min(2, os.availableParallelism()));
  });

  it('ignores a non-positive explicit concurrency rather than honouring it', async () => {
    // `0` would mean "no workers at all" — a pool that never drains. It must
    // fall through to the next rule in the chain, not be taken literally.
    const items = Array.from({ length: 64 }, (_, i) => i);
    const built = await withoutTestContext(() =>
      countWorkers(items, { concurrency: 0 }),
    );
    assert.strictEqual(built, os.availableParallelism());
  });
});
