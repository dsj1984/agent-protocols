/**
 * IExecutionAdapter — Abstract Execution Adapter Interface
 *
 * Separates "what to run" (Dispatcher) from "how to run it" (Adapter).
 * The Dispatcher schedules work; adapters own the interaction model for
 * dispatching tasks to a specific agentic runtime.
 *
 * All concrete adapters (e.g., ManualDispatchAdapter, AntigravityAdapter,
 * ClaudeCodeAdapter) extend this class and override every method.
 *
 * Unoverridden methods throw `Error('Not implemented: <method>')` to enforce
 * the contract at runtime rather than silently returning `undefined`.
 *
 * @see docs/v5-implementation-plan.md Sprint 3A
 * @see docs/roadmap.md §C — Execution Adapter Abstraction
 */

export class IExecutionAdapter {
  /**
   * The executor identifier string (e.g., "manual", "subprocess", "mcp").
   * Overridden by concrete implementations.
   * @type {string}
   */
  get executorId() {
    throw new Error('Not implemented: executorId getter');
  }

  /**
   * Dispatch a single task to the target agentic runtime.
   *
   * The Dispatcher calls this method once per task in the current wave.
   * For HITL adapters, this typically prints dispatch instructions.
   * For automated adapters, this may launch a subprocess or API call.
   *
   * @param {{
   *   taskId:     number,
   *   epicId:     number,
   *   branch:     string,
   *   epicBranch: string,
   *   prompt:     string,
   *   persona:    string,
   *   model:      string,
   *   mode:       string,
   *   skills:     string[],
   *   focusAreas: string[],
   *   metadata:   object,
   *   cwd?:       string
   * }} taskDispatch - The fully hydrated task dispatch payload.
   *   When `cwd` is set (worktree-per-story isolation), the agent must run
   *   inside that directory; HITL adapters surface a `cd` instruction.
   * @returns {Promise<{ dispatchId: string, status: 'dispatched'|'queued' }>}
   */
  async dispatchTask(_taskDispatch) {
    throw new Error('Not implemented: dispatchTask');
  }

  /**
   * Poll the current execution status of a previously dispatched task.
   *
   * @param {string} dispatchId - The ID returned by `dispatchTask`.
   * @returns {Promise<{
   *   dispatchId: string,
   *   status: 'pending'|'executing'|'done'|'failed'|'blocked',
   *   message?: string
   * }>}
   */
  async getTaskStatus(_dispatchId) {
    throw new Error('Not implemented: getTaskStatus');
  }

  /**
   * Cancel a previously dispatched task if it is still pending or executing.
   * No-op for adapters that do not support cancellation.
   *
   * @param {string} dispatchId - The dispatch ID to cancel.
   * @returns {Promise<void>}
   */
  async cancelTask(_dispatchId) {
    // Default no-op — adapters that support cancellation should override.
  }

  /**
   * Return a human-readable description of this adapter for logging.
   *
   * @returns {string}
   */
  describe() {
    return `[IExecutionAdapter] executor=${this.executorId}`;
  }
}
