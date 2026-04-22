import { buildClaudeSpawn } from './build-claude-spawn.js';

/**
 * Pre-wave smoke-test for the Claude spawner. Runs `claude --version` through
 * `buildClaudeSpawn` using the same spawn shape the real StoryLauncher uses,
 * so any regression of the Epic #380 argv-reassembly bug class fails the
 * runner before Wave 1 dispatches rather than after.
 *
 * Constructor injects a `spawn` adapter so unit tests drive all three outcome
 * paths (ok, non-zero exit, timeout) without real subprocess IO.
 */
export class SpawnSmokeTest {
  /**
   * @param {{
   *   ctx?: { logger?: { info: Function, warn: Function, error: Function } },
   *   spawn?: typeof import('node:child_process').spawn,
   *   timeoutMs?: number,
   * }} opts
   */
  constructor(opts = {}) {
    this.ctx = opts.ctx ?? null;
    this.spawn = opts.spawn;
    if (typeof this.spawn !== 'function') {
      throw new TypeError('SpawnSmokeTest requires a spawn adapter');
    }
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /**
   * @returns {Promise<{ ok: boolean, detail: string, exitCode: number | null }>}
   */
  async verify() {
    const launch = buildClaudeSpawn(['--version'], { stdio: 'pipe' });
    const proc = this.spawn(launch.file, launch.args, launch.options);

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        settle({
          ok: false,
          detail: `spawn did not exit within ${this.timeoutMs}ms`,
          exitCode: null,
        });
      }, this.timeoutMs);

      proc.on('error', (err) => {
        settle({
          ok: false,
          detail: `spawn error: ${err?.message ?? err}`,
          exitCode: null,
        });
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          settle({ ok: true, detail: 'claude --version exited 0', exitCode: 0 });
        } else {
          settle({
            ok: false,
            detail: `claude --version exited ${code}`,
            exitCode: code,
          });
        }
      });
    });
  }
}
