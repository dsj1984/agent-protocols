/**
 * lib/orchestration/model-resolver.js — Model Resolution Helpers
 */

/**
 * Resolve the model for a task.
 *
 * @param {string} ticketModel
 * @param {object} settings
 * @returns {string}
 */
export function resolveModel(ticketModel, settings) {
  if (ticketModel) return ticketModel;
  return settings?.defaultModels?.fastFallback || 'Gemini 3 Flash';
}

/**
 * Determine model tier from story complexity labels.
 *
 * @param {string[]} storyLabels
 * @returns {'high' | 'fast'}
 */
export function resolveModelTier(storyLabels) {
  if ((storyLabels ?? []).includes('complexity::high')) return 'high';
  return 'fast';
}

/**
 * Map a model tier to a concrete model name from agentSettings.
 *
 * @param {'high' | 'fast'} tier
 * @param {object} settings
 * @returns {string}
 */
export function resolveRecommendedModel(tier, settings) {
  const models = settings?.defaultModels ?? {};
  const raw =
    tier === 'high'
      ? models.planningFallback || 'Gemini 3.1 Pro (High)'
      : models.fastFallback || 'Gemini 3 Flash';
  return raw.split(' OR ')[0].trim();
}
