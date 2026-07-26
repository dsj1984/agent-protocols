import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { main } from '../.agents/scripts/plan-run-epilogue.js';

/**
 * Story #4780 — `main` scored CRAP 39.6: the per-run closeout's id parsing,
 * its synthesized `adhoc-<ids>` run id, and both loud operator warnings (the
 * unresolvable landed diff and the suspiciously-empty friction roll-up) were
 * unreached.
 *
 * Config, provider, epilogue engine and log sink are injected through the
 * optional final `deps` parameter (`.agents/rules/test-seams.md` rules 1 and
 * 5) — no GitHub call, no module mocking.
 */

const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
});

function harness(result = { results: [] }) {
  const info = [];
  const warn = [];
  const calls = [];
  return {
    info,
    warn,
    calls,
    deps: {
      resolveConfigImpl: (args) => ({ resolvedFor: args.cwd }),
      createProviderImpl: (config) => ({ providerFor: config.resolvedFor }),
      runPlanRunEpilogueImpl: async (args) => {
        calls.push(args);
        return result;
      },
      logger: { info: (m) => info.push(m), warn: (m) => warn.push(m) },
    },
  };
}

describe('plan-run-epilogue main', () => {
  it('refuses an invocation with no --stories', async () => {
    for (const argv of [[], ['--stories', '   ']]) {
      await assert.rejects(
        () => main(argv, harness().deps),
        /Usage: node plan-run-epilogue\.js --stories 1,2,3/,
      );
    }
  });

  it('synthesizes a sorted adhoc run id from the delivered ids', async () => {
    const h = harness();
    await main(['--stories', '30,4,12'], h.deps);
    assert.equal(h.calls[0].planRunId, 'adhoc-4-12-30');
    assert.deepEqual(h.calls[0].stories, [30, 4, 12]);
  });

  it('drops non-integer and non-positive ids', async () => {
    const h = harness();
    await main(['--stories', '5, abc ,0,-2, 7 '], h.deps);
    assert.deepEqual(h.calls[0].stories, [5, 7]);
    assert.equal(h.calls[0].planRunId, 'adhoc-5-7');
  });

  it('defaults cwd to the process cwd and threads --cwd when given', async () => {
    const bare = harness();
    await main(['--stories', '1'], bare.deps);
    assert.equal(bare.calls[0].cwd, process.cwd());

    const explicit = harness();
    await main(['--stories', '1', '--cwd', '  /repo  '], explicit.deps);
    assert.equal(explicit.calls[0].cwd, '/repo');
    assert.deepEqual(explicit.calls[0].config, { resolvedFor: '/repo' });
    assert.deepEqual(explicit.calls[0].provider, { providerFor: '/repo' });
  });

  it('prints the envelope as a single JSON line and leaves the exit code alone', async () => {
    const h = harness({ results: [], ok: true });
    const result = await main(['--stories', '1'], h.deps);
    assert.deepEqual(JSON.parse(h.info[0]), result);
    assert.equal(process.exitCode, originalExitCode);
  });

  it('sets a non-zero exit code when the epilogue reports errors', async () => {
    const h = harness({ results: [], errors: ['boom'] });
    await main(['--stories', '1'], h.deps);
    assert.equal(process.exitCode, 1);
  });

  it('warns loudly when the combined landed diff could not be resolved', async () => {
    const h = harness({
      results: [
        {
          kind: 'audit-roster',
          baseResolution: {
            resolved: false,
            baseRef: 'main',
            reason: 'no merge base',
          },
        },
      ],
    });
    await main(['--stories', '1'], h.deps);
    assert.match(h.warn[0], /Combined landed diff unavailable/);
    assert.match(h.warn[0], /changedFiles is null \(NOT an empty set\)/);
  });

  it('stays quiet when the base resolved', async () => {
    const h = harness({
      results: [{ kind: 'audit-roster', baseResolution: { resolved: true } }],
    });
    await main(['--stories', '1'], h.deps);
    assert.deepEqual(h.warn, []);
  });

  it('warns loudly on a zero-signal roll-up over a multi-Story run', async () => {
    const h = harness({
      results: [
        { kind: 'follow-up-rollup', emptyRollupSuspect: true, storyCount: 7 },
      ],
    });
    await main(['--stories', '1,2'], h.deps);
    assert.match(h.warn[0], /0 friction signals across 7 Stories/);
    assert.match(h.warn[0], /An empty roll-up is NOT evidence of a clean run/);
  });

  it('stays quiet when the roll-up is not suspect', async () => {
    const h = harness({
      results: [
        { kind: 'follow-up-rollup', emptyRollupSuspect: false, storyCount: 2 },
      ],
    });
    await main(['--stories', '1,2'], h.deps);
    assert.deepEqual(h.warn, []);
  });

  it('tolerates an envelope with no results array at all', async () => {
    const h = harness({});
    await main(['--stories', '1'], h.deps);
    assert.deepEqual(h.warn, []);
    assert.equal(h.info.length, 1);
  });
});
