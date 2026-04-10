export const Logger = {
  info(message) {
    console.log(`[Orchestrator] ℹ️ ${message}`);
  },

  warn(message) {
    console.warn(`[Orchestrator] ⚠️ ${message}`);
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
