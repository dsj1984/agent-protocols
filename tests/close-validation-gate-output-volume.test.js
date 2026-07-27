/**
 * tests/close-validation-gate-output-volume.test.js — Story #4766.
 *
 * The close path's gate drain under volume. `runCloseValidation` reads each
 * gate child's stdout/stderr line-by-line and hands every line to the capture
 * sink; the first cut of that sink wrote each line with `fs.writeSync`, which
 * blocks the event loop while the child keeps writing. The pipe buffer fills,
 * the child's non-blocking write returns `EAGAIN`, and a child that treats
 * that as fatal dies — Biome's `biome_console` `.unwrap()`s it and aborts with
 * exit 101, so a green lint verdict presented as a failed close. `biome ci .`
 * already emits ~625 lines on a clean `main`, so any close could hit it.
 *
 * The panic itself is Rust-side and not reproducible from a Node child (node
 * retries `EAGAIN` internally, and the child end of a spawned pipe is blocking
 * on this platform), so these tests pin the *cause* instead of the symptom:
 *
 *   - the drain performs no synchronous artifact write, at any volume — the
 *     assertion that fails against the pre-fix `fs.writeSync` path (AC-2/AC-8);
 *   - a high-volume child still completes with a zero status and every line
 *     intact in the artifact, trailing unterminated line included (AC-1/AC-3);
 *   - per-gate `[gate-name] ` attribution survives concurrent gates (AC-4);
 *   - a non-zero gate still propagates its exit code after the full drain
 *     (AC-5), and the digest still accounts for every captured line (AC-6).
 */

import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { defaultGateRunner } from '../.agents/scripts/lib/close-validation/process.js';
import { createGateLogSink } from '../.agents/scripts/lib/orchestration/single-story-close/gate-log.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';

/**
 * `defaultGateRunner` routes through `cmd.exe` on win32 (`shell: true`), which
 * cannot be handed `process.execPath` verbatim — the interpreter path contains
 * a space. The sink-level invariant below is platform-agnostic and carries the
 * regression; the spawn-based tests are POSIX-only.
 */
const POSIX_ONLY = { skip: process.platform === 'win32' };

/** Fat enough that a per-line syscall is unmistakably the dominant cost. */
const FAT = 'x'.repeat(120);

let tmpDir;
const quietLogger = { info: () => {} };

before(() => {
  tmpDir = makeTempDir('gate-volume-');
});

after(() => {
  nodeFs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * A child that writes `lines` newline-terminated lines to stdout, optionally a
 * final line with no terminating newline, then exits with `exitCode`. Written
 * to disk rather than passed with `-e` so the spawn shape matches a real gate.
 */
function writeEmitterScript(name) {
  const scriptPath = path.join(tmpDir, `${name}.js`);
  nodeFs.writeFileSync(
    scriptPath,
    [
      'const [, , countArg, exitArg, trailing] = process.argv;',
      `const fat = '${FAT}';`,
      'const count = Number(countArg);',
      'for (let i = 0; i < count; i += 1) {',
      "  process.stdout.write(fat + ' line ' + i + '\\n');",
      '}',
      "if (trailing === 'trailing') process.stdout.write('UNTERMINATED TAIL');",
      'process.exitCode = Number(exitArg);',
    ].join('\n'),
  );
  return scriptPath;
}

/** A sink over the real implementation, rooted in this run's temp dir. */
function realSink(name, fs = nodeFs) {
  return createGateLogSink({
    storyId: 4766,
    logDir: path.join(tmpDir, name),
    logger: quietLogger,
    level: 'info',
    fs,
  });
}

describe('gate drain — no synchronous per-line write (AC-2, AC-8)', () => {
  const VOLUME_LINES = 50_000;

  it('captures 50k lines without a single fs.writeSync on the drain path', async () => {
    let writeSyncCalls = 0;
    const sink = realSink('no-writesync', {
      ...nodeFs,
      writeSync: (...args) => {
        writeSyncCalls += 1;
        return nodeFs.writeSync(...args);
      },
    });

    // One uninterrupted synchronous burst — exactly the shape of a `'data'`
    // handler draining a chatty child, with no chance to yield to the loop.
    let expectedBytes = 0;
    for (let i = 0; i < VOLUME_LINES; i += 1) {
      const line = `[format] ${FAT} line ${i}`;
      expectedBytes += Buffer.byteLength(line, 'utf8') + 1;
      sink.log(line);
    }
    const onDiskDuringBurst = nodeFs.statSync(sink.logPath).size;
    await sink.flush();

    assert.equal(
      writeSyncCalls,
      0,
      'the drain path must never perform a synchronous file write — this is the pre-fix behaviour that killed the gate child',
    );
    assert.ok(
      onDiskDuringBurst < expectedBytes / 2,
      `the burst must not have been flushed synchronously (${onDiskDuringBurst}B of ${expectedBytes}B reached disk before flush())`,
    );

    const written = nodeFs.readFileSync(sink.logPath, 'utf8');
    assert.equal(
      written.split('\n').filter(Boolean).length,
      VOLUME_LINES,
      'every captured line must survive into the artifact',
    );
    assert.ok(
      written.endsWith(`[format] ${FAT} line ${VOLUME_LINES - 1}\n`),
      'the last line must be present and terminated',
    );
    assert.equal(sink.lineCount, VOLUME_LINES);
    assert.ok(
      sink.digest().includes(String(VOLUME_LINES)),
      'the success digest must account for every captured line (AC-6)',
    );
  });
});

describe('gate drain — high-volume child through the real sink (AC-1, AC-3)', () => {
  const CHILD_LINES = 20_000;

  it(
    'a child an order of magnitude above the biome baseline exits 0 with no lost lines',
    POSIX_ONLY,
    async () => {
      const script = writeEmitterScript('volume');
      const sink = realSink('child-volume');

      const { status } = await defaultGateRunner(
        process.execPath,
        [script, String(CHILD_LINES), '0', 'trailing'],
        { cwd: tmpDir, gateName: 'format', log: sink.log },
      );
      await sink.flush();

      assert.equal(
        status,
        0,
        'the gate child must not be killed by the output plumbing',
      );
      assert.equal(
        sink.lineCount,
        CHILD_LINES + 1,
        'every emitted line, plus the unterminated tail, must reach the sink',
      );

      const lines = nodeFs
        .readFileSync(sink.logPath, 'utf8')
        .split('\n')
        .filter(Boolean);
      assert.equal(lines.length, CHILD_LINES + 1);
      assert.equal(lines[0], `[format] ${FAT} line 0`);
      assert.equal(
        lines[CHILD_LINES - 1],
        `[format] ${FAT} line ${CHILD_LINES - 1}`,
      );
      assert.equal(
        lines.at(-1),
        '[format] UNTERMINATED TAIL',
        'a trailing line with no terminating newline must still be captured',
      );
    },
  );

  it(
    'still propagates a non-zero gate exit code after the full drain (AC-5)',
    POSIX_ONLY,
    async () => {
      const script = writeEmitterScript('volume-red');
      const sink = realSink('child-red');

      const { status } = await defaultGateRunner(
        process.execPath,
        [script, String(CHILD_LINES), '3', 'trailing'],
        { cwd: tmpDir, gateName: 'lint', log: sink.log },
      );
      await sink.flush();

      assert.equal(status, 3, 'the gate exit code must propagate verbatim');
      assert.equal(
        sink.lineCount,
        CHILD_LINES + 1,
        'a red gate must not resolve while its evidence is still in flight',
      );
      assert.ok(
        sink.replay() > 0,
        'the failure path must still have a captured tail to replay (AC-6)',
      );
    },
  );
});

describe('gate drain — per-gate attribution under concurrency (AC-4)', () => {
  const CONCURRENT_LINES = 5_000;

  it(
    'concurrent gates stay distinguishable by their [gate-name] prefix',
    POSIX_ONLY,
    async () => {
      const script = writeEmitterScript('concurrent');
      const sink = realSink('concurrent');

      const results = await Promise.all(
        ['gate-a', 'gate-b'].map((gateName) =>
          defaultGateRunner(
            process.execPath,
            [script, String(CONCURRENT_LINES), '0'],
            { cwd: tmpDir, gateName, log: sink.log },
          ),
        ),
      );
      await sink.flush();

      assert.deepEqual(
        results.map((r) => r.status),
        [0, 0],
      );

      const lines = nodeFs
        .readFileSync(sink.logPath, 'utf8')
        .split('\n')
        .filter(Boolean);
      const counts = { 'gate-a': 0, 'gate-b': 0, unattributed: 0 };
      for (const line of lines) {
        if (line.startsWith('[gate-a] ')) counts['gate-a'] += 1;
        else if (line.startsWith('[gate-b] ')) counts['gate-b'] += 1;
        else counts.unattributed += 1;
      }

      assert.equal(
        counts.unattributed,
        0,
        'no interleaved line may lose its gate attribution',
      );
      assert.equal(counts['gate-a'], CONCURRENT_LINES);
      assert.equal(counts['gate-b'], CONCURRENT_LINES);
    },
  );
});
