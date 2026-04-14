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
  let exitCalls;
  let errorLines;

  beforeEach(() => {
    origArgv1 = process.argv[1];
    origExit = process.exit;
    origConsoleError = console.error;
    exitCalls = [];
    errorLines = [];
    // Prevent the test from actually exiting.
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
  });

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
      await new Promise((r) => setImmediate(r));
      assert.equal(called, true);
      assert.equal(exitCalls.length, 0);
    });

    it('uses default handler on rejection: prefixed stderr + exit(1)', async () => {
      process.argv[1] = fileURLToPath(fakeUrl);
      runAsCli(
        fakeUrl,
        async () => {
          throw new Error('boom');
        },
        { source: 'TestCli' },
      );
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(exitCalls.length, 1);
      assert.equal(exitCalls[0], 1);
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
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(exitCalls[0], 42);
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
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      assert.equal(captured.message, 'nope');
      assert.equal(exitCalls.length, 0);
      assert.equal(errorLines.length, 0);
    });
  });
});
