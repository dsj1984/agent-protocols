/**
 * Logger conventions (see `docs/patterns.md` → "Error Handling Convention"):
 *
 *   - `debug`:  verbose trace; only emitted when `AGENT_LOG_LEVEL=debug`.
 *   - `info`:   normal progress.
 *   - `warn`:   recoverable issue the operator should notice.
 *   - `error`:  non-fatal failure; caller continues. Use when `throw` would
 *               be too loud (e.g. best-effort cleanup paths).
 *   - `fatal`:  unrecoverable; exits the process. Use only at CLI
 *               boundaries, never inside library code.
 */
const DEBUG_ENABLED = process.env.AGENT_LOG_LEVEL === 'debug';

export const Logger = {
  debug(message) {
    if (DEBUG_ENABLED) console.error(`[Orchestrator] 🐛 ${message}`);
  },

  info(message) {
    console.log(`[Orchestrator] ℹ️ ${message}`);
  },

  warn(message) {
    console.warn(`[Orchestrator] ⚠️ ${message}`);
  },

  error(message) {
    console.error(`[Orchestrator] ❌ ${message}`);
  },

  fatal(message) {
    console.error(`[Orchestrator] ❌ ${message}`);
    process.exit(1);
  },

  createProgress(scriptName, { stderr = true } = {}) {
    const logFn = stderr ? console.error : console.log;
    return (phase, message) => {
      logFn(`▶ [${scriptName}] [${phase}] ${message}`);
    };
  },
};
