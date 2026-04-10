import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PROJECT_ROOT, resolveConfig } from '../lib/config-resolver.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function executeAudit(auditName, scriptPath) {
  try {
    const { stdout } = await execAsync(`node "${scriptPath}"`);
    if (!stdout.trim()) {
      return [];
    }

    let findings = JSON.parse(stdout);
    if (!Array.isArray(findings)) {
      findings = [findings];
    }
    return findings;
  } catch (e) {
    if (e.name === 'SyntaxError') {
      return [
        {
          audit: auditName,
          severity: 'high',
          message: `Audit script '${auditName}.js' returned invalid JSON: ${e.message}`,
          rawOutput: e.message.substring(0, 500), // simplified
        },
      ];
    }
    return [
      {
        audit: auditName,
        severity: 'high',
        message: `Execution of '${auditName}.js' failed: ${e.message}`,
      },
    ];
  }
}

function normalizeFinding(auditName, finding) {
  const rawSeverity = finding.severity?.toLowerCase() || 'low';
  const severity = ['critical', 'high', 'medium', 'low'].includes(rawSeverity)
    ? rawSeverity
    : 'low';

  return {
    audit: auditName,
    ...finding,
    severity,
  };
}

export async function runAuditSuite({ auditWorkflows, injectedExecute }) {
  const { settings } = resolveConfig();
  const rulesPath = path.join(
    PROJECT_ROOT,
    settings.schemasRoot,
    'audit-rules.json',
  );
  const rulesContent = await fs.readFile(rulesPath, 'utf8');
  const rules = JSON.parse(rulesContent);

  const validAudits = Object.keys(rules.audits || {});
  const auditResults = {
    metadata: {
      timestamp: new Date().toISOString(),
      auditsRequested: auditWorkflows,
      auditsRun: [],
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
    },
    findings: [],
  };

  const scriptsDir = path.join(PROJECT_ROOT, settings.scriptsRoot, 'audits');

  for (const auditName of auditWorkflows) {
    if (!validAudits.includes(auditName)) {
      auditResults.findings.push({
        audit: auditName,
        severity: 'low',
        message: `Requested audit workflow '${auditName}' is not defined in audit-rules.json.`,
      });
      continue;
    }

    const scriptPath = path.join(scriptsDir, `${auditName}.js`);
    try {
      await fs.access(scriptPath);
    } catch {
      auditResults.findings.push({
        audit: auditName,
        severity: 'low',
        message: `SYSTEM-MISSING-SCRIPT: Audit script '${auditName}.js' not found in audits directory.`,
      });
      continue;
    }

    auditResults.metadata.auditsRun.push(auditName);
    const findings = injectedExecute
      ? await injectedExecute(auditName, scriptPath)
      : await executeAudit(auditName, scriptPath);

    for (const rawFinding of findings) {
      const normalized = normalizeFinding(auditName, rawFinding);
      auditResults.findings.push(normalized);
      auditResults.metadata.summary[normalized.severity]++;
    }
  }

  return auditResults;
}
