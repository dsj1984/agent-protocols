import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runDrainPendingCleanup } from '../.agents/scripts/drain-pending-cleanup.js';

/**
 * Story #4780 — the force-drain CLI scored CRAP 110, the worst untested
 * entrypoint in the repo: every reporting branch (dry-run, escalation,
 * kernel-held locks, persistent locks, still-pending) was unreached, on a
 * tool whose escalation path terminates processes.
 *
 * Everything it touches — config, the manifest reader, the holder probe, the
 * drain engine, git, and the progress sink — is injected through the optional
 * final `deps` parameter (`.agents/rules/test-seams.md` rules 1 and 5).
 */

const ROOT = path.resolve(path.sep, 'repo');

function harness({ before = [], after = [], result = {}, holders = [] } = {}) {
  const progress = [];
  const errors = [];
  const drainArgs = [];
  let readCount = 0;
  return {
    progress,
    errors,
    drainArgs,
    deps: {
      resolveConfigImpl: () => ({ delivery: { worktreeIsolation: {} } }),
      readManifestImpl: () => {
        readCount += 1;
        return readCount === 1 ? before : after;
      },
      findHoldersInPathImpl: () => holders,
      forceDrainImpl: async (args) => {
        drainArgs.push(args);
        args.logger.info('engine says hello');
        args.logger.warn('engine is worried');
        args.logger.error('engine failed a step');
        return {
          drained: [],
          escalated: [],
          killedPids: {},
          noHolders: [],
          persistent: [],
          stillPending: [],
          ...result,
        };
      },
      gitImpl: { marker: 'git-utils' },
      projectRoot: ROOT,
      progressImpl: (phase, message) => progress.push(`${phase}: ${message}`),
      logger: { error: (m) => errors.push(m) },
    },
  };
}

describe('runDrainPendingCleanup', () => {
  it('short-circuits on an empty manifest without invoking the engine', async () => {
    const h = harness();
    const result = await runDrainPendingCleanup([], h.deps);
    assert.deepEqual(result, { remaining: 0 });
    assert.equal(h.drainArgs.length, 0);
    assert.equal(
      h.progress[0],
      'SCAN: pending-cleanup manifest is empty — nothing to drain.',
    );
  });

  it('reports every entry and its holders under --dry-run, removing nothing', async () => {
    const h = harness({
      before: [{ storyId: 11, path: '/w/story-11', attempts: 2 }],
      holders: [{ pid: 42, name: 'node' }],
    });
    const result = await runDrainPendingCleanup(['--dry-run'], h.deps);
    assert.deepEqual(result, { remaining: 1 });
    assert.equal(h.drainArgs.length, 0);
    assert.match(
      h.progress[0],
      /manifest has 1 entry\(ies\): story-11\(attempts=2\)/,
    );
    assert.match(
      h.progress[1],
      /DRY-RUN: story-11 path=\/w\/story-11 holders=1 \(pid=42\/node\)/,
    );
  });

  it('omits the holder list in dry-run when nothing holds the path', async () => {
    const h = harness({ before: [{ storyId: 11, path: '/w/story-11' }] });
    await runDrainPendingCleanup(['--dry-run'], h.deps);
    assert.match(h.progress[0], /attempts=0/);
    assert.equal(h.progress[1], 'DRY-RUN: story-11 path=/w/story-11 holders=0');
  });

  it('resolves the worktree root against the project root and the config default', async () => {
    const h = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup([], h.deps);
    assert.equal(h.drainArgs[0].worktreeRoot, path.resolve(ROOT, '.worktrees'));
    assert.equal(h.drainArgs[0].repoRoot, ROOT);
    assert.deepEqual(h.drainArgs[0].git, { marker: 'git-utils' });
    assert.equal(h.drainArgs[0].escalate, true);
  });

  it('honours --worktree-root', async () => {
    const h = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup(['--worktree-root', 'custom-trees'], h.deps);
    assert.equal(
      h.drainArgs[0].worktreeRoot,
      path.resolve(ROOT, 'custom-trees'),
    );
  });

  it('escalates unless `escalate` is explicitly parsed false', async () => {
    // Characterisation, not endorsement: `node:util.parseArgs` only honours a
    // `--no-<flag>` spelling when `allowNegative` is set, which this CLI does
    // not set. `--no-escalate` therefore lands in `values['no-escalate']` and
    // leaves `values.escalate` at its `true` default — the documented
    // passive-drain flag is inert. Pinned here so the pre-existing gap is
    // visible rather than silently re-introduced; changing it would be an
    // observable CLI behaviour change, which this Story explicitly excludes.
    const h = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup(['--no-escalate'], h.deps);
    assert.equal(h.drainArgs[0].escalate, true);

    const explicit = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup(['--escalate=false'], explicit.deps);
    assert.equal(explicit.drainArgs[0].escalate, 'false');
  });

  it('routes the engine logger through progress and the error sink', async () => {
    const h = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup([], h.deps);
    assert.ok(h.progress.includes('DRAIN: engine says hello'));
    assert.ok(h.progress.includes('DRAIN: ⚠️ engine is worried'));
    assert.deepEqual(h.errors, [
      '[drain-pending-cleanup] engine failed a step',
    ]);
  });

  it('reports drained, escalated, kernel-held, persistent and still-pending entries', async () => {
    const h = harness({
      before: [{ storyId: 1, path: '/w' }],
      after: [{ storyId: 4, path: '/w4' }],
      result: {
        drained: [1],
        escalated: [2],
        killedPids: { 2: [101, 102] },
        noHolders: [3],
        persistent: [4],
        stillPending: [5],
      },
    });
    const result = await runDrainPendingCleanup([], h.deps);
    const joined = h.progress.join('\n');
    assert.match(joined, /DRAIN: ✅ drained 1 entry\(ies\): story-1/);
    assert.match(joined, /ESCALATE: terminated holders: story-2=\[101,102\]/);
    assert.match(joined, /no user-mode holders for: story-3/);
    assert.match(joined, /persistent-lock remains on: story-4/);
    assert.match(joined, /still-pending \(below threshold\): story-5/);
    assert.match(
      joined,
      /DONE: pending-cleanup manifest now has 1 entry\(ies\)/,
    );
    assert.deepEqual(result, { drained: [1], remaining: 1 });
  });

  it('omits every optional report line when the engine drained nothing', async () => {
    const h = harness({ before: [{ storyId: 1, path: '/w' }] });
    await runDrainPendingCleanup([], h.deps);
    const joined = h.progress.join('\n');
    assert.doesNotMatch(joined, /drained/);
    assert.doesNotMatch(joined, /terminated holders/);
    assert.doesNotMatch(joined, /persistent-lock/);
    assert.match(joined, /DONE:/);
  });
});
