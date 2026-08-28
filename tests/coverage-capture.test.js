import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  parseArgs,
  runCoverageCapture,
} from '../.agents/scripts/coverage-capture.js';
import { handleCoverageCaptureHelp } from '../.agents/scripts/lib/coverage-capture-usage.js';

/**
 * Story #4780 — `main` scored CRAP 42.7: the gate that decides whether
 * `npm run test:coverage` runs before the CRAP gate fires had no unit test,
 * because the module used to `process.exit()` on import. It is now guarded by
 * a direct-invocation check, and its decision table is driven entirely
 * through the optional final `deps` parameter (`.agents/rules/test-seams.md`
 * rules 1 and 5) — no suite is ever spawned by this file.
 */

const CRAP = {
  enabled: true,
  targetDirs: ['.agents/scripts', 'lib'],
  coveragePath: 'coverage/coverage-final.json',
};

function harness({
  crap = CRAP,
  fresh = { fresh: true, reason: 'fresh' },
  changed = ['.agents/scripts/a.js'],
  captureCode = 0,
  hasScript = true,
  digest = 'deadbeef',
  stampWritten = true,
} = {}) {
  const log = { info: [], warn: [], error: [] };
  const calls = { capture: [], stamp: [], changed: [], fresh: [] };
  return {
    log,
    calls,
    deps: {
      resolveConfigImpl: (args) => ({ cwdSeen: args.cwd }),
      getQualityImpl: () => ({ crap, coverage: { timeoutMs: 1234 } }),
      readPackageScriptsImpl: () => ({ 'test:coverage': 'node --test' }),
      hasNpmScriptImpl: () => hasScript,
      getChangedFilesImpl: (args) => {
        calls.changed.push(args);
        if (changed === 'throw') throw new Error('bad ref');
        return changed;
      },
      isCoverageFreshImpl: (args) => {
        calls.fresh.push(args);
        return fresh;
      },
      runCaptureImpl: (args) => {
        calls.capture.push(args);
        args.log('capture says hello');
        return captureCode;
      },
      computeContentDigestImpl: () => digest,
      writeCaptureStampImpl: (args) => {
        calls.stamp.push(args);
        return stampWritten;
      },
      logger: {
        info: (m) => log.info.push(m),
        warn: (m) => log.warn.push(m),
        error: (m) => log.error.push(m),
      },
    },
  };
}

const argv = (...flags) => ['node', 'coverage-capture.js', ...flags];

describe('coverage-capture parseArgs', () => {
  it('defaults to a non-skipping capture against main in the cwd', () => {
    const parsed = parseArgs(argv());
    assert.equal(parsed.skipWhenNoCrapFiles, false);
    assert.equal(parsed.ref, 'main');
    assert.equal(parsed.cwd, process.cwd());
  });

  it('reads --skip-when-no-crap-files, --ref and --cwd', () => {
    const parsed = parseArgs(
      argv('--skip-when-no-crap-files', '--ref', 'develop', '--cwd', '/repo'),
    );
    assert.deepEqual(parsed, {
      skipWhenNoCrapFiles: true,
      ref: 'develop',
      cwd: '/repo',
    });
  });

  it('keeps the defaults when a value-taking flag has no value', () => {
    const parsed = parseArgs(argv('--ref'));
    assert.equal(parsed.ref, 'main');
  });
});

// The delivery workflow invokes this script by name, so it owes the
// workflow-invoked self-description contract
// (tests/enforcement/workflow-script-help.test.js). Before this wiring
// `--help` fell through to the capture path and ran the whole coverage suite,
// which is why the CLI shell answers it ahead of `runCoverageCapture`.
describe('handleCoverageCaptureHelp', () => {
  it('prints the usage block and reports that the run must stop', () => {
    const out = [];
    const sink = { write: (s) => out.push(s) };
    assert.equal(handleCoverageCaptureHelp(argv('--help'), sink), true);
    assert.match(out.join(''), /coverage-capture\.js/);
    assert.match(out.join(''), /--skip-when-no-crap-files/);
    assert.match(out.join(''), /--ref/);
  });

  it('accepts the -h alias', () => {
    const out = [];
    assert.equal(
      handleCoverageCaptureHelp(argv('-h'), { write: (s) => out.push(s) }),
      true,
    );
    assert.ok(out.join('').trim().length > 0);
  });

  it('stays out of the way of a normal invocation', () => {
    const out = [];
    assert.equal(
      handleCoverageCaptureHelp(argv('--ref', 'main'), {
        write: (s) => out.push(s),
      }),
      false,
    );
    assert.equal(out.length, 0);
  });
});

describe('runCoverageCapture', () => {
  it('exits 0 immediately when the CRAP gate is disabled', () => {
    const h = harness({ crap: { ...CRAP, enabled: false } });
    assert.equal(runCoverageCapture(argv(), h.deps), 0);
    assert.equal(h.calls.capture.length, 0);
    assert.match(h.log.info[0], /CRAP gate disabled — skipping capture/);
  });

  it('fails with a fix-naming diagnostic when there is no test:coverage script', () => {
    const h = harness({ hasScript: false });
    assert.equal(runCoverageCapture(argv(), h.deps), 1);
    assert.match(h.log.error[0], /No "test:coverage" script in package\.json/);
    assert.equal(h.calls.capture.length, 0);
  });

  it('skips the capture when no changed file lives under the target dirs', () => {
    const h = harness({ changed: ['README.md'] });
    assert.equal(
      runCoverageCapture(argv('--skip-when-no-crap-files'), h.deps),
      0,
    );
    assert.equal(h.calls.fresh.length, 0);
    assert.match(
      h.log.info[0],
      /No changed files under \[\.agents\/scripts, lib\]/,
    );
  });

  it('proceeds to the freshness check when a target-dir file changed', () => {
    const h = harness({ changed: ['.agents/scripts/a.js'] });
    assert.equal(
      runCoverageCapture(argv('--skip-when-no-crap-files'), h.deps),
      0,
    );
    assert.equal(h.calls.fresh.length, 1);
  });

  it('never consults changed files without the skip flag', () => {
    const h = harness();
    runCoverageCapture(argv(), h.deps);
    assert.equal(h.calls.changed.length, 0);
  });

  it('warns and falls back to the freshness check when the ref is bad', () => {
    const h = harness({ changed: 'throw' });
    assert.equal(
      runCoverageCapture(
        argv('--skip-when-no-crap-files', '--ref', 'nope'),
        h.deps,
      ),
      0,
    );
    assert.match(h.log.warn[0], /bad ref — falling back to freshness check/);
    assert.equal(h.calls.fresh.length, 1);
  });

  it('skips the capture when coverage is already fresh', () => {
    const h = harness({ fresh: { fresh: true, reason: 'content-identical' } });
    assert.equal(runCoverageCapture(argv('--cwd', '/repo'), h.deps), 0);
    assert.equal(h.calls.capture.length, 0);
    assert.match(
      h.log.info[0],
      new RegExp(
        `Coverage at ${path.resolve('/repo', CRAP.coveragePath).replace(/\\/g, '\\\\')} is content-identical`,
      ),
    );
  });

  it('captures, stamps, and returns 0 when coverage is stale', () => {
    const h = harness({ fresh: { fresh: false, reason: 'stale' } });
    assert.equal(runCoverageCapture(argv('--cwd', '/repo'), h.deps), 0);
    assert.deepEqual(h.calls.capture[0].cwd, '/repo');
    assert.equal(h.calls.capture[0].timeoutMs, 1234);
    assert.deepEqual(h.calls.stamp[0], {
      cwd: '/repo',
      coveragePath: CRAP.coveragePath,
      digest: 'deadbeef',
    });
    assert.ok(h.log.info.includes('capture says hello'));
    assert.ok(
      h.log.info.some((m) => /Wrote content-digest capture stamp/.test(m)),
    );
  });

  it('propagates a failing capture and never writes a stamp', () => {
    const h = harness({
      fresh: { fresh: false, reason: 'missing' },
      captureCode: 2,
    });
    assert.equal(runCoverageCapture(argv(), h.deps), 2);
    assert.equal(h.calls.stamp.length, 0);
    assert.match(h.log.error[0], /npm run test:coverage exited 2/);
  });

  it('treats an unavailable digest as a best-effort skip, not a failure', () => {
    const h = harness({
      fresh: { fresh: false, reason: 'missing' },
      digest: null,
    });
    assert.equal(runCoverageCapture(argv(), h.deps), 0);
    assert.equal(h.calls.stamp.length, 0);
    assert.equal(
      h.log.info.some((m) => /capture stamp/.test(m)),
      false,
    );
  });

  it('stays silent when the stamp write itself fails', () => {
    const h = harness({
      fresh: { fresh: false, reason: 'missing' },
      stampWritten: false,
    });
    assert.equal(runCoverageCapture(argv(), h.deps), 0);
    assert.equal(h.calls.stamp.length, 1);
    assert.equal(
      h.log.info.some((m) => /capture stamp/.test(m)),
      false,
    );
  });

  // Story #4981 — incremental mode, opt-in via
  // delivery.quality.gates.crap.incrementalCoverage.
  describe('incremental mode (Story #4981)', () => {
    const INCREMENTAL_CRAP = {
      ...CRAP,
      incrementalCoverage: { enabled: true, baseRef: 'origin/main' },
    };

    // Story #5065 — the changed-file set decides WHETHER to capture and is
    // recorded on the stamp; it is never forwarded to the capture spawn. The
    // spawn takes no positional file arguments, because Node's runner would
    // execute those source files as tests instead of running the suite.
    it('captures on a changed target-dir file and stamps scope: incremental', () => {
      const h = harness({
        crap: INCREMENTAL_CRAP,
        changed: ['.agents/scripts/a.js', 'README.md'],
        fresh: { fresh: false, reason: 'missing' },
      });
      assert.equal(runCoverageCapture(argv('--cwd', '/repo'), h.deps), 0);
      assert.equal(h.calls.changed[0].ref, 'origin/main');
      assert.equal(
        h.calls.capture[0].files,
        undefined,
        'the capture spawn must receive no file list',
      );
      assert.deepEqual(h.calls.stamp[0], {
        cwd: '/repo',
        coveragePath: CRAP.coveragePath,
        digest: 'deadbeef',
        scope: 'incremental',
        files: ['.agents/scripts/a.js'],
        ref: 'origin/main',
      });
    });

    it('AC-4: passes requireScope: incremental to the freshness probe', () => {
      const h = harness({ crap: INCREMENTAL_CRAP });
      runCoverageCapture(argv(), h.deps);
      assert.equal(h.calls.fresh[0].requireScope, 'incremental');
    });

    it('skips capture when nothing changed under targetDirs', () => {
      const h = harness({ crap: INCREMENTAL_CRAP, changed: ['README.md'] });
      assert.equal(runCoverageCapture(argv(), h.deps), 0);
      assert.equal(h.calls.capture.length, 0);
      assert.match(h.log.info[0], /Incremental mode: no changed files/);
    });

    it('falls back to full-scope capture on a bad ref (fail-closed, not skipped)', () => {
      const h = harness({ crap: INCREMENTAL_CRAP, changed: 'throw' });
      runCoverageCapture(argv(), h.deps);
      assert.match(h.log.warn[0], /incremental mode:.*falling back/);
      // Full-scope path still ran (freshness probe reached with default scope).
      assert.equal(h.calls.fresh.length, 1);
      assert.equal(h.calls.fresh[0].requireScope, undefined);
    });

    it('AC-5: default (no incrementalCoverage key) never calls the incremental path', () => {
      const h = harness({ changed: 'throw' });
      // If the incremental branch ran it would call getChangedFilesImpl and throw
      // internally (caught); asserting no warn line proves it never engaged.
      runCoverageCapture(argv(), h.deps);
      assert.equal(h.log.warn.length, 0);
    });
  });

  describe("'no-sources' is diagnosable, not a silent slow path (Story #5076)", () => {
    it('names the configured targetDirs and captures anyway', () => {
      const h = harness({ fresh: { fresh: false, reason: 'no-sources' } });
      assert.equal(runCoverageCapture(argv(), h.deps), 0);

      // Fail closed: an empty source walk must still capture.
      assert.equal(h.calls.capture.length, 1);

      // And say why — an empty walk is far more often a mis-scoped
      // `targetDirs` than a genuine recapture, so the dirs must be named or
      // it reads as an unexplained slow path on every single run.
      const logged = h.log.info.join('\n');
      assert.match(logged, /no scorable source file found/i);
      for (const dir of CRAP.targetDirs) {
        assert.ok(
          logged.includes(dir),
          `expected the capture log to name target dir ${dir}`,
        );
      }
      assert.match(logged, /quality\.gates\.crap\.targetDirs/);
    });

    it('leaves an ordinary stale recapture unannotated', () => {
      const h = harness({ fresh: { fresh: false, reason: 'stale' } });
      runCoverageCapture(argv(), h.deps);
      assert.equal(h.calls.capture.length, 1);
      const logged = h.log.info.join('\n');
      assert.match(logged, /is stale; running/);
      assert.doesNotMatch(logged, /targetDirs/);
    });
  });
});
