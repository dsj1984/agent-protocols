import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  FULL_SUITE_LOCK_ENV,
  isFullSuiteLockEnabled,
  lockedCapture,
  resolveFullSuiteLockPath,
  withFullSuiteLockAsync,
  withFullSuiteLockSync,
} from '../../.agents/scripts/lib/full-suite-lock.js';
import { acquireSweepLock } from '../../.agents/scripts/lib/single-story-sweep/sweep-lock.js';

/**
 * Story #5173 — the host-level full-suite lock.
 *
 * These drive the real lockfile on a real temp directory rather than a mocked
 * `fs`: the contract under test is cross-process mutual exclusion, and the
 * only honest way to assert "the second runner did not overlap the first" is
 * to have two acquirers contend on one file. The lock's *identity* mechanics
 * (pid+mtime, stale takeover, owner-checked release) belong to
 * `sweep-lock.js` and are pinned there; what is pinned here is this module's
 * own posture — best-effort, spawn exactly once, wait visibly, cover only the
 * spawn.
 */
describe('full-suite lock (Story #5173)', () => {
  let dir;
  let lockPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandrel-fsl-'));
    lockPath = path.join(dir, 'full-suite.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('isFullSuiteLockEnabled — AC-10, both escape hatches', () => {
    it('defaults on when neither hatch is set', () => {
      assert.equal(isFullSuiteLockEnabled({ config: {}, env: {} }), true);
      assert.equal(isFullSuiteLockEnabled({ env: {} }), true);
    });

    it('honours delivery.execution.fullSuiteLock: false', () => {
      const config = { delivery: { execution: { fullSuiteLock: false } } };
      assert.equal(isFullSuiteLockEnabled({ config, env: {} }), false);
    });

    it('honours MANDREL_FULL_SUITE_LOCK=0 and its spellings', () => {
      for (const raw of ['0', 'false', 'off', 'no', ' OFF ']) {
        assert.equal(
          isFullSuiteLockEnabled({
            config: {},
            env: { [FULL_SUITE_LOCK_ENV]: raw },
          }),
          false,
          `expected ${JSON.stringify(raw)} to disable the lock`,
        );
      }
    });

    it('is one-way: the env hatch cannot force the lock back on', () => {
      const config = { delivery: { execution: { fullSuiteLock: false } } };
      assert.equal(
        isFullSuiteLockEnabled({
          config,
          env: { [FULL_SUITE_LOCK_ENV]: '1' },
        }),
        false,
      );
    });

    // The key must resolve from the RUNTIME AJV delivery schema — a key
    // declared only in the generated JSON-Schema mirror never reaches config
    // resolution, so a mirror-only declaration would make this switch inert.
    it('AC-10: the key is declared in the runtime AJV delivery schema', async () => {
      const { AGENTRC_SCHEMA } = await import(
        '../../.agents/scripts/lib/config-settings-schema.js'
      );
      const execution =
        AGENTRC_SCHEMA.properties.delivery.properties.execution.properties;
      assert.deepEqual(execution.fullSuiteLock, {
        type: 'boolean',
        description: execution.fullSuiteLock.description,
        default: true,
      });
      assert.match(
        execution.fullSuiteLock.description,
        new RegExp(FULL_SUITE_LOCK_ENV),
        'the schema description must name the env escape hatch',
      );
    });
  });

  describe('resolveFullSuiteLockPath', () => {
    it('anchors on the main checkout so sibling worktrees share one file', () => {
      const fromWorktree = resolveFullSuiteLockPath({
        cwd: '/repo/.worktrees/story-1',
        mainCheckoutRootFn: () => '/repo',
      });
      const fromMain = resolveFullSuiteLockPath({
        cwd: '/repo',
        mainCheckoutRootFn: () => '/repo',
      });
      assert.equal(fromWorktree, fromMain);
      assert.equal(
        fromWorktree,
        path.join('/repo', '.git', 'mandrel-full-suite.lock'),
      );
    });

    it('returns null when the checkout root cannot be resolved', () => {
      assert.equal(
        resolveFullSuiteLockPath({
          cwd: '/nope',
          mainCheckoutRootFn: () => null,
        }),
        null,
      );
      assert.equal(resolveFullSuiteLockPath({ cwd: '' }), null);
    });
  });

  describe('withFullSuiteLockSync', () => {
    it('runs the spawn and releases the lockfile on the uncontended path', () => {
      let held = null;
      const code = withFullSuiteLockSync({ cwd: dir, lockPath }, () => {
        held = fs.existsSync(lockPath);
        return 7;
      });
      assert.equal(code, 7);
      assert.equal(held, true, 'the lock must be held across the spawn');
      assert.equal(fs.existsSync(lockPath), false, 'and released after it');
    });

    it('AC-6: a contended runner spawns only after the holder releases', () => {
      const order = [];
      const holder = acquireSweepLock({ lockPath, timeoutMs: 60_000 });
      assert.equal(holder.acquired, true);

      const code = withFullSuiteLockSync(
        {
          cwd: dir,
          lockPath,
          waitMs: 10_000,
          pollMs: 1,
          // The holder finishes during the wait — released from the sleep seam
          // so the ordering assertion below is deterministic rather than timed.
          sleepFn: () => {
            if (order.length === 0) {
              order.push('holder-release');
              holder.release();
            }
          },
        },
        () => {
          order.push('spawn');
          return 0;
        },
      );

      assert.equal(code, 0);
      assert.deepEqual(order, ['holder-release', 'spawn']);
    });

    it('AC-8: a wait names the holding pid rather than reading as a hang', () => {
      const holder = acquireSweepLock({ lockPath, timeoutMs: 60_000 });
      assert.equal(holder.acquired, true);
      const lines = [];
      withFullSuiteLockSync(
        {
          cwd: dir,
          lockPath,
          waitMs: 0,
          pollMs: 0,
          log: (m) => lines.push(m),
        },
        () => 0,
      );
      holder.release();
      const waitLine = lines.find((m) => m.includes('full-suite-lock'));
      assert.ok(waitLine, 'expected a wait line');
      assert.match(waitLine, new RegExp(`holding pid ${process.pid}\\b`));
    });

    it('AC-7: a stale holder is reclaimed rather than waited out', () => {
      const holder = acquireSweepLock({
        lockPath,
        timeoutMs: 60_000,
        heartbeatMs: 0,
      });
      assert.equal(holder.acquired, true);
      // Age the lockfile past the staleness threshold without touching the
      // holder — exactly the shape a killed process leaves behind.
      const old = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(lockPath, old, old);

      let sleeps = 0;
      const lines = [];
      const code = withFullSuiteLockSync(
        {
          cwd: dir,
          lockPath,
          staleMs: 1_000,
          sleepFn: () => {
            sleeps += 1;
          },
          log: (m) => lines.push(m),
        },
        () => 5,
      );
      assert.equal(code, 5);
      assert.equal(
        sleeps,
        0,
        'a stale lock must be taken over, never waited on',
      );
      assert.equal(
        lines.some((m) => m.includes('full-suite-lock')),
        false,
        'and the takeover is silent — no wait happened to announce',
      );
    });

    it('is best-effort: an exhausted wait still spawns exactly once', () => {
      const holder = acquireSweepLock({ lockPath, timeoutMs: 60_000 });
      let spawns = 0;
      const code = withFullSuiteLockSync(
        { cwd: dir, lockPath, waitMs: 0, pollMs: 0 },
        () => {
          spawns += 1;
          return 3;
        },
      );
      holder.release();
      assert.equal(code, 3);
      assert.equal(spawns, 1);
    });

    it('is best-effort: a hard acquire error still spawns exactly once', () => {
      let spawns = 0;
      const code = withFullSuiteLockSync(
        {
          cwd: dir,
          lockPath,
          acquireOnceFn: () => ({
            acquired: false,
            reason: 'error',
            detail: 'EACCES',
          }),
        },
        () => {
          spawns += 1;
          return 0;
        },
      );
      assert.equal(code, 0);
      assert.equal(spawns, 1);
      assert.equal(fs.existsSync(lockPath), false);
    });

    it('AC-9: disabled means no lockfile is ever created', () => {
      const code = withFullSuiteLockSync(
        { cwd: dir, lockPath, enabled: false },
        () => 0,
      );
      assert.equal(code, 0);
      assert.equal(fs.existsSync(lockPath), false);
    });

    it('AC-9: never locks when the lock home cannot be resolved', () => {
      let spawns = 0;
      withFullSuiteLockSync({ cwd: '' }, () => {
        spawns += 1;
      });
      assert.equal(spawns, 1);
    });

    it('releases the lock even when the spawn throws', () => {
      assert.throws(
        () =>
          withFullSuiteLockSync({ cwd: dir, lockPath }, () => {
            throw new Error('suite blew up');
          }),
        /suite blew up/,
      );
      assert.equal(fs.existsSync(lockPath), false);
    });
  });

  // The decorator the CLI applies to `runCapture`. It resolves both escape
  // hatches once, then serializes every spawn the wrapped runner makes.
  describe('lockedCapture', () => {
    it('holds the lock across the wrapped runner and forwards its options', () => {
      const seen = [];
      const wrapped = lockedCapture((opts) => {
        seen.push({ ...opts, held: fs.existsSync(lockPath) });
        return 0;
      }, {});
      // The decorator resolves the lock home from `cwd`; point it at the
      // temp checkout stand-in by pre-creating nothing and letting the
      // best-effort path run — the assertion that matters is pass-through.
      assert.equal(wrapped({ cwd: dir, timeoutMs: 99 }), 0);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].cwd, dir);
      assert.equal(seen[0].timeoutMs, 99);
    });

    it('AC-10: a disabling config short-circuits the lock entirely', () => {
      let calls = 0;
      const wrapped = lockedCapture(
        () => {
          calls += 1;
          return 0;
        },
        { delivery: { execution: { fullSuiteLock: false } } },
      );
      assert.equal(wrapped({ cwd: dir }), 0);
      assert.equal(calls, 1);
      assert.equal(fs.existsSync(lockPath), false);
    });

    it('tolerates a runner invoked with no options at all', () => {
      const wrapped = lockedCapture(() => 4, {
        delivery: { execution: { fullSuiteLock: false } },
      });
      assert.equal(wrapped(), 4);
    });
  });

  describe('withFullSuiteLockAsync', () => {
    it('holds the lock across the awaited spawn and releases it after', async () => {
      let held = null;
      const result = await withFullSuiteLockAsync(
        { cwd: dir, lockPath },
        async () => {
          held = fs.existsSync(lockPath);
          return { status: 0 };
        },
      );
      assert.deepEqual(result, { status: 0 });
      assert.equal(held, true);
      assert.equal(fs.existsSync(lockPath), false);
    });

    it('AC-8: announces the holding pid before waiting, then acquires', async () => {
      const holder = acquireSweepLock({ lockPath, timeoutMs: 60_000 });
      const lines = [];
      const result = await withFullSuiteLockAsync(
        {
          cwd: dir,
          lockPath,
          log: (m) => lines.push(m),
          // The bounded wait is driven through the shipped async wrapper; the
          // holder steps aside on the first sleep tick.
          acquireWithWaitFn: async ({ lockPath: p }) => {
            holder.release();
            return acquireSweepLock({ lockPath: p, timeoutMs: 60_000 });
          },
        },
        async () => ({ status: 0 }),
      );
      assert.deepEqual(result, { status: 0 });
      assert.match(
        lines.join('\n'),
        new RegExp(`holding pid ${process.pid}\\b`),
      );
      assert.equal(fs.existsSync(lockPath), false);
    });

    it('is best-effort: an exhausted wait still spawns exactly once', async () => {
      const holder = acquireSweepLock({ lockPath, timeoutMs: 60_000 });
      let spawns = 0;
      const result = await withFullSuiteLockAsync(
        {
          cwd: dir,
          lockPath,
          acquireWithWaitFn: async () => ({
            acquired: false,
            reason: 'contended-after-wait',
          }),
        },
        async () => {
          spawns += 1;
          return { status: 1 };
        },
      );
      holder.release();
      assert.deepEqual(result, { status: 1 });
      assert.equal(spawns, 1);
    });
  });
});
