// tests/cli-utils-exit-flush.test.js
//
// Story #4783 — `runAsCli` must not terminate before its stdio drains.
//
// These run a *real* child process, because the defect only exists across a
// real pipe: `process.stdout` is synchronous on a TTY and on a file, and only
// goes asynchronous once the 64 KiB kernel pipe buffer fills. An in-process
// stub of `process.exit` cannot reproduce it — the truncation is the kernel's,
// not JavaScript's. Each fixture is a minimal CLI wired through the real
// `runAsCli`, spawned with a piped stdout and (for the truncation test) a
// deliberately slow reader.
//
// The exit-code cases are the other half of the contract: the refactor
// replaced `process.exit(code)` with `process.exitCode = code`, and every one
// of the ~88 consumers must observe the identical code.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLI_UTILS = pathToFileURL(
  path.join(ROOT, '.agents', 'scripts', 'lib', 'cli-utils.js'),
).href;

// `realpathSync` matters: on macOS `os.tmpdir()` is a symlink, and `runAsCli`
// compares `fileURLToPath(import.meta.url)` (symlink-resolved by the loader)
// against `path.resolve(process.argv[1])` (not resolved). Without it the
// fixture is not recognised as a direct invocation and every assertion below
// would pass vacuously against a CLI that never ran.
const TMP = fs.realpathSync(makeTempDir('cli-exit-flush-'));

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Bytes the bulk fixture writes — four pipe buffers' worth. */
const BULK_BYTES = 256 * 1024;

/**
 * Readiness handshake for the slow-reader cases (Story #4926).
 *
 * The bulk fixtures write this to **stderr** — a second, eagerly-drained pipe
 * — the instant `process.stdout.write` reports the kernel pipe buffer full and
 * the remainder queued in userland. That is the exact precondition these tests
 * need: the child is on its exit path with bytes still outstanding.
 *
 * This replaced a `setTimeout(300)` that *guessed* the window had opened.
 * Fake timers cannot substitute for that sleep: the thing being waited on is a
 * separate OS process filling a kernel pipe, and `mock.timers` only rewrites
 * the parent's clock — firing the callback instantly would remove the
 * backpressure the assertion depends on rather than control it. A handshake on
 * a real observable is the deterministic fix, and it is strictly stronger:
 * `QUEUED` also proves the queue formed, so the test can no longer pass
 * vacuously on a machine whose buffer never filled.
 */
const QUEUED_MARKER = '__STDOUT_QUEUED__';

/** Fixture source that emits {@link QUEUED_MARKER} once stdout back-pressures. */
const SIGNAL_QUEUED = [
  "  if (queued) process.stderr.write('__STDOUT_QUEUED__\\n');",
  "  else throw new Error('stdout never back-pressured — fixture wrote too little');",
].join('\n');

/**
 * Write a fixture CLI that routes `body` through the real `runAsCli`.
 *
 * @param {string} name    Fixture basename.
 * @param {string} body    The body of `main()`.
 * @param {string} options `runAsCli`'s options bag, as source.
 * @returns {string} Absolute path to the fixture.
 */
function writeFixture(name, body, options = '{}') {
  const file = path.join(TMP, `${name}.mjs`);
  fs.writeFileSync(
    file,
    [
      `import { runAsCli } from ${JSON.stringify(CLI_UTILS)};`,
      'async function main() {',
      body,
      '}',
      `runAsCli(import.meta.url, main, ${options});`,
      '',
    ].join('\n'),
  );
  return file;
}

/**
 * Run a fixture and collect its exit code plus the exact byte count that
 * reached the reader.
 *
 * @param {string} fixture
 * @param {{ slow?: boolean }} [opts] `slow` holds stdout paused until the
 *   child reports (over stderr) that the pipe buffer is full and the rest of
 *   its output is queued — the window the old `process.exit()` lost.
 * @returns {Promise<{ code: number, stdoutBytes: number, stdout: string, stderr: string }>}
 */
async function runFixture(fixture, { slow = false } = {}) {
  const child = spawn(process.execPath, [fixture], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let onStderrChunk = () => {};
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    onStderrChunk();
  });

  const exited = new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  let stdoutBytes = 0;
  let stdout = '';
  if (slow) {
    child.stdout.pause();
    await new Promise((resolve, reject) => {
      onStderrChunk = () => {
        if (stderr.includes(QUEUED_MARKER)) resolve();
      };
      onStderrChunk();
      // A child that dies before signalling can never signal — fail fast
      // rather than hang the suite waiting on a marker that will not come.
      child.on('close', () =>
        stderr.includes(QUEUED_MARKER)
          ? resolve()
          : reject(
              new Error(
                `fixture exited before signalling ${QUEUED_MARKER}; stderr: ${stderr}`,
              ),
            ),
      );
    });
    onStderrChunk = () => {};
  }
  for await (const chunk of child.stdout) {
    stdoutBytes += chunk.length;
    stdout += chunk.toString('utf8');
  }

  const code = await exited;
  return { code, stdoutBytes, stdout, stderr };
}

test('runAsCli: >64 KiB of piped stdout survives a slow reader intact', async () => {
  const fixture = writeFixture(
    'bulk',
    [
      `  const queued = !process.stdout.write('x'.repeat(${BULK_BYTES}));`,
      SIGNAL_QUEUED,
      '  return 0;',
    ].join('\n'),
    '{ propagateExitCode: true }',
  );

  const { code, stdoutBytes } = await runFixture(fixture, { slow: true });

  // The pre-change binary terminates with the queue still full and delivers
  // roughly one pipe buffer (64 KiB); the contract is every byte written.
  assert.equal(
    stdoutBytes,
    BULK_BYTES,
    `expected ${BULK_BYTES} bytes, received ${stdoutBytes} — stdout truncated at the pipe boundary`,
  );
  assert.equal(code, 0);
});

test('runAsCli: bulk stdout survives on the fatal-error path too', async () => {
  const fixture = writeFixture(
    'bulk-fatal',
    [
      `  const queued = !process.stdout.write('y'.repeat(${BULK_BYTES}));`,
      SIGNAL_QUEUED,
      "  throw new Error('boom after bulk output');",
    ].join('\n'),
    "{ source: 'bulk-fatal' }",
  );

  const { code, stdoutBytes, stderr } = await runFixture(fixture, {
    slow: true,
  });

  assert.equal(stdoutBytes, BULK_BYTES);
  assert.equal(code, 1);
  assert.match(
    stderr,
    /\[bulk-fatal\] Fatal error: Error: boom after bulk output/,
  );
});

test('runAsCli: propagateExitCode adopts the resolved code verbatim', async () => {
  for (const resolved of ['0', '3', '7']) {
    const fixture = writeFixture(
      `code-${resolved}`,
      `  return ${resolved};`,
      '{ propagateExitCode: true }',
    );
    const { code } = await runFixture(fixture);
    assert.equal(code, Number(resolved), `resolved ${resolved}`);
  }
});

test('runAsCli: propagateExitCode maps an undefined resolution to 0', async () => {
  const fixture = writeFixture(
    'code-undefined',
    '  return undefined;',
    '{ propagateExitCode: true }',
  );
  const { code } = await runFixture(fixture);
  assert.equal(code, 0);
});

test('runAsCli: without propagateExitCode a resolved code does not become the exit code', async () => {
  const fixture = writeFixture('code-ignored', '  return 5;');
  const { code } = await runFixture(fixture);
  assert.equal(code, 0);
});

test('runAsCli: the default fatal handler exits 1 with the prefixed line', async () => {
  const fixture = writeFixture(
    'fatal-default',
    "  throw new Error('kaboom');",
    "{ source: 'my-cli' }",
  );
  const { code, stderr } = await runFixture(fixture);
  assert.equal(code, 1);
  assert.match(stderr, /\[my-cli\] Fatal error: Error: kaboom/);
});

test('runAsCli: a caller-supplied exitCode is honoured on the fatal path', async () => {
  const fixture = writeFixture(
    'fatal-code-2',
    "  throw new Error('nope');",
    "{ source: 'preflight', exitCode: 2 }",
  );
  const { code, stderr } = await runFixture(fixture);
  assert.equal(code, 2);
  assert.match(stderr, /\[preflight\] Fatal error: Error: nope/);
});

test('runAsCli: errorPrefix overrides the default prefix', async () => {
  const fixture = writeFixture(
    'fatal-prefix',
    "  throw new Error('bad input');",
    "{ errorPrefix: '❌ custom' }",
  );
  const { code, stderr } = await runFixture(fixture);
  assert.equal(code, 1);
  assert.match(stderr, /❌ custom: Error: bad input/);
});

test('runAsCli: an onError override owns the outcome (no default exit code)', async () => {
  const fixture = writeFixture(
    'fatal-onerror',
    "  throw new Error('handled');",
    "{ onError: (err) => { console.error('caught: ' + err.message); } }",
  );
  const { code, stderr } = await runFixture(fixture);
  assert.equal(code, 0, 'onError declining to set a code leaves the run green');
  assert.match(stderr, /caught: handled/);
});

test('runAsCli: a rejected main does not also raise an unhandled rejection', async () => {
  // The old shape attached `.then()` and `.catch()` to the same promise; the
  // `.then()` branch's derived rejection was only ever swallowed because
  // `process.exit()` killed the process first. Without the eager exit, that
  // would surface as an ERR_UNHANDLED_REJECTION crash (exit 1, but with a
  // node-internal trace) instead of the framework's single prefixed line.
  const fixture = writeFixture(
    'reject-propagate',
    "  throw new Error('rejected under propagateExitCode');",
    "{ source: 'propagating', propagateExitCode: true }",
  );
  const { code, stderr } = await runFixture(fixture);
  assert.equal(code, 1);
  assert.match(stderr, /\[propagating\] Fatal error: Error: rejected under/);
  assert.doesNotMatch(stderr, /ERR_UNHANDLED_REJECTION|unhandledRejection/);
});

test('runAsCli: the helper itself contains no process.exit call', () => {
  // AC-1, pinned structurally: the exit-before-flush defect is a property of
  // the source, so guard the source rather than only the behaviour.
  const source = fs.readFileSync(
    path.join(ROOT, '.agents', 'scripts', 'lib', 'cli-utils.js'),
    'utf8',
  );
  // Strip comments: the JSDoc explains the defect it removed, and prose about
  // `process.exit()` is not a callsite.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.equal(
    /process\.exit\s*\(/.test(code),
    false,
    'cli-utils.js must set process.exitCode, never call process.exit()',
  );
});
