/**
 * Logger conventions (see `docs/patterns.md` → "Error Handling Convention"):
 *
 *   - `debug`:  verbose trace; only emitted when the logger level is `verbose`.
 *   - `info`:   normal progress.
 *   - `warn`:   recoverable issue the operator should notice.
 *   - `error`:  non-fatal failure; caller continues. Use when `throw` would
 *               be too loud (e.g. best-effort cleanup paths).
 *   - `fatal`:  unrecoverable; exits the process. Use only at CLI
 *               boundaries, never inside library code.
 *
 * Level is resolved from `AGENT_LOG_LEVEL`:
 *
 *   - `silent`   → only `fatal` emits.
 *   - `info`     → default. Emits `info` and above; suppresses `debug`.
 *   - `verbose`  → emits everything (including `debug`).
 *   - `debug`    → alias for `verbose` (backward compatible).
 */
const RAW_LEVEL = (process.env.AGENT_LOG_LEVEL ?? '').toLowerCase();
const LEVEL =
  RAW_LEVEL === 'silent' ||
  RAW_LEVEL === 'info' ||
  RAW_LEVEL === 'verbose' ||
  RAW_LEVEL === 'debug'
    ? RAW_LEVEL
    : 'info';

const DEBUG_ENABLED = LEVEL === 'verbose' || LEVEL === 'debug';
const INFO_ENABLED = LEVEL === 'info' || DEBUG_ENABLED;
const WARN_ENABLED = INFO_ENABLED;
const ERROR_ENABLED = INFO_ENABLED;

export const Logger = {
  level: LEVEL,

  debug(message) {
    if (DEBUG_ENABLED) console.error(`[Orchestrator] 🐛 ${message}`);
  },

  info(message) {
    if (INFO_ENABLED) console.log(`[Orchestrator] ℹ️ ${message}`);
  },

  warn(message) {
    if (WARN_ENABLED) console.warn(`[Orchestrator] ⚠️ ${message}`);
  },

  error(message) {
    if (ERROR_ENABLED) console.error(`[Orchestrator] ❌ ${message}`);
  },

  fatal(message) {
    console.error(`[Orchestrator] ❌ ${message}`);
    process.exit(1);
  },

  createProgress(scriptName, { stderr = true } = {}) {
    const logFn = stderr ? console.error : console.log;
    return (phase, message) => {
      if (INFO_ENABLED) logFn(`▶ [${scriptName}] [${phase}] ${message}`);
    };
  },
};
