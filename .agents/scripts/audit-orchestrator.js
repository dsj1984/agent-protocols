#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';
import { runAuditSuite } from './mcp/run-audit-suite.js';
import { selectAudits } from './mcp/select-audits.js';

function formatAuditReport(results) {
  const { metadata, findings, workflows } = results;
  const { summary, auditsRun } = metadata;

  let report = '## 🛡️ Audit Orchestrator Report\n\n';

  if (auditsRun.length === 0 && findings.length === 0) {
    report += 'No audits were run during this gate.\n';
    return report;
  }

  if (findings.length > 0) {
    report += '### ⚠️ Audit Configuration Issues\n\n';
    report += '| Audit | Severity | Message |\n';
    report += '|-------|----------|---------|\n';
    for (const finding of findings) {
      let icon = '⚪';
      if (finding.severity === 'critical') icon = '🔴';
      if (finding.severity === 'high') icon = '🟠';
      if (finding.severity === 'medium') icon = '🟡';
      const msg = finding.message
        ? finding.message.replace(/\n/g, '<br>')
        : 'No details provided';
      report += `| ${finding.audit} | ${icon} ${finding.severity.toUpperCase()} | ${msg} |\n`;
    }
    report += '\n';
  }

  if (workflows.length > 0) {
    const executedList = auditsRun.join(', ');
    report += `**Audit Workflows Dispatched:** ${executedList}\n`;
    report += `**Summary:** 🔴 ${summary.critical} Critical | 🟠 ${summary.high} High | 🟡 ${summary.medium} Medium | ⚪ ${summary.low} Low\n\n`;
    report +=
      '> [!NOTE]\n> The following audit workflows are ready to execute. Run each prompt as a dedicated agent task.\n\n';

    for (const wf of workflows) {
      report += `---\n\n### Audit: \`${wf.audit}\`\n\n`;
      report += wf.content;
      report += '\n\n';
    }
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
