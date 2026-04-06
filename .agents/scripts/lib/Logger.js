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
};
