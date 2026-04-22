/**
 * lib/orchestration/lint-baseline-service.js
 *
 * Captures the Epic lint baseline (see `lint-baseline.js capture`). Extracted
 * from the inline implementation that used to live in `dispatch-engine.js`
 * so the coordinator no longer reaches into `node:child_process` or
 * `node:fs` directly. Tests can exercise the service with a stubbed exec
 * adapter and no filesystem interaction.
 */

import defaultFs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../config-resolver.js';

/**
 * Shape of the exec adapter passed into {@link LintBaselineService}.
 *
 * Implementations may be sync (e.g. `execFileSync`) or async; the service
 * always `await`s the return value so either works.
 *
 * @typedef {(file: string, args: string[], options?: object) => (void | Promise<void>)} LintBaselineExec
 */

/**
 * Minimal logger shape consumed by {@link LintBaselineService}. Matches the
 * existing `VerboseLogger` / `dispatch-logger.js` surface.
 *
 * @typedef {object} LintBaselineVlog
 * @property {(channel: string, msg: string) => void} info
 * @property {(channel: string, msg: string) => void} warn
 */

/**
 * Outcome of {@link LintBaselineService#capture}.
 *
 * @typedef {object} LintBaselineCaptureResult
 * @property {boolean} skipped                   True when the baseline file already existed on disk.
 * @property {boolean} [captured]                True when the exec adapter ran and succeeded.
 * @property {string} [error]                    Error message when the exec adapter threw (still non-fatal).
 */

export class LintBaselineService {
  /**
   * @param {object} deps
   * @param {LintBaselineExec} deps.exec         Injected exec adapter — invoked with `(file, args, options)`.
   * @param {LintBaselineVlog} deps.vlog         Logger for skip / capture / failure messages.
   * @param {object} deps.settings               `.agentrc.json` `settings` block.
   * @param {string} [deps.settings.lintBaselinePath='temp/lint-baseline.json']  Relative path to the baseline artifact.
   * @param {string} deps.settings.scriptsRoot   Relative scripts directory (resolved from `PROJECT_ROOT`).
   * @param {typeof import('node:fs')} [deps.fs] Optional `fs` module (defaults to `node:fs`). Kept injectable so unit tests can assert no real-disk access.
   */
  constructor({ exec, vlog, settings, fs = defaultFs }) {
    this.exec = exec;
    this.vlog = vlog;
    this.settings = settings;
    this.fs = fs;
  }

  /**
   * Capture (or skip) the lint baseline for the given Epic branch.
   *
   * Behaviour:
   * - If the baseline artifact already exists, log a skip and return
   *   `{ skipped: true }` — **no exec call is made**.
   * - Otherwise invoke the injected exec adapter to run
   *   `node <scriptsRoot>/lint-baseline.js capture`.
   * - Exec failures are logged at `warn` and swallowed — baseline capture
   *   is advisory and must never break the dispatch cycle.
   *
   * @param {string} epicBranch  Epic branch name (used for logging only).
   * @returns {Promise<LintBaselineCaptureResult>}  Resolution of the capture attempt.
   */
  async capture(epicBranch) {
    const { settings, vlog, exec, fs } = this;
    const lintBaselinePath =
      settings.lintBaselinePath ?? 'temp/lint-baseline.json';
    const absPath = path.resolve(PROJECT_ROOT, lintBaselinePath);

    if (fs.existsSync(absPath)) {
      vlog.info(
        'orchestration',
        `Lint baseline already exists, skipping capture.`,
      );
      return { skipped: true };
    }

    vlog.info('orchestration', `Capturing lint baseline on ${epicBranch}...`);
    try {
      await exec(
        'node',
        [
          path.join(PROJECT_ROOT, settings.scriptsRoot, 'lint-baseline.js'),
          'capture',
        ],
        {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          stdio: process.env.MCP_SERVER ? 'pipe' : 'inherit',
          shell: false,
        },
      );
      return { skipped: false, captured: true };
    } catch (err) {
      vlog.warn(
        'orchestration',
        `Lint baseline capture failed (non-fatal): ${err.message}`,
      );
      return { skipped: false, captured: false, error: err.message };
    }
  }
}
