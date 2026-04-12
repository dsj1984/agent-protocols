import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from '../lib/config-resolver.js';

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

/**
 * Resolve the workflow markdown file for a given audit name.
 * Returns the file content, or null if not found.
 */
async function loadWorkflow(auditName, workflowsDir) {
  const workflowPath = path.join(workflowsDir, `${auditName}.md`);
  try {
    const content = await fs.readFile(workflowPath, 'utf8');
    return { path: workflowPath, content };
  } catch {
    return null;
  }
}

/**
 * Run a suite of named audit workflows.
 *
 * For each audit name the suite will:
 *   1. Validate it is registered in audit-rules.json.
 *   2. Locate the corresponding `.agents/workflows/<auditName>.md` file.
 *   3. Return its markdown content as a structured `workflow` result for the
 *      calling AI agent to execute as a prompt-driven analysis.
 *
 * @param {object} opts
 * @param {string[]} opts.auditWorkflows - List of audit names to run.
 * @param {Function} [opts.injectedLoadWorkflow] - Optional override for testing.
 * @returns {Promise<object>} Aggregated audit results.
 */
export async function runAuditSuite({ auditWorkflows, injectedLoadWorkflow }) {
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
    workflows: [],
  };

  const workflowsDir = path.join(PROJECT_ROOT, settings.workflowsRoot);

  const auditPromises = auditWorkflows.map(async (auditName) => {
    if (!validAudits.includes(auditName)) {
      return {
        error: true,
        finding: {
          audit: auditName,
          severity: 'low',
          message: `Requested audit workflow '${auditName}' is not defined in audit-rules.json.`,
        },
      };
    }

    const loader = injectedLoadWorkflow ?? loadWorkflow;
    const workflow = await loader(auditName, workflowsDir);

    if (!workflow) {
      return {
        error: true,
        finding: {
          audit: auditName,
          severity: 'low',
          message: `Audit workflow '${auditName}.md' not found in workflows directory.`,
        },
      };
    }

    return {
      success: true,
      auditName,
      workflowContent: workflow.content,
    };
  });

  const results = await Promise.all(auditPromises);

  for (const result of results) {
    if (result.error) {
      auditResults.findings.push(result.finding);
    } else if (result.success) {
      auditResults.metadata.auditsRun.push(result.auditName);
      auditResults.workflows.push({
        audit: result.auditName,
        content: result.workflowContent,
      });
    }
  }

  return auditResults;
}
