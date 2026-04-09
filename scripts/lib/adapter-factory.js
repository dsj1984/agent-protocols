/**
 * Adapter Factory — resolves `orchestration.executor` to a concrete adapter.
 *
 * Resolution order:
 *   1. `opts.executor` string override (for testing)
 *   2. `orchestration.executor` from .agentrc.json
 *   3. Built-in default: "manual"
 *
 * Adding a new adapter:
 *   1. Create `.agents/scripts/adapters/<name>.js` extending IExecutionAdapter.
 *   2. Add an entry to the ADAPTERS map below.
 *   3. Set `orchestration.executor: "<name>"` in .agentrc.json.
 *
 * @see docs/v5-implementation-plan.md Sprint 3A
 */

import { ManualDispatchAdapter } from '../adapters/manual.js';

/** @type {Record<string, typeof import('../lib/IExecutionAdapter.js').IExecutionAdapter>} */
const ADAPTERS = {
  manual: ManualDispatchAdapter,
  // Future adapters:
  // antigravity: AntigravityAdapter,
  // 'claude-code': ClaudeCodeAdapter,
  // codex: CodexAdapter,
  // subprocess: SubprocessAdapter,
  // mcp: MCPAdapter,
};

/**
 * Create an execution adapter instance.
 *
 * @param {object|null} orchestration - The orchestration block from .agentrc.json.
 * @param {{ executor?: string, [key: string]: unknown }} [opts] - Override options.
 * @returns {import('../lib/IExecutionAdapter.js').IExecutionAdapter}
 * @throws {Error} If the specified executor is unsupported.
 */
export function createAdapter(orchestration, opts = {}) {
  // Resolution order: opts override → config → default
  const executorName = opts.executor || orchestration?.executor || 'manual';

  const AdapterClass = ADAPTERS[executorName];
  if (!AdapterClass) {
    const supported = Object.keys(ADAPTERS).join(', ');
    throw new Error(
      `[AdapterFactory] Unsupported executor "${executorName}". ` +
        `Supported: ${supported}. ` +
        `Add it to .agents/scripts/lib/adapter-factory.js to enable.`,
    );
  }

  return new AdapterClass(orchestration, opts);
}

/**
 * List all registered executor names.
 *
 * @returns {string[]}
 */
export function listAdapters() {
  return Object.keys(ADAPTERS);
}
