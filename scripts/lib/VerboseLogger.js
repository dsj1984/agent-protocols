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
    flushThreshold = 50,
    flushIntervalMs = 1000,
    maxBufferSize = 500,
  }) {
    this.enabled = enabled;
    this.logDir = logDir;
    this.sprint = sprint;
    this.taskId = taskId;
    this.source = source;
    this._logFilePath = null;

    // Batched writer: entries accumulate in `_buffer` and are flushed when
    // either `flushThreshold` is reached or `flushIntervalMs` elapses since
    // the last write. Also flushed on process exit to prevent data loss on
    // normal termination.
    this._buffer = [];
    this._flushThreshold = flushThreshold;
    this._flushIntervalMs = flushIntervalMs;
    this._flushTimer = null;
    this._exitHookInstalled = false;

    // Hard cap on in-memory buffer growth. When flushing is disabled or the
    // caller never invokes `flush()`, a long-running agent loop could
    // otherwise accumulate unbounded JSONL. Overflow drops oldest entries
    // and is reported via `_droppedEntries` / `stats()`.
    this._maxBufferSize = maxBufferSize;
    this._droppedEntries = 0;

    if (this.enabled && this.logDir) {
      ensureDirSync(this.logDir);
      // One file per sprint if sprint is known, otherwise a shared session log.
      const filename = this.sprint
        ? `sprint-${this.sprint}.jsonl`
        : `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
      this._logFilePath = path.join(this.logDir, filename);
      this._installExitHook();
    }
  }

  _installExitHook() {
    if (this._exitHookInstalled || typeof process === 'undefined') return;
    // Guard against multiple hooks (singleton is typically the only caller,
    // but tests can construct fresh instances).
    process.on('exit', () => this.flush());
    this._exitHookInstalled = true;
  }

  _scheduleFlush() {
    if (this._flushTimer || !this._flushIntervalMs) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, this._flushIntervalMs);
    // Don't keep the event loop alive just to flush logs.
    if (typeof this._flushTimer.unref === 'function') {
      this._flushTimer.unref();
    }
  }

  /**
   * Flush any pending entries to disk. Safe to call multiple times and when
   * the buffer is empty. Called automatically on the 50-entry threshold,
   * the 1000 ms interval, and process exit.
   */
  flush() {
    if (!this._logFilePath || this._buffer.length === 0) return;
    const chunk = this._buffer.join('');
    this._buffer.length = 0;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    try {
      fs.appendFileSync(this._logFilePath, chunk, 'utf8');
    } catch (err) {
      console.error(`[VerboseLogger] Failed to write log: ${err.message}`);
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

    this._buffer.push(`${JSON.stringify(entry)}\n`);
    if (this._buffer.length >= this._flushThreshold) {
      this.flush();
    } else {
      this._scheduleFlush();
    }

    // Defensive cap: if the buffer could not drain (e.g. flush failed or the
    // logger was constructed without a logDir but still receives entries),
    // trim the oldest surplus rather than growing unbounded.
    if (this._maxBufferSize > 0 && this._buffer.length > this._maxBufferSize) {
      const overflow = this._buffer.length - this._maxBufferSize;
      this._buffer.splice(0, overflow);
      this._droppedEntries += overflow;
    }
  }

  /**
   * Returns lightweight runtime stats about the logger state. Primarily
   * intended for tests and diagnostics.
   */
  stats() {
    return {
      enabled: this.enabled,
      bufferSize: this._buffer.length,
      maxBufferSize: this._maxBufferSize,
      droppedEntries: this._droppedEntries,
      flushThreshold: this._flushThreshold,
    };
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
   * Resets the singleton (primarily for testing). Flushes any buffered
   * entries on the current singleton before clearing it.
   */
  static reset() {
    if (_singleton) _singleton.flush();
    _singleton = null;
  }
}
