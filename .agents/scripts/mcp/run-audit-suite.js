import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from '../lib/config-resolver.js';
import { ValidationError } from '../lib/errors/index.js';

const BUILT_IN_SUBSTITUTION_KEYS = Object.freeze([
  'auditOutputDir',
  'ticketId',
  'baseBranch',
]);

function _normalizeFinding(auditName, finding) {
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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySubstitutions(content, substitutions) {
  let out = content;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.replace(
      new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'),
      value,
    );
  }
  return out;
}

/**
 * Aggregate the allowed substitution key set for a run: built-ins plus
 * per-audit declared keys across the requested auditWorkflows. Audits that
 * are not registered in rules are ignored here — the handler below rejects
 * them with a findings entry before substitution matters.
 */
function computeAllowedKeys(rules, auditWorkflows) {
  const allowed = new Set(BUILT_IN_SUBSTITUTION_KEYS);
  for (const auditName of auditWorkflows) {
    const entry = rules.audits?.[auditName];
    if (!entry) continue;
    for (const k of entry.substitutionKeys ?? []) {
      allowed.add(k);
    }
  }
  return allowed;
}

/**
 * Run a suite of named audit workflows.
 *
 * For each audit name the suite will:
 *   1. Validate it is registered in audit-rules.schema.json.
 *   2. Locate the corresponding `.agents/workflows/<auditName>.md` file.
 *   3. Return its markdown content as a structured `workflow` result for the
 *      calling AI agent to execute as a prompt-driven analysis.
 *
 * Substitutions: callers may pass a `substitutions` map of `{{key}}` → value
 * pairs. Allowed keys are the built-ins (auditOutputDir, ticketId, baseBranch)
 * plus any `substitutionKeys` declared on the requested audits in
 * audit-rules.schema.json, aggregated across auditWorkflows. Unknown keys
 * raise a ValidationError.
 *
 * @param {object} opts
 * @param {string[]} opts.auditWorkflows - List of audit names to run.
 * @param {Record<string,string>} [opts.substitutions] - Optional template substitutions.
 * @param {Function} [opts.injectedLoadWorkflow] - Optional override for testing.
 * @param {object} [opts.injectedRules] - Optional override for the audit-rules content (testing).
 * @returns {Promise<object>} Aggregated audit results.
 */
export async function runAuditSuite({
  auditWorkflows,
  substitutions,
  injectedLoadWorkflow,
  injectedRules,
}) {
  const { settings } = resolveConfig();
  const callerSubstitutions = substitutions ?? {};

  let rules = injectedRules;
  if (!rules) {
    const rulesPath = path.join(
      PROJECT_ROOT,
      settings.schemasRoot,
      'audit-rules.schema.json',
    );
    const rulesContent = await fs.readFile(rulesPath, 'utf8');
    rules = JSON.parse(rulesContent);
  }

  const allowedKeys = computeAllowedKeys(rules, auditWorkflows);
  const unknownKeys = Object.keys(callerSubstitutions).filter(
    (k) => !allowedKeys.has(k),
  );
  if (unknownKeys.length > 0) {
    const allowedList = [...allowedKeys].sort().join(', ');
    throw new ValidationError(
      `Unknown substitution key(s): ${unknownKeys.join(', ')}. Allowed for this call: ${allowedList}.`,
      { unknownKeys, allowedKeys: [...allowedKeys] },
    );
  }

  const effectiveSubstitutions = {
    auditOutputDir: settings.auditOutputDir ?? 'temp',
    ...callerSubstitutions,
  };

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
          message: `Requested audit workflow '${auditName}' is not defined in audit-rules.schema.json.`,
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

    const content = applySubstitutions(
      workflow.content,
      effectiveSubstitutions,
    );

    return {
      success: true,
      auditName,
      workflowContent: content,
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
