/**
 * `agentSettings.limits` accessor (Epic #730 Story 8; relocated under
 * lib/config/ in Epic #773 Story 6).
 */

/**
 * Framework defaults for `agentSettings.limits` (Epic #730 Story 8). Mirrors
 * the long-standing flat-key fallbacks the framework used before grouping —
 * `maxTickets: 40`, 5-minute exec timeout, 10MB exec buffer, 200k token
 * budget. `friction` defaults match the prior `frictionThresholds` block.
 * `planningContext` (Epic #817 Story 9) caps `--emit-context` JSON payloads
 * at 50KB before switching to a summary representation.
 */
export const LIMITS_DEFAULTS = Object.freeze({
  maxInstructionSteps: 5,
  maxTickets: 40,
  maxTokenBudget: 200000,
  executionTimeoutMs: 300000,
  executionMaxBuffer: 10485760,
  friction: Object.freeze({
    repetitiveCommandCount: 3,
    consecutiveErrorCount: 3,
    stagnationStepCount: 5,
    maxIntegrationRetries: 2,
  }),
  planningContext: Object.freeze({
    maxBytes: 50000,
    summaryMode: 'auto',
  }),
});

/**
 * Merge a user-supplied `agentSettings.limits` block with framework defaults.
 * Scalar keys replace; the nested `friction` block is merged shallowly so an
 * operator can override a single threshold without re-listing the others.
 *
 * @param {object|undefined} userLimits
 * @returns {{
 *   maxInstructionSteps: number,
 *   maxTickets: number,
 *   maxTokenBudget: number,
 *   executionTimeoutMs: number,
 *   executionMaxBuffer: number,
 *   friction: {
 *     repetitiveCommandCount: number,
 *     consecutiveErrorCount: number,
 *     stagnationStepCount: number,
 *     maxIntegrationRetries: number,
 *   },
 * }}
 */
export function resolveLimits(userLimits) {
  const block = userLimits && typeof userLimits === 'object' ? userLimits : {};
  const userFriction =
    block.friction && typeof block.friction === 'object' ? block.friction : {};
  const userPlanning =
    block.planningContext && typeof block.planningContext === 'object'
      ? block.planningContext
      : {};
  return {
    maxInstructionSteps:
      block.maxInstructionSteps ?? LIMITS_DEFAULTS.maxInstructionSteps,
    maxTickets: block.maxTickets ?? LIMITS_DEFAULTS.maxTickets,
    maxTokenBudget: block.maxTokenBudget ?? LIMITS_DEFAULTS.maxTokenBudget,
    executionTimeoutMs:
      block.executionTimeoutMs ?? LIMITS_DEFAULTS.executionTimeoutMs,
    executionMaxBuffer:
      block.executionMaxBuffer ?? LIMITS_DEFAULTS.executionMaxBuffer,
    friction: { ...LIMITS_DEFAULTS.friction, ...userFriction },
    planningContext: {
      ...LIMITS_DEFAULTS.planningContext,
      ...userPlanning,
    },
  };
}

/**
 * Read the merged `agentSettings.limits` block. Accepts either the full
 * resolved config or the bare `agentSettings` bag.
 *
 * @param {{ agentSettings?: { limits?: object } } | object | null | undefined} config
 * @returns {ReturnType<typeof resolveLimits>}
 */
export function getLimits(config) {
  const userLimits =
    config?.agentSettings?.limits ?? config?.limits ?? undefined;
  return resolveLimits(userLimits);
}
