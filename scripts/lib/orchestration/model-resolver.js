/**
 * lib/orchestration/model-resolver.js — Model Tier Resolution
 *
 * The orchestrator emits a binary `high` | `low` tier per Story derived
 * solely from its `complexity::high` label. Concrete model selection is
 * intentionally left to the executing agent / external router — naming a
 * specific model in config was brittle (models ship monthly) and external
 * routers already make better runtime choices.
 */

/**
 * Determine model tier from story complexity labels.
 *
 * @param {string[]} storyLabels
 * @returns {'high' | 'low'}
 */
export function resolveModelTier(storyLabels) {
  if ((storyLabels ?? []).includes('complexity::high')) return 'high';
  return 'low';
}
