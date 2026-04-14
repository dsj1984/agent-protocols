#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * auto-heal.js — CLI Entry Point for CI Auto-Heal
 *
 * Thin CLI wrapper that reads CI stage results, resolves the governance risk
 * tier, assembles an AI prompt from error logs, and dispatches to the
 * configured adapter (Jules API or GitHub Issue).
 *
 * This script is intentionally best-effort: EVERY code path exits with code 0.
 * Auto-heal is advisory and must never block or fail the CI pipeline itself.
 *
 * Usage:
 *   node .agents/scripts/auto-heal.js \
 *     --stage lint=failure \
 *     --stage typecheck=success \
 *     --stage unit=failure \
 *     --errors-dir ./auto-heal-errors \
 *     --sha abc1234 \
 *     --pr 42 \
 *     --branch main \
 *     --dry-run
 *
 * @see .agents/workflows/ci-auto-heal.md
 * @see .agents/templates/ci-auto-heal-job.yml
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildAutoHealPrompt,
  collectErrorLogs,
  GitHubIssueAdapter,
  JulesAdapter,
  resolveRiskTier,
} from './lib/auto-heal/index.js';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';

// ── Defaults ──────────────────────────────────────────────────────────────────

const AUTO_HEAL_DEFAULTS = {
  enabled: true,
  adapter: 'jules',
  maxLogSizeBytes: 4000,
  branchFilter: ['main'],
  consolidateSession: true,
};

// ── CLI Argument Parsing ──────────────────────────────────────────────────────

/**
 * Parse auto-heal–specific CLI arguments.
 * Uses `node:util` parseArgs directly — does NOT use shared `cli-args.js`
 * because auto-heal has a distinct argument surface.
 *
 * @returns {{ stage: string[], errorsDir: string, sha: string, pr: string, branch: string, dryRun: boolean }}
 */
function parseAutoHealArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      stage: { type: 'string', multiple: true },
      'errors-dir': { type: 'string', default: './auto-heal-errors' },
      sha: { type: 'string', default: '' },
      pr: { type: 'string', default: '0' },
      branch: { type: 'string', default: 'main' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: false,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Usage: node auto-heal.js [options]

Options:
  --stage <name>=<result>   CI stage name and result (repeatable).
                            Result must be one of: success, failure, skipped, cancelled.
                            Example: --stage lint=failure --stage typecheck=success
  --errors-dir <path>       Directory containing downloaded CI error artifacts.
                            Default: ./auto-heal-errors
  --sha <sha>               Full or short commit SHA. Default: empty.
  --pr <number>             Pull request number. Default: 0 (not a PR).
  --branch <name>           Branch name that triggered CI. Default: main.
  --dry-run                 Print risk analysis and prompt, then exit. No dispatch.
  -h, --help                Show this help message.

Environment Variables:
  JULES_API_KEY             Required for the 'jules' adapter.
  GITHUB_TOKEN              Required for the 'github-issue' adapter.

Configuration:
  All adapter settings are read from the 'autoHeal' block in .agentrc.json.
  See .agents/templates/ci-auto-heal-job.yml for a full CI integration example.
`);
    process.exit(0);
  }

  return {
    stage: values.stage ?? [],
    errorsDir: values['errors-dir'],
    sha: values.sha,
    pr: values.pr,
    branch: values.branch,
    dryRun: values['dry-run'],
  };
}

// ── Stage Result Parser ───────────────────────────────────────────────────────

/**
 * Parse `--stage name=result` pairs into a `Record<string, string>` map.
 * Malformed values are logged as warnings and skipped.
 *
 * @param {string[]} stageArgs  Array of raw `name=result` strings.
 * @returns {Record<string, string>}
 */
function parseStageArgs(stageArgs) {
  /** @type {Record<string, string>} */
  const stageResults = {};
  for (const arg of stageArgs) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      console.warn(
        `[AutoHeal] ⚠️ Ignoring malformed --stage value: "${arg}" (expected name=result)`,
      );
      continue;
    }
    const name = arg.slice(0, eqIdx).trim();
    const result = arg.slice(eqIdx + 1).trim();
    if (!name || !result) {
      console.warn(
        `[AutoHeal] ⚠️ Ignoring empty stage name or result in: "${arg}"`,
      );
      continue;
    }
    stageResults[name] = result;
  }
  return stageResults;
}

// ── Adapter Factory ───────────────────────────────────────────────────────────

/**
 * Instantiate the configured adapter from the `autoHeal.adapter` string.
 *
 * @param {string} adapterName
 * @param {object} autoHealConfig
 * @param {object|null} orchestration
 * @returns {import('./lib/auto-heal/adapters/jules-adapter.js').IAutoHealAdapter}
 */
function resolveAdapter(adapterName, autoHealConfig, orchestration) {
  const adaptersConfig = autoHealConfig.adapters ?? {};

  switch (adapterName) {
    case 'jules':
      return new JulesAdapter(adaptersConfig.jules ?? {});

    case 'github-issue':
      return new GitHubIssueAdapter(
        adaptersConfig['github-issue'] ?? {},
        orchestration,
      );

    default:
      console.warn(
        `[AutoHeal] ⚠️ Unknown adapter "${adapterName}". Falling back to "jules".`,
      );
      return new JulesAdapter(adaptersConfig.jules ?? {});
  }
}

// ── Apply Auto-Heal Defaults ──────────────────────────────────────────────────

/**
 * Merge consumer config with auto-heal defaults.
 *
 * @param {object|null} raw - The raw `autoHeal` block from `.agentrc.json`.
 * @returns {object} Config with all defaults applied.
 */
function applyAutoHealDefaults(raw) {
  if (!raw) return { ...AUTO_HEAL_DEFAULTS };
  return {
    ...AUTO_HEAL_DEFAULTS,
    ...raw,
    adapters: raw.adapters ?? {},
    stages: raw.stages ?? {},
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { stage, errorsDir, sha, pr, branch, dryRun } = parseAutoHealArgs();

  // ── 1. Load configuration ──────────────────────────────────────────────────
  let config;
  try {
    config = resolveConfig();
  } catch (configErr) {
    console.warn(
      `[AutoHeal] ⚠️ Config load failed: ${configErr.message}. Using defaults.`,
    );
    config = { settings: {}, orchestration: null, autoHeal: null, raw: null };
  }

  const rawAutoHeal = config.raw?.autoHeal ?? null;
  const autoHeal = applyAutoHealDefaults(rawAutoHeal);

  // ── 2. Guard: feature disabled ─────────────────────────────────────────────
  if (autoHeal.enabled === false) {
    console.log(
      '[AutoHeal] ℹ️ Auto-heal is disabled (autoHeal.enabled=false). Exiting.',
    );
    process.exit(0);
  }

  // ── 3. Parse stage results ─────────────────────────────────────────────────
  const stageResults = parseStageArgs(stage);

  if (Object.keys(stageResults).length === 0) {
    console.log('[AutoHeal] ℹ️ No --stage arguments provided. Nothing to do.');
    process.exit(0);
  }

  // ── 4. Resolve risk tier ───────────────────────────────────────────────────
  const { riskTier, autoApprove, failedStages } = resolveRiskTier(
    stageResults,
    autoHeal.stages,
  );

  if (failedStages.length === 0) {
    console.log(
      '[AutoHeal] ✅ No stage failures detected. Auto-heal not needed.',
    );
    process.exit(0);
  }

  console.log(`[AutoHeal] ⚡ Failures detected in: ${failedStages.join(', ')}`);
  console.log(
    `[AutoHeal] Risk tier: ${riskTier.toUpperCase()} | Auto-approve: ${autoApprove}`,
  );

  // ── 5. Collect error logs ──────────────────────────────────────────────────
  const resolvedErrorsDir = path.resolve(errorsDir);
  const errorSections = collectErrorLogs(
    resolvedErrorsDir,
    autoHeal.stages,
    failedStages,
    autoHeal.maxLogSizeBytes,
  );

  // ── 6. Build prompt ────────────────────────────────────────────────────────
  const orchestration = config.orchestration ?? null;
  const repo = orchestration?.github
    ? `${orchestration.github.owner}/${orchestration.github.repo}`
    : '(unknown/repo)';

  const prompt = buildAutoHealPrompt({
    repo,
    sha,
    prNumber: pr,
    branch,
    failedStages,
    stageConfigs: autoHeal.stages,
    errorSections,
    riskTier,
    autoApprove,
  });

  // ── 7. Dry-run exit ────────────────────────────────────────────────────────
  if (dryRun) {
    const separator = '─'.repeat(72);
    console.log(`\n${separator}`);
    console.log('🔍  AUTO-HEAL DRY RUN');
    console.log(separator);
    console.log(`  Risk Tier   : ${riskTier.toUpperCase()}`);
    console.log(`  Auto-Approve: ${autoApprove}`);
    console.log(`  Failed Stages: ${failedStages.join(', ')}`);
    console.log(`  Adapter      : ${autoHeal.adapter}`);
    console.log(`${separator}\n`);
    console.log('PROMPT:\n');
    console.log(prompt);
    console.log(`\n${separator}\n`);
    process.exit(0);
  }

  // ── 8. Resolve and dispatch via adapter ────────────────────────────────────
  const adapter = resolveAdapter(autoHeal.adapter, autoHeal, orchestration);
  console.log(`[AutoHeal] ${adapter.describe()}`);

  const requirePlanApproval =
    autoHeal.adapters?.jules?.requirePlanApproval ?? riskTier !== 'green';

  const shortSha = String(sha).slice(0, 7);
  const title = `CI self-heal: ${failedStages.join(', ')} (${shortSha})`;

  let result;
  try {
    result = await adapter.dispatch({
      prompt,
      repo,
      branch,
      sha,
      title,
      riskTier,
      autoApprove,
      requirePlanApproval,
    });
  } catch (dispatchErr) {
    // Should be unreachable — adapters are contract-bound to never throw.
    console.warn(
      `[AutoHeal] ⚠️ Adapter threw unexpectedly: ${dispatchErr.message}. ` +
        `Auto-heal is advisory — CI will still succeed.`,
    );
    process.exit(0);
  }

  // ── 9. Log result ─────────────────────────────────────────────────────────
  if (result.status === 'created') {
    const ref = result.sessionId ?? result.issueUrl ?? result.issueNumber;
    console.log(`[AutoHeal] ✅ Dispatch successful. Reference: ${ref}`);
  } else {
    console.warn(
      `[AutoHeal] ⚠️ Dispatch result: ${result.status}` +
        (result.message ? ` — ${result.message}` : ''),
    );
  }

  // Always exit 0 — auto-heal is best-effort, never blocking.
  process.exit(0);
}

runAsCli(import.meta.url, main, {
  source: 'AutoHeal',
  // Exit 0 even on total failure — auto-heal is advisory and must never
  // block or fail the CI pipeline itself.
  onError: (err) => {
    console.warn(`[AutoHeal] Unhandled error: ${err.message}`);
    process.exit(0);
  },
});
