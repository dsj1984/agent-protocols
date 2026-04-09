import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runAuditSuite({ auditWorkflows }) {
  const rulesPath = path.resolve(__dirname, '../../schemas/audit-rules.json');
  const rulesContent = await fs.readFile(rulesPath, 'utf8');
  const rules = JSON.parse(rulesContent);

  const validAudits = rules.workflows.map((w) => w.name);
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

  // Ensure scripts dir exists
  const scriptsDir = path.resolve(__dirname, '../audits');

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

    try {
      const { stdout } = await execAsync(`node "${scriptPath}"`);
      auditResults.metadata.auditsRun.push(auditName);

      let findings = [];
      if (stdout.trim()) {
        try {
          findings = JSON.parse(stdout);
          if (!Array.isArray(findings)) {
            findings = [findings];
          }
        } catch (e) {
          auditResults.findings.push({
            audit: auditName,
            severity: 'high',
            message: `Audit script '${auditName}.js' returned invalid JSON: ${e.message}`,
            rawOutput: stdout.substring(0, 500),
          });
          continue;
        }
      }

      for (const finding of findings) {
        const severity = finding.severity?.toLowerCase() || 'low';
        auditResults.findings.push({
          audit: auditName,
          ...finding,
          severity,
        });

        switch (severity) {
          case 'critical':
            auditResults.metadata.summary.critical++;
            break;
          case 'high':
            auditResults.metadata.summary.high++;
            break;
          case 'medium':
            auditResults.metadata.summary.medium++;
            break;
          case 'low':
            auditResults.metadata.summary.low++;
            break;
          default:
            auditResults.metadata.summary.low++;
            break;
        }
      }
    } catch (e) {
      auditResults.findings.push({
        audit: auditName,
        severity: 'high',
        message: `Execution of '${auditName}.js' failed: ${e.message}`,
      });
    }
  }

  return auditResults;
}
