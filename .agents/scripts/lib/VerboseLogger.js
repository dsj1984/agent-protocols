/**
 * VerboseLogger.js
 *
 * Structured JSONL logger for recording all agentic interactions and responses
 * throughout a sprint. Activated via the `verboseLogging.enabled` flag in
 * `.agentrc.json`. Logs are written to configurable directories (default:
 * `temp/verbose-logs`) and are designed to be loaded for post-hoc analysis —
 * model evaluation, cost attribution, prompt engineering, and debugging.
 *
 * Log Format (JSONL — one JSON object per line):
 *   {
 *     "timestamp": "ISO-8601",
 *     "level": "info" | "debug" | "warn" | "error",
 *     "category": "workflow" | "script" | "agent-loop" | "integration" | "config" | "system",
 *     "source": "sprint-integrate.js" | "AgentLoopRunner" | ...,
 *     "sprint": "045",
 *     "taskId": "045.2.1",
 *     "message": "Human-readable summary",
 *     "data": { ... }   // Arbitrary structured payload
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureDirSync } from './fs-utils.js';

/** @type {VerboseLogger | null} */
let _singleton = null;

export class VerboseLogger {
  /**
   * @param {object}  opts
   * @param {boolean} opts.enabled    - Whether verbose logging is active.
   * @param {string}  opts.logDir     - Absolute path to the log output directory.
   * @param {string}  [opts.sprint]   - Current sprint identifier (e.g. "045").
   * @param {string}  [opts.taskId]   - Current task identifier (e.g. "045.2.1").
   * @param {string}  [opts.source]   - Default source label for this logger instance.
   */
  constructor({
    enabled = false,
    logDir,
    sprint = '',
    taskId = '',
    source = 'system',
  }) {
    this.enabled = enabled;
    this.logDir = logDir;
    this.sprint = sprint;
    this.taskId = taskId;
    this.source = source;
    this._logFilePath = null;

    if (this.enabled && this.logDir) {
      ensureDirSync(this.logDir);
      // One file per sprint if sprint is known, otherwise a shared session log.
      const filename = this.sprint
        ? `sprint-${this.sprint}.jsonl`
        : `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
      this._logFilePath = path.join(this.logDir, filename);
    }
  }

  // ---------------------------------------------------------------------------
  // Core logging methods
  // ---------------------------------------------------------------------------

  /**
   * Appends a structured log entry to the JSONL file.
   * No-ops silently if verbose logging is disabled.
   *
   * @param {"info"|"debug"|"warn"|"error"} level
   * @param {"workflow"|"script"|"agent-loop"|"integration"|"config"|"system"} category
   * @param {string} message
   * @param {object} [data]  - Optional structured payload.
   */
  log(level, category, message, data = undefined) {
    if (!this.enabled || !this._logFilePath) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      source: this.source,
      sprint: this.sprint || undefined,
      taskId: this.taskId || undefined,
      message,
    };

    // Only include `data` key if there is a payload to avoid noise
    if (data !== undefined) {
      entry.data = data;
    }

    try {
      fs.appendFileSync(
        this._logFilePath,
        `${JSON.stringify(entry)}\n`,
        'utf8',
      );
    } catch (err) {
      // Verbose logging must never crash the host process — degrade silently.
      console.error(`[VerboseLogger] Failed to write log: ${err.message}`);
    }
  }

  /** Convenience: info-level log. */
  info(category, message, data) {
    this.log('info', category, message, data);
  }

  /** Convenience: debug-level log. */
  debug(category, message, data) {
    this.log('debug', category, message, data);
  }

  /** Convenience: warn-level log. */
  warn(category, message, data) {
    this.log('warn', category, message, data);
  }

  /** Convenience: error-level log. */
  error(category, message, data) {
    this.log('error', category, message, data);
  }

  // ---------------------------------------------------------------------------
  // Context mutation helpers
  // ---------------------------------------------------------------------------

  /** Update the task context without creating a new instance. */
  setTask(taskId) {
    this.taskId = taskId;
  }

  /** Update the source label (e.g. when entering a different script). */
  setSource(source) {
    this.source = source;
  }

  /** Returns the absolute path of the current log file, or null if disabled. */
  getLogFilePath() {
    return this._logFilePath;
  }

  // ---------------------------------------------------------------------------
  // Singleton factory — the preferred way to obtain a logger
  // ---------------------------------------------------------------------------

  /**
   * Creates or retrieves the module-level singleton VerboseLogger.
   *
   * On the first call the logger is initialized from the resolved config.
   * Subsequent calls return the cached instance (overrides are ignored).
   *
   * @param {object}  settings         - The resolved `agentSettings` object.
   * @param {string}  projectRoot      - Absolute path to the project root.
   * @param {object}  [overrides]      - Runtime overrides (sprint, taskId, source).
   * @returns {VerboseLogger}
   */
  static init(settings, projectRoot, overrides = {}) {
    if (_singleton) return _singleton;

    const verboseConfig = settings.verboseLogging ?? {};
    const enabled = verboseConfig.enabled === true;
    const logDir = path.resolve(
      projectRoot,
      verboseConfig.logDir ?? settings.tempRoot ?? 'temp',
      // If logDir is already absolute the resolve handles it correctly.
      verboseConfig.logDir ? '' : 'verbose-logs',
    );

    _singleton = new VerboseLogger({
      enabled,
      logDir,
      sprint: overrides.sprint ?? '',
      taskId: overrides.taskId ?? '',
      source: overrides.source ?? 'system',
    });

    if (enabled) {
      _singleton.info('system', 'Verbose logging initialized', {
        logDir,
        logFile: _singleton.getLogFilePath(),
      });
    }

    return _singleton;
  }

  /**
   * Returns the existing singleton, or a disabled no-op logger if
   * init() has not been called yet. This is safe to call from any
   * module without worrying about initialization order.
   *
   * @returns {VerboseLogger}
   */
  static getInstance() {
    if (!_singleton) {
      // Return a disabled no-op instance so callers never need null-checks.
      return new VerboseLogger({ enabled: false, logDir: '' });
    }
    return _singleton;
  }

  /**
   * Resets the singleton (primarily for testing).
   */
  static reset() {
    _singleton = null;
  }
}
