import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isDirectInvocation,
  runAsCli,
} from '../../.agents/scripts/lib/cli-utils.js';

describe('cli-utils', () => {
  let origArgv1;
  let origExit;
  let origConsoleError;
  let origExitCode;
  let exitCalls;
  let errorLines;

  beforeEach(() => {
    origArgv1 = process.argv[1];
    origExit = process.exit;
    origConsoleError = console.error;
    origExitCode = process.exitCode;
    process.exitCode = undefined;
    exitCalls = [];
    errorLines = [];
    // Story #4783: the helper must never call `process.exit` — exiting eagerly
    // discards stdio still queued behind a full pipe buffer. This stub is a
    // tripwire, not a shim: every assertion below expects it to stay empty.
    process.exit = (code) => {
      exitCalls.push(code);
    };
    console.error = (msg) => {
      errorLines.push(msg);
    };
  });

  afterEach(() => {
    process.argv[1] = origArgv1;
    process.exit = origExit;
    console.error = origConsoleError;
    // Never leak a failing code into the test runner's own exit status.
    process.exitCode = origExitCode;
  });

  /** Let `settleCli` reach its exit-code assignment. */
  const settle = async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  // Use a real absolute path under the project so fileURLToPath works on
  // both POSIX and Windows.
  const fakePath = path.resolve(process.cwd(), '__fake_cli__.js');
  const fakeUrl = pathToFileURL(fakePath).href;

  describe('isDirectInvocation', () => {
    it('returns true when argv[1] resolves to the module path', () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      assert.equal(isDirectInvocation(fakeUrl), true);
    });

    it('returns false when argv[1] is a different path', () => {
      process.argv[1] = path.resolve('/tmp/other.js');
      assert.equal(isDirectInvocation(fakeUrl), false);
    });

    it('returns false when argv[1] is undefined', () => {
      delete process.argv[1];
      assert.equal(isDirectInvocation(fakeUrl), false);
    });
  });

  describe('runAsCli', () => {
    it('no-ops when not directly invoked', async () => {
      process.argv[1] = path.resolve('/tmp/other.js');
      let called = false;
      runAsCli(fakeUrl, async () => {
        called = true;
      });
      // Give any accidental promise a tick to run.
      await new Promise((r) => setImmediate(r));
      assert.equal(called, false);
    });

    it('invokes main when argv matches', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      let called = false;
      runAsCli(fakeUrl, async () => {
        called = true;
      });
      await settle();
      assert.equal(called, true);
      assert.equal(exitCalls.length, 0);
      assert.equal(process.exitCode, undefined);
    });

    it('uses default handler on rejection: prefixed stderr + exitCode 1', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      runAsCli(
        fakeUrl,
        async () => {
          throw new Error('boom');
        },
        { source: 'TestCli' },
      );
      await settle();
      assert.equal(process.exitCode, 1);
      assert.equal(exitCalls.length, 0, 'must not call process.exit');
      assert.ok(errorLines.some((l) => l.includes('[TestCli] Fatal error:')));
      assert.ok(errorLines.some((l) => l.includes('boom')));
    });

    it('honours custom exitCode', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      runAsCli(
        fakeUrl,
        async () => {
          throw new Error('x');
        },
        { exitCode: 42 },
      );
      await settle();
      assert.equal(process.exitCode, 42);
      assert.equal(exitCalls.length, 0);
    });

    it('adopts the resolved code under propagateExitCode', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      runAsCli(fakeUrl, async () => 3, { propagateExitCode: true });
      await settle();
      assert.equal(process.exitCode, 3);
      assert.equal(exitCalls.length, 0);
    });

    it('maps an undefined resolution to 0 under propagateExitCode', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      runAsCli(fakeUrl, async () => undefined, { propagateExitCode: true });
      await settle();
      assert.equal(process.exitCode, 0);
    });

    it('delegates to onError when provided (no default stderr/exit)', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      let captured;
      runAsCli(
        fakeUrl,
        async () => {
          throw new Error('nope');
        },
        {
          onError: (err) => {
            captured = err;
          },
        },
      );
      await settle();
      assert.equal(captured.message, 'nope');
      assert.equal(exitCalls.length, 0);
      assert.equal(errorLines.length, 0);
      assert.equal(process.exitCode, undefined);
    });
  });
});
