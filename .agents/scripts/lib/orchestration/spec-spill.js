/**
 * v2 Story `## Spec` budget gate.
 *
 * The Story body is the single executable document: Tech Spec prose stays
 * inline under `## Spec`. There is no spill-to-`docs/` path — an over-budget
 * Spec is treated as a sizing smell (the Story should be split or the Spec
 * tightened), not as a reason to write temporary product docs.
 *
 * This module also **owns** the §2 FinOps token estimator
 * ({@link estimateTokens}, ~4 chars/token) — the one shared approximation every
 * fixed framework ceiling speaks in (the Spec budget below, the plan-time
 * sizing ceilings in `ticket-validator-sizing.js`, and the audit checklist
 * threading budget). It used to live in a `context-envelope.js` SDK whose
 * remaining surface had no live caller; the estimator is all that survived.
 *
 * @module lib/orchestration/spec-spill
 */

/**
 * Rough token estimate: ~4 characters per token. Deliberately cheap and
 * deterministic — every ceiling that quotes "tokens" is quoting this number,
 * so the approximation matters far less than every caller sharing one.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Soft budget (estimated tokens) for an inline `## Spec`. ~1500 tokens ≈ 6KB —
 * enough for a real approach section, well under issue-body bloat.
 */
export const DEFAULT_SPEC_BODY_TOKEN_BUDGET = 1500;

/**
 * @typedef {object} SpecBudgetResult
 * @property {number} estimatedTokens
 * @property {string} content
 */

/**
 * Keep Spec inline when it fits; throw when it exceeds the budget so the
 * planner splits or tightens instead of writing docs/.
 *
 * @param {object} args
 * @param {string} args.storyId  Story slug/id for error context.
 * @param {string} args.spec     Folded Tech Spec markdown.
 * @param {object} [opts]
 * @param {number} [opts.tokenBudget=DEFAULT_SPEC_BODY_TOKEN_BUDGET]
 * @returns {SpecBudgetResult}
 */
export function assertSpecWithinBudget({ storyId, spec }, opts = {}) {
  const { tokenBudget = DEFAULT_SPEC_BODY_TOKEN_BUDGET } = opts;
  const content = typeof spec === 'string' ? spec : '';
  const estimatedTokens = estimateTokens(content);

  if (estimatedTokens <= tokenBudget) {
    return { estimatedTokens, content };
  }

  const label =
    typeof storyId === 'string' && storyId.trim() !== ''
      ? storyId.trim()
      : 'unknown';

  throw new Error(
    `[plan-persist] Story "${label}" ## Spec is ~${estimatedTokens} tokens ` +
      `(budget ${tokenBudget}). An over-budget Spec usually means the Story ` +
      `is too large — split it, or tighten ## Spec so the Story body stays ` +
      `the single executable document. Specs are never written to docs/.`,
  );
}
