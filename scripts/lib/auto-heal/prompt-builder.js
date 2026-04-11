/**
 * prompt-builder.js — Auto-Heal Prompt Assembly
 *
 * Builds the consolidated prompt string sent to the auto-heal adapter and
 * reads error log artifacts produced by CI stages.
 *
 * Design notes:
 *   - The prompt template is a self-contained template literal in this file.
 *     Consumers do not need a separate template file on disk.
 *   - `collectErrorLogs` uses graceful fallbacks: missing log files produce a
 *     clear advisory message rather than throwing.
 *   - Log content is truncated to `maxBytes` to keep prompts within token
 *     budgets. Truncation appends a clear marker so agents know content was cut.
 *
 * @see auto_heal_design.md §Prompt Construction
 */

import fs from 'node:fs';
import path from 'node:path';

/** Risk tier → display emoji for prompt readability. */
const TIER_EMOJI = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

/**
 * @typedef {{
 *   repo: string,
 *   sha: string,
 *   prNumber: string|number,
 *   branch: string,
 *   failedStages: string[],
 *   stageConfigs: Record<string, import('./risk-resolver.js').StageConfig>,
 *   errorSections: Record<string, string>,
 *   riskTier: import('./risk-resolver.js').RiskTier,
 *   autoApprove: boolean
 * }} BuildPromptOptions
 */

/**
 * Assemble the consolidated auto-heal prompt string.
 *
 * The prompt is structured so that an AI coding agent receives:
 *   1. A clear context block (repo, commit, PR, branch, tier)
 *   2. Per-stage modification constraints (allowed / forbidden)
 *   3. The raw error log for each failed stage (truncated to budget)
 *   4. Explicit instructions to reference AGENTS.md and produce one unified fix
 *
 * @param {BuildPromptOptions} options
 * @returns {string} The assembled prompt ready for dispatch.
 */
export function buildAutoHealPrompt(options) {
  const {
    repo,
    sha,
    prNumber,
    branch,
    failedStages,
    stageConfigs,
    errorSections,
    riskTier,
    autoApprove,
  } = options;

  const tierEmoji = TIER_EMOJI[riskTier] ?? '⬜';
  const shortSha = String(sha).slice(0, 8);
  const prDisplay = prNumber && prNumber !== '0' ? `#${prNumber}` : 'N/A';

  // ── Context Block ─────────────────────────────────────────────────────────
  const contextBlock = `## Context

- **Repository:** ${repo}
- **Commit:** ${shortSha}
- **PR:** ${prDisplay}
- **Branch:** ${branch}
- **Failed Stages:** ${failedStages.join(', ')}
- **Risk Tier:** ${tierEmoji} ${riskTier.toUpperCase()}
- **Auto-Approve:** ${autoApprove ? 'Yes — plan approval not required' : 'No — plan approval required before merge'}`;

  // ── Constraints Block ──────────────────────────────────────────────────────
  const constraintLines = [];
  for (const stageName of failedStages) {
    const cfg = stageConfigs?.[stageName];
    if (!cfg) {
      constraintLines.push(
        `\n### Stage: \`${stageName}\`\n\n> ⚠️ No stage configuration found. Treat as red-tier — apply maximum caution.\n`,
      );
      continue;
    }

    const allowed =
      cfg.allowedModifications?.length > 0
        ? cfg.allowedModifications.map((m) => `- ✅ ${m}`).join('\n')
        : '- ✅ (no restrictions defined — use judgment)';

    const forbidden =
      cfg.forbiddenModifications?.length > 0
        ? cfg.forbiddenModifications.map((m) => `- 🚫 ${m}`).join('\n')
        : '- (none explicitly forbidden — still avoid unrelated changes)';

    constraintLines.push(
      `\n### Stage: \`${stageName}\` (${TIER_EMOJI[cfg.riskTier] ?? '⬜'} ${cfg.riskTier ?? 'unknown'})\n\n**Allowed Modifications:**\n${allowed}\n\n**Forbidden Modifications:**\n${forbidden}`,
    );
  }

  const constraintsBlock = `## Modification Constraints\n${constraintLines.join('\n')}`;

  // ── Error Logs Block ───────────────────────────────────────────────────────
  const errorLogLines = [];
  for (const stageName of failedStages) {
    const logContent = errorSections?.[stageName];
    if (!logContent) {
      errorLogLines.push(
        `\n### Error Log: \`${stageName}\`\n\n> ℹ️ No log file found. Inspect the CI run directly.\n`,
      );
    } else {
      errorLogLines.push(
        `\n### Error Log: \`${stageName}\`\n\n\`\`\`\n${logContent}\n\`\`\``,
      );
    }
  }

  const errorLogsBlock = `## Error Logs\n${errorLogLines.join('\n')}`;

  // ── Final Assembly ─────────────────────────────────────────────────────────
  return `# CI Auto-Heal Request

${contextBlock}

---

## Conventions

Refer to **AGENTS.md** in the repository root for project coding conventions,
safety constraints, and the established patterns for this codebase. All fixes
MUST conform to those conventions.

---

${constraintsBlock}

---

${errorLogsBlock}

---

## Instructions

1. Analyze ALL error logs above and identify the root cause(s).
2. Generate a **SINGLE consolidated fix** that addresses every failed stage.
   Do not submit separate fixes per stage — the patch must be coherent.
3. Respect the modification constraints for each stage. Do NOT touch forbidden
   files or paths, even if they appear in the error output.
4. If the risk tier is ${tierEmoji} **${riskTier.toUpperCase()}**, proceed with
   ${autoApprove ? 'automatic application — no plan approval needed' : 'a plan first — await approval before applying changes'}.
5. After generating the fix, confirm which files were changed and why.
`;
}

/**
 * Read error log files from disk for each failed stage.
 *
 * For each failed stage, the function attempts to read:
 *   `<errorsDir>/<stageName>/<stageConfig.logArtifact>`
 *
 * If `logArtifact` is not configured, it falls back to `<stageName>-output.log`.
 * Missing files produce an advisory string rather than throwing.
 *
 * Log content is truncated to `maxBytes` from the **end** of the file so that
 * the most recent (and usually most relevant) output is preserved.
 *
 * @param {string} errorsDir
 *   Base directory where CI stage error artifacts were downloaded.
 * @param {Record<string, import('./risk-resolver.js').StageConfig>} stageConfigs
 *   The `autoHeal.stages` config block.
 * @param {string[]} failedStages
 *   Names of stages that reported `'failure'`.
 * @param {number} [maxBytes=4000]
 *   Maximum number of bytes to keep from each log file.
 * @returns {Record<string, string>}
 *   Map of `{ stageName: logContent }`. Value is `null` if no log was found.
 */
export function collectErrorLogs(
  errorsDir,
  stageConfigs,
  failedStages,
  maxBytes = 4000,
) {
  /** @type {Record<string, string|null>} */
  const result = {};

  for (const stageName of failedStages) {
    const cfg = stageConfigs?.[stageName];
    const logArtifact = cfg?.logArtifact ?? `${stageName}-output.log`;
    const logPath = path.join(errorsDir, stageName, logArtifact);

    try {
      const raw = fs.readFileSync(logPath, 'utf8');
      if (raw.length <= maxBytes) {
        result[stageName] = raw;
      } else {
        // Keep the tail — most CI output puts the error at the end.
        const truncated = raw.slice(-maxBytes);
        result[stageName] =
          `[...truncated — showing last ${maxBytes} bytes...]\n${truncated}`;
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Advisory only — missing logs are not fatal.
        result[stageName] = null;
      } else {
        // Unexpected read error — surface it but do not throw.
        result[stageName] = `[⚠️ Could not read log: ${err.message}]`;
      }
    }
  }

  return result;
}
