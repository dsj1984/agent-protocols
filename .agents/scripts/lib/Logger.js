export class Logger {
  static info(message) {
    console.log(`[Orchestrator] ℹ️ ${message}`);
  }

  static warn(message) {
    console.warn(`[Orchestrator] ⚠️ ${message}`);
  }

  static fatal(message) {
    console.error(`[Orchestrator] ❌ ${message}`);
    process.exit(1);
  }
}
