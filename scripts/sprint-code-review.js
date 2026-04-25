#!/usr/bin/env node

/**
 * .agents/scripts/sprint-code-review.js — Automated Sprint Code Review
 *
 * Performs an automated "first pass" code review on an Epic branch.
 * This script:
 *   1. Identifies all files modified/added in the Epic branch vs main.
 *   2. Runs lint checks on the changed surface and distinguishes
 *      errors (🟠 high risk) from warnings (🟢 suggestion).
 *   3. Calculates per-method maintainability reports for changed JS files
 *      and tiers them so size-driven drops don't poison the Critical tier.
 *   4. Generates a summary report of findings.
 *   5. Posts the report to the Epic issue.
 *
 * Usage:
 *   node .agents/scripts/sprint-code-review.js --epic <EPIC_ID>
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import {
  getCommands,
  PROJECT_ROOT,
  resolveConfig,
} from './lib/config-resolver.js';
import { gitSpawn } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import {
  calculateReportForFile,
  classifyReport,
} from './lib/maintainability-engine.js';
import { upsertStructuredComment } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

/**
 * Parse stdout/stderr from a lint runner to estimate error vs warning counts.
 *
 * Handles the two runners composing `npm run lint` in this project:
 *   - Biome: emits "Found N error(s)." and "Found N warning(s)." lines.
 *   - markdownlint: emits one diagnostic per issue, plus a trailing
 *     "Summary: N error(s)" line.
 *
 * When the output matches neither, we fall back to a conservative default
 * (treat a failing exit code as at least one error so we don't mislabel a
 * real breakage as a soft suggestion).
 *
 * Exported for testing.
 *
 * @param {{ status: number, stdout: string, stderr: string }} result
 * @returns {{ errors: number, warnings: number, parsed: boolean }}
 */
export function parseLintOutput(result) {
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  let errors = 0;
  let warnings = 0;
  let parsed = false;

  // Biome summary lines — use a global regex so we pick up every reporter
  // section (markdown, JS, etc.) when the composite command runs multiple.
  const errMatches = combined.matchAll(/Found\s+(\d+)\s+error/gi);
  for (const m of errMatches) {
    errors += Number(m[1]);
    parsed = true;
  }
  const warnMatches = combined.matchAll(/Found\s+(\d+)\s+warning/gi);
  for (const m of warnMatches) {
    warnings += Number(m[1]);
    parsed = true;
  }

  // markdownlint "Summary: N error(s)" style.
  const mdSummary = combined.match(/Summary:\s+(\d+)\s+error/i);
  if (mdSummary) {
    errors += Number(mdSummary[1]);
    parsed = true;
  }

  if (!parsed && result.status !== 0) {
    // Runner failed and we could not classify — treat as one error so the
    // reviewer is not misled into thinking the code is clean.
    errors = 1;
  }

  return { errors, warnings, parsed };
}

function runLint(lintCmd, cwd) {
  const [cmd, ...args] = lintCmd.split(' ').filter((s) => s.length > 0);
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Parse the CLI argv into a normalized review-config object. Pure; exported
 * for testing.
 *
 * @param {string[]} argv
 * @returns {{ epicId: number|null, baseBranch: string|null, post: boolean }}
 */
export function parseReviewArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      epic: { type: 'string' },
      base: { type: 'string' },
      post: { type: 'boolean', default: true },
    },
    strict: false,
  });
  const parsed = Number.parseInt(values.epic ?? '', 10);
  return {
    epicId: Number.isNaN(parsed) || parsed <= 0 ? null : parsed,
    baseBranch: values.base ?? null,
    post: values.post !== false,
  };
}

/**
 * Pure: classify a single file's maintainability report into a row + optional
 * issue strings. `reportFn` is the file-classifier (defaults to the engine's
 * `calculateReportForFile`); injected so tests can stub deletion / parse
 * errors without touching disk.
 *
 * @returns {{ row: object|null, criticalIssue: string|null, warningIssue: string|null }}
 */
export function classifyChangedFile(relPath, { reportFn, classifier } = {}) {
  const absPath = path.resolve(PROJECT_ROOT, relPath);
  let report;
  try {
    report = reportFn(absPath);
  } catch (_err) {
    return { row: null, criticalIssue: null, warningIssue: null };
  }
  const tier = classifier(report);
  const row = { file: relPath, report, tier };
  if (tier === 'critical') {
    const reason =
      report.worstMethod !== null && report.worstMethod < 20
        ? `worst method ${report.worstMethod.toFixed(1)}`
        : `module score ${report.moduleScore.toFixed(1)}`;
    return {
      row,
      criticalIssue: `🔴 Low Maintainability: \`${relPath}\` (${reason})`,
      warningIssue: null,
    };
  }
  if (tier === 'warning') {
    const moduleScore = report.moduleScore.toFixed(1);
    const worst =
      report.worstMethod !== null
        ? `, worst method ${report.worstMethod.toFixed(1)}`
        : '';
    return {
      row,
      criticalIssue: null,
      warningIssue: `🟡 Size/Volume Warning: \`${relPath}\` (module ${moduleScore}${worst})`,
    };
  }
  return { row, criticalIssue: null, warningIssue: null };
}

/**
 * Pure: walk every changed JS file and accumulate the review tally.
 * `reportFn` and `classifier` are injected for testability.
 */
export function analyzeChangedFiles(
  changedFiles,
  { reportFn = calculateReportForFile, classifier = classifyReport } = {},
) {
  const results = {
    totalFiles: changedFiles.length,
    jsFiles: 0,
    maintainability: [],
    criticalIssues: [],
    warningIssues: [],
  };
  for (const relPath of changedFiles) {
    const ext = path.extname(relPath);
    if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') continue;
    results.jsFiles += 1;
    const { row, criticalIssue, warningIssue } = classifyChangedFile(relPath, {
      reportFn,
      classifier,
    });
    if (!row) continue;
    results.maintainability.push(row);
    if (criticalIssue) results.criticalIssues.push(criticalIssue);
    if (warningIssue) results.warningIssues.push(warningIssue);
  }
  return results;
}

/** Pure: severity counts derived from the analysis tally + lint summary. */
export function buildSeverity(results, lintSummary) {
  return {
    critical: results.criticalIssues.length,
    high: lintSummary.errors > 0 ? 1 : 0,
    medium: results.warningIssues.length,
    suggestion: lintSummary.warnings > 0 ? 1 : 0,
  };
}

/** Pure: render the lint-status one-liner for the report. */
export function buildLintLine(lintSummary) {
  if (lintSummary.errors > 0) {
    return `❌ **Lint Check Failed**: ${lintSummary.errors} error(s), ${lintSummary.warnings} warning(s). Fix errors before merging.`;
  }
  if (lintSummary.warnings > 0) {
    return `🟢 **Lint Check Passed with Warnings**: ${lintSummary.warnings} warning(s) present — treat as suggestions.`;
  }
  return '✅ **Lint Check Passed**: Workspace is clean.';
}

function tierLabel(tier) {
  if (tier === 'healthy') return '🟢 Healthy';
  if (tier === 'warning') return '🟡 Warning';
  if (tier === 'critical') return '🔴 Critical';
  return '⚠️ Parse Error';
}

/** Pure: assemble the markdown review body. */
export function buildReviewReport({
  epicId,
  baseBranch,
  epicBranch,
  results,
  severity,
  lintLine,
}) {
  return [
    `## 🔬 Automated Code Review Results for Epic #${epicId}`,
    '',
    `**Comparison**: \`${baseBranch}\` ... \`${epicBranch}\``,
    `**Surface Area**: ${results.totalFiles} files changed (${results.jsFiles} JS files)`,
    '',
    '### 📦 Severity Tier Counts',
    '',
    `- 🔴 Critical Blocker: ${severity.critical}`,
    `- 🟠 High Risk: ${severity.high}`,
    `- 🟡 Medium Risk: ${severity.medium}`,
    `- 🟢 Suggestion: ${severity.suggestion}`,
    '',
    '### 📊 Maintainability Overview',
    '| File | Module | Worst Method | Tier |',
    '| :--- | :--- | :--- | :--- |',
    ...results.maintainability.map((m) => {
      const worst =
        m.report.worstMethod !== null ? m.report.worstMethod.toFixed(1) : 'n/a';
      return `| \`${m.file}\` | ${m.report.moduleScore.toFixed(2)} | ${worst} | ${tierLabel(m.tier)} |`;
    }),
    '',
    '### 🚨 Critical Findings',
    results.criticalIssues.length > 0
      ? results.criticalIssues.join('\n')
      : '✅ No maintainability blockers identified.',
    '',
    '### 🟡 Warnings',
    results.warningIssues.length > 0
      ? results.warningIssues.join('\n')
      : '✅ No size/volume warnings.',
    '',
    lintLine,
    '',
    '---',
    '_This is an automated pre-review. A human or specialist agent should still verify business logic and security constraints._',
  ].join('\n');
}

async function main() {
  const args = parseReviewArgs(process.argv.slice(2));
  if (args.epicId === null) {
    Logger.fatal('Usage: node sprint-code-review.js --epic <EPIC_ID>');
  }

  const { settings, orchestration } = resolveConfig();
  const baseBranch = args.baseBranch ?? settings.baseBranch ?? 'main';
  const epicBranch = `epic/${args.epicId}`;

  progress('INIT', `Starting automated review for Epic #${args.epicId}...`);
  progress('GIT', `Comparing ${epicBranch} against ${baseBranch}...`);

  const diffResult = gitSpawn(
    PROJECT_ROOT,
    'diff',
    `${baseBranch}...${epicBranch}`,
    '--name-only',
  );
  if (diffResult.status !== 0) {
    Logger.fatal(`Failed to get diff: ${diffResult.stderr}`);
  }

  const changedFiles = diffResult.stdout
    .trim()
    .split('\n')
    .filter((f) => f.length > 0);

  if (changedFiles.length === 0) {
    progress('DONE', 'No changes detected. Skipping review.');
    return;
  }

  progress('REVIEW', `Analyzing ${changedFiles.length} changed files...`);
  const results = analyzeChangedFiles(changedFiles);

  progress('LINT', 'Running focused lint check...');
  const lintCmd = getCommands({ agentSettings: settings }).validate;
  const lintSummary = parseLintOutput(runLint(lintCmd, PROJECT_ROOT));

  progress('REPORT', 'Generating findings report...');
  const severity = buildSeverity(results, lintSummary);
  const report = buildReviewReport({
    epicId: args.epicId,
    baseBranch,
    epicBranch,
    results,
    severity,
    lintLine: buildLintLine(lintSummary),
  });
  console.log(report);

  if (args.post) {
    progress('POST', `Posting review report to Epic #${args.epicId}...`);
    const provider = createProvider(orchestration);
    await upsertStructuredComment(provider, args.epicId, 'code-review', report);
    progress('DONE', 'Report posted successfully.');
  }
}

const progress = Logger.createProgress('sprint-review', { stderr: false });

runAsCli(import.meta.url, main, { source: 'sprint-code-review' });
