#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';
import { selectAudits } from './mcp/select-audits.js';
import { runAuditSuite } from './mcp/run-audit-suite.js';
import { Logger } from './lib/Logger.js';

function formatAuditReport(results) {
  const { metadata, findings } = results;
  const { summary, auditsRun } = metadata;

  let report = '## 🛡️ Audit Orchestrator Report\n\n';

  if (auditsRun.length === 0) {
    report += 'No audits were run during this gate.\n';
    return report;
  }

  report += `**Audits Executed:** ${auditsRun.join(', ')}\n`;
  report += `**Summary:** 🔴 ${summary.critical} Critical | 🟠 ${summary.high} High | 🟡 ${summary.medium} Medium | ⚪ ${summary.low} Low\n\n`;

  if (findings.length === 0) {
    report += '✅ **All audits passed with no findings!**\n';
    return report;
  }

  report += '### Findings\n\n';
  report += '| Audit | Severity | Message |\n';
  report += '|-------|----------|---------|\n';

  // Sort findings by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  for (const finding of findings) {
    // Basic severity icon
    let icon = '⚪';
    if (finding.severity === 'critical') icon = '🔴';
    if (finding.severity === 'high') icon = '🟠';
    if (finding.severity === 'medium') icon = '🟡';

    // Clean up message so it fits in a table cell (replace newlines)
    const msg = finding.message
      ? finding.message.replace(/\n/g, '<br>')
      : 'No details provided';
    report += `| ${finding.audit} | ${icon} ${finding.severity.toUpperCase()} | ${msg} |\n`;
  }

  // If there are critical or high findings, we suggest a review
  if (summary.critical > 0 || summary.high > 0) {
    report +=
      '\n> [!WARNING]\n> High or Critical findings detected. Please address these before proceeding to the next gate.\n';
  }

  return report;
}

export async function runAuditOrchestrator(
  ticketId,
  gate,
  baseBranch = 'main',
) {
  Logger.info(
    `Starting Audit Orchestrator for Ticket #${ticketId} at gate '${gate}'`,
  );

  const config = resolveConfig();
  const provider = createProvider(config.orchestration);

  Logger.info(`Selecting audits...`);
  const selection = await selectAudits({
    ticketId,
    gate,
    provider,
    baseBranch,
  });

  if (selection.selectedAudits.length === 0) {
    Logger.info(`No audits selected for this gate/ticket combination.`);
    const report =
      '## 🛡️ Audit Orchestrator\n\nNo audits triggered natively for this lifecycle gate based on file changes or issue metadata.';
    await provider.postComment(ticketId, {
      body: report,
      type: 'notification',
    });
    return;
  }

  Logger.info(`Selected audits: ${selection.selectedAudits.join(', ')}`);
  Logger.info(`Running audits...`);

  const results = await runAuditSuite({
    auditWorkflows: selection.selectedAudits,
  });

  Logger.info(`Formatting report...`);
  const reportMarkdown = formatAuditReport(results);

  Logger.info(`Posting report to Ticket #${ticketId}...`);
  await provider.postComment(ticketId, {
    body: reportMarkdown,
    type: 'progress', // notification or progress both valid, progress implies a step in pipeline
  });

  Logger.info(`Audit Orchestrator finished successfully.`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      ticket: { type: 'string' },
      gate: { type: 'string' },
      'base-branch': { type: 'string', default: 'main' },
    },
  });

  if (!values.ticket || !values.gate) {
    Logger.fatal(
      'Usage: node audit-orchestrator.js --ticket <ID> --gate <gateName> [--base-branch <branch>]',
    );
  }

  const ticketId = parseInt(values.ticket, 10);
  await runAuditOrchestrator(ticketId, values.gate, values['base-branch']);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    Logger.fatal(`Fatal error: ${err.stack || err.message}`);
  });
}
