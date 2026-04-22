import { spawn as realSpawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { delimiter } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildClaudeSpawn } from '../../.agents/scripts/lib/orchestration/epic-runner/build-claude-spawn.js';

/**
 * Integration test for the buildClaudeSpawn → child_process.spawn path.
 *
 * Regression target: Epic #380 Wave 1 silently false-positived because a
 * pre-refactor `buildClaudeSpawn` returned an args-array shape under Windows'
 * `shell: true`, which reassembled the args into `/sprint-execute` + `386` as
 * two separate tokens. Each spawned Claude session exited in <3s with zero
 * work performed.
 *
 * The test spawns a real `claude --version` (or `CLAUDE_BIN` override) and
 * asserts:
 *   1. The process exits 0 within a 5-second budget.
 *   2. The spawned process observes the `--version` token as a single argv
 *      entry (i.e. argv reassembly did not occur under Windows shell quoting).
 *
 * Skipped cleanly when no binary is resolvable on PATH — CI environments
 * without Claude installed should set `CLAUDE_BIN` to a harmless stub that
 * accepts `--version` and exits 0. The simplest stub is Node itself:
 *
 *   CLAUDE_BIN=node  # `node --version` prints `vNN.N.N` and exits 0
 *
 * Any binary with equivalent CLI shape works; `node` is used by CI because
 * every runner already has it.
 */

const TIMEOUT_MS = 5000;

function isOnPath(bin) {
  if (bin.includes('/') || bin.includes('\\')) {
    try {
      accessSync(bin);
      return true;
    } catch {
      return false;
    }
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        accessSync(`${dir}/${bin}${ext}`);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

const bin = process.env.CLAUDE_BIN ?? 'claude';
const binAvailable = isOnPath(bin);

describe('buildClaudeSpawn (integration)', () => {
  it('spawns `claude --version` and exits 0 within 5s as discrete tokens', {
    skip: !binAvailable && 'CLAUDE_BIN binary not found on PATH',
  }, async () => {
    const launch = buildClaudeSpawn(['--version'], { stdio: 'pipe' });

    // Shape assertions — defense in depth against regressing the Epic #380
    // spawn shape under Windows shell quoting.
    if (process.platform === 'win32') {
      assert.equal(
        launch.options.shell,
        true,
        'Windows must spawn with shell: true',
      );
      assert.deepEqual(launch.args, [], 'Windows must pass args=[]');
      assert.match(
        launch.file,
        /--version/,
        'Windows cmdline must contain --version as a single token',
      );
    } else {
      assert.equal(
        launch.options.shell,
        false,
        'POSIX must spawn with shell: false',
      );
      assert.deepEqual(launch.args, ['--version']);
    }

    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
      const proc = realSpawn(launch.file, launch.args, launch.options);
      let stdout = '';
      proc.stdout?.on('data', (buf) => {
        stdout += buf.toString();
      });
      const killTimer = setTimeout(() => {
        proc.kill();
        reject(new Error(`spawn did not exit within ${TIMEOUT_MS}ms (hung?)`));
      }, TIMEOUT_MS);
      proc.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      proc.on('exit', (code) => {
        clearTimeout(killTimer);
        resolve({ code, stdout });
      });
    });

    const elapsed = Date.now() - started;
    assert.equal(result.code, 0, `exit code should be 0, got ${result.code}`);
    assert.ok(
      elapsed < TIMEOUT_MS,
      `exit took ${elapsed}ms (>= ${TIMEOUT_MS}ms budget)`,
    );
  });
});
