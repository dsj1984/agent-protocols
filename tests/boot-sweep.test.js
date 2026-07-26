import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSummaryLine,
  runBootSweep,
  runBootSweepCli,
} from '../.agents/scripts/boot-sweep.js';

/**
 * Story #4780 — the boot sweep's CLI shell scored CRAP 72: the argv →
 * sweep → render path (the one `/deliver` and `/plan` call at boot) was
 * unreached, so a flag that silently stopped reaching the engine would have
 * shipped green.
 *
 * The sweep engine and the log sink are injected through the optional final
 * `deps` parameter (`.agents/rules/test-seams.md` rules 1 and 5), so no real
 * branch is ever reaped by this suite.
 */

function harness(result = {}) {
  const infos = [];
  const calls = [];
  return {
    infos,
    calls,
    deps: {
      runBootSweepImpl: async (args) => {
        calls.push(args);
        return {
          ok: true,
          localDeleted: 0,
          remoteDeleted: 0,
          protected: [],
          contentMerged: [],
          ...result,
        };
      },
      logger: { info: (m) => infos.push(m) },
    },
  };
}

describe('buildSummaryLine', () => {
  it('stays silent about content-merged branches when there are none', () => {
    assert.equal(
      buildSummaryLine({ localDeleted: 2, remoteDeleted: 1, protected: ['a'] }),
      '[boot-sweep] reaped 2 local + 1 remote; protected 1.',
    );
  });

  it('appends the /git-cleanup routing hint when content-merged branches exist', () => {
    assert.match(
      buildSummaryLine({
        localDeleted: 0,
        remoteDeleted: 0,
        contentMerged: ['x', 'y'],
      }),
      /2 content-merged branch\(es\) left for \/git-cleanup/,
    );
  });

  it('treats missing protected/contentMerged arrays as zero', () => {
    assert.equal(
      buildSummaryLine({ localDeleted: 0, remoteDeleted: 0 }),
      '[boot-sweep] reaped 0 local + 0 remote; protected 0.',
    );
  });
});

describe('runBootSweepCli', () => {
  it('prints HELP and runs no sweep under --help', async () => {
    const h = harness();
    const result = await runBootSweepCli(['--help'], h.deps);
    assert.equal(result, undefined);
    assert.equal(h.calls.length, 0);
    assert.match(h.infos[0], /Usage: node \.agents\/scripts\/boot-sweep\.js/);
  });

  it('honours the -h short flag', async () => {
    const h = harness();
    await runBootSweepCli(['-h'], h.deps);
    assert.equal(h.calls.length, 0);
  });

  it('defaults to a fast-forwarding sweep with no include/exclude overrides', async () => {
    const h = harness();
    await runBootSweepCli([], h.deps);
    assert.deepEqual(h.calls[0], {
      cwd: undefined,
      base: undefined,
      include: [],
      exclude: [],
      current: undefined,
      fastForward: true,
    });
  });

  it('threads --cwd, --base, --current and repeated --include/--exclude', async () => {
    const h = harness();
    await runBootSweepCli(
      [
        '--cwd',
        '/repo',
        '--base',
        'trunk',
        '--current',
        'story-1',
        '--include',
        'story-*',
        '--include',
        'fix-*',
        '--exclude',
        'story-9',
      ],
      h.deps,
    );
    assert.deepEqual(h.calls[0], {
      cwd: '/repo',
      base: 'trunk',
      include: ['story-*', 'fix-*'],
      exclude: ['story-9'],
      current: 'story-1',
      fastForward: true,
    });
  });

  it('turns the fast-forward off under --no-fast-forward', async () => {
    const h = harness();
    await runBootSweepCli(['--no-fast-forward'], h.deps);
    assert.equal(h.calls[0].fastForward, false);
  });

  it('renders the one-line summary by default', async () => {
    const h = harness({ localDeleted: 3, remoteDeleted: 2 });
    const result = await runBootSweepCli([], h.deps);
    assert.equal(
      h.infos[0],
      '[boot-sweep] reaped 3 local + 2 remote; protected 0.',
    );
    assert.equal(result.localDeleted, 3);
  });

  it('renders the full envelope under --json', async () => {
    const h = harness({ localDeleted: 1 });
    await runBootSweepCli(['--json'], h.deps);
    assert.equal(JSON.parse(h.infos[0]).localDeleted, 1);
  });
});

describe('runBootSweep', () => {
  it('swallows a throwing sweep and returns the skipped envelope (host continues)', async () => {
    const warns = [];
    const result = await runBootSweep({
      cwd: '/repo',
      injectedConfig: { project: { baseBranch: 'main' } },
      injectedProvider: {},
      injectedSweep: () => {
        throw new Error('lock contention');
      },
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.error, 'lock contention');
    assert.match(warns[0], /sweep threw \(host continues\): lock contention/);
  });

  it('defaults the include glob to story-* and appends --current to the excludes', async () => {
    let seen;
    await runBootSweep({
      cwd: '/repo',
      current: 'story-4780',
      injectedConfig: { project: { baseBranch: 'main' } },
      injectedProvider: {},
      injectedSweep: async (args) => {
        seen = args;
        return { ok: true };
      },
      logger: { info: () => {}, warn: () => {} },
    });
    assert.deepEqual(seen.include, ['story-*']);
    assert.deepEqual(seen.exclude, ['story-4780']);
    assert.equal(seen.baseBranch, 'main');
    assert.equal(seen.logTag, '[boot-sweep]');
  });
});
