/**
 * risk-resolver.js — Governance Tier Resolution for Auto-Heal
 *
 * Determines the overall risk tier and auto-approve eligibility from a map
 * of CI stage results. The highest-risk failed stage determines the overall
 * tier. Only a pure green failure set allows `autoApprove=true`.
 *
 * This module is intentionally side-effect-free — no file I/O, no network
 * calls, no mutations. It is safe to call from test suites directly.
 *
 * @see auto_heal_design.md §Governance Tiers
 */

/**
 * Canonical risk tier identifiers.
 *
 * @type {{ GREEN: 'green', YELLOW: 'yellow', RED: 'red' }}
 */
export const RISK_TIERS = /** @type {const} */ ({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
});

/**
 * Numeric priority for tier comparison (higher = more severe).
 *
 * @type {{ green: 0, yellow: 1, red: 2 }}
 */
export const RISK_TIER_PRIORITY = /** @type {const} */ ({
  green: 0,
  yellow: 1,
  red: 2,
});

/**
 * @typedef {'green'|'yellow'|'red'} RiskTier
 * @typedef {'success'|'failure'|'skipped'|'cancelled'} StageResult
 *
 * @typedef {{
 *   riskTier: RiskTier,
 *   autoApprove: boolean,
 *   failedStages: string[]
 * }} RiskResolution
 *
 * @typedef {{
 *   riskTier: RiskTier,
 *   autoApprove?: boolean,
 *   logArtifact?: string,
 *   allowedModifications?: string[],
 *   forbiddenModifications?: string[]
 * }} StageConfig
 */

/**
 * Resolve the overall governance tier from a set of CI stage results.
 *
 * Algorithm:
 *   1. Filter stages whose result is `'failure'` (skipped/cancelled are ignored).
 *   2. Among failed stages, look up each stage's configured `riskTier`.
 *   3. The highest-priority tier (red > yellow > green) becomes the overall tier.
 *   4. `autoApprove` is `true` only when every failed stage is `green`.
 *   5. Unknown stage names (not in `stageConfigs`) default to `red` as a safe
 *      fallback so unconfigured failures are never silently auto-approved.
 *
 * @param {Record<string, StageResult>} stageResults
 *   Map of `{ stageName: 'success'|'failure'|... }` from CLI `--stage` flags.
 * @param {Record<string, StageConfig>} stageConfigs
 *   The `autoHeal.stages` block from `.agentrc.json`.
 * @returns {RiskResolution}
 */
export function resolveRiskTier(stageResults, stageConfigs) {
  const failedStages = Object.entries(stageResults)
    .filter(([, result]) => result === 'failure')
    .map(([name]) => name);

  if (failedStages.length === 0) {
    return {
      riskTier: RISK_TIERS.GREEN,
      autoApprove: true,
      failedStages: [],
    };
  }

  let highestPriority = -1;
  let dominantTier = RISK_TIERS.GREEN;

  for (const stageName of failedStages) {
    const stageConfig = stageConfigs?.[stageName];

    // Unknown stages default to red — safest possible assumption.
    const tier =
      stageConfig?.riskTier != null &&
      stageConfig.riskTier in RISK_TIER_PRIORITY
        ? stageConfig.riskTier
        : RISK_TIERS.RED;

    const priority = RISK_TIER_PRIORITY[tier];
    if (priority > highestPriority) {
      highestPriority = priority;
      dominantTier = tier;
    }
  }

  // autoApprove only when the dominant tier — set by the worst failure — is green.
  const autoApprove = dominantTier === RISK_TIERS.GREEN;

  return {
    riskTier: dominantTier,
    autoApprove,
    failedStages,
  };
}
