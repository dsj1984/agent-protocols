#!/usr/bin/env node

/**
 * .agents/scripts/sprint-code-review.js — Automated Sprint Code Review
 *
 * Performs an automated "first pass" code review on an Epic branch.
 * This script:
 *   1. Identifies all files modified/added in the Epic branch vs main.
 *   2. Runs lint checks on the changed surface.
 *   3. Calculates maintainability scores for the changed files.
 *   4. Generates a summary report of findings.
 *   5. Posts the report to the Epic issue.
 *
 * Usage:
 *   node .agents/scripts/sprint-code-review.js --epic <EPIC_ID>
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { gitSpawn } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';
import { calculateForFile } from './lib/maintainability-engine.js';
import { postStructuredComment } from './lib/orchestration/ticketing.js';
import { createProvider } from './lib/provider-factory.js';

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      base: { type: 'string' },
      post: { type: 'boolean', default: true },
    },
    strict: false,
  });

  const epicId = parseInt(values.epic ?? '', 10);
  if (Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal('Usage: node sprint-code-review.js --epic <EPIC_ID>');
  }

  const { settings, orchestration } = resolveConfig();
  const provider = createProvider(orchestration);
  const baseBranch = values.base ?? settings.baseBranch ?? 'main';
  const epicBranch = `epic/${epicId}`;

  progress('INIT', `Starting automated review for Epic #${epicId}...`);
  progress('GIT', `Comparing ${epicBranch} against ${baseBranch}...`);

  // 1. Get changed files
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

  const results = {
    totalFiles: changedFiles.length,
    jsFiles: 0,
    maintainability: [],
    lintErrors: 0,
    criticalIssues: [],
  };

  for (const relPath of changedFiles) {
    const absPath = path.resolve(PROJECT_ROOT, relPath);
    const ext = path.extname(relPath);

    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      results.jsFiles++;
      const score = calculateForFile(absPath);
      results.maintainability.push({ file: relPath, score });

      if (score < 65) {
        results.criticalIssues.push(
          `🔴 Low Maintainability: \`${relPath}\` (Score: ${score.toFixed(1)})`,
        );
      }
    }
  }

  // 2. Perform focused lint
  progress('LINT', 'Running focused lint check...');
  const lintCmd = settings.validationCommand ?? 'npm run lint';
  // Note: We run the full lint as workspace consistency is key,
  // but a smarter script would filter errors to changed files.
  const lintResult = gitSpawn(PROJECT_ROOT, ...lintCmd.split(' '));
  if (lintResult.status !== 0) {
    results.lintErrors = 1; // Mark that it failed
  }

  // 3. Generate Report
  progress('REPORT', 'Generating findings report...');

  const report = [
    `## 🔬 Automated Code Review Results for Epic #${epicId}`,
    '',
    `**Comparison**: \`${baseBranch}\` ... \`${epicBranch}\``,
    `**Surface Area**: ${changedFiles.length} files changed (${results.jsFiles} JS files)`,
    '',
    '### 📊 Maintainability Overview',
    '| File | Score | Status |',
    '| :--- | :--- | :--- |',
    ...results.maintainability.map((m) => {
      const status =
        m.score >= 85
          ? '🟢 Healthy'
          : m.score >= 65
            ? '🟡 Warning'
            : '🔴 Critical';
      return `| \`${m.file}\` | ${m.score.toFixed(2)} | ${status} |`;
    }),
    '',
    '### 🚨 Critical Findings',
    results.criticalIssues.length > 0
      ? results.criticalIssues.join('\n')
      : '✅ No maintainability blockers identified.',
    '',
    results.lintErrors > 0
      ? '❌ **Lint Check Failed**: Workspace lint issues detected. Please fix before merging.'
      : '✅ **Lint Check Passed**: Workspace is clean.',
    '',
    '---',
    '_This is an automated pre-review. A human or specialist agent should still verify business logic and security constraints._',
  ].join('\n');

  console.log(report);

  // 4. Post to ticket
  if (values.post) {
    progress('POST', `Posting review report to Epic #${epicId}...`);
    await postStructuredComment(provider, epicId, 'notification', report);
    progress('DONE', 'Report posted successfully.');
  }
}

const progress = Logger.createProgress('sprint-review', { stderr: false });

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    Logger.fatal(`sprint-code-review: ${err.message}`);
  });
}
