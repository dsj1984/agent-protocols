#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * run-audit-suite.js — CLI + SDK for running a list of audit workflows.
 *
 * Successor to the retired agent-protocols MCP tools. See ADR 20260424-702a in docs/decisions.md for the migration table.
 *
 * The pure aggregation logic lives here.
 *
 * Usage:
 *   node .agents/scripts/run-audit-suite.js \
 *     --audits <comma-list> [--ticket <id>] [--base-branch main] \
 *     [--substitution key=value]...
 *
 * Output: a single JSON object on stdout matching the MCP envelope:
 *   { metadata: { ... }, findings: [...], workflows: [...] }
 *
 * Exit codes:
 *   0 — suite completed (findings entries are not failures)
 *   non-zero — argument or substitution validation failure (error on stderr)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import {
  getPaths,
  PROJECT_ROOT,
  resolveConfig,
} from './lib/config-resolver.js';
import { ValidationError } from './lib/errors/index.js';

const BUILT_IN_SUBSTITUTION_KEYS = Object.freeze([
  'auditOutputDir',
  'ticketId',
  'baseBranch',
]);

const HELP = `Usage: node .agents/scripts/run-audit-suite.js \\
  --audits <comma-list> [--ticket <id>] [--base-branch main] \\
  [--substitution key=value]...

Flags:
  --audits         Comma-separated audit workflow names (required).
  --ticket         Ticket id used for the {{ticketId}} substitution (optional).
  --base-branch    Value used for the {{baseBranch}} substitution (default: main).
  --substitution   Repeatable key=value substitution (e.g. --substitution alphaKey=val).
                   Allowed keys are the built-ins (auditOutputDir, ticketId, baseBranch)
                   plus any substitutionKeys declared on the requested audits.
  --help           Show this message.
`;

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
  const paths = getPaths({ agentSettings: settings });
  const callerSubstitutions = substitutions ?? {};

  let rules = injectedRules;
  if (!rules) {
    const rulesPath = path.join(
      PROJECT_ROOT,
      paths.schemasRoot,
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
    auditOutputDir: paths.auditOutputDir,
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

  const workflowsDir = path.join(PROJECT_ROOT, paths.workflowsRoot);

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

  auditResults.metadata.summary = aggregateSummary(auditResults.findings);

  return auditResults;
}

/**
 * Pure: count findings into a {critical,high,medium,low} histogram. Findings
 * with severities outside that set are ignored, keeping the rendered summary
 * truthful even if upstream callers append non-standard severities.
 */
export function aggregateSummary(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings ?? []) {
    if (Object.hasOwn(summary, finding.severity)) {
      summary[finding.severity] += 1;
    }
  }
  return summary;
}

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      audits: { type: 'string' },
      ticket: { type: 'string' },
      'base-branch': { type: 'string' },
      substitution: { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
    strict: false,
  });
  return values;
}

function parseSubstitutionPairs(pairs = []) {
  const out = {};
  for (const entry of pairs) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new ValidationError(
        `Invalid --substitution "${entry}"; expected key=value.`,
        { entry },
      );
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseCliArgs(argv);

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!values.audits) {
    process.stderr.write(
      `[run-audit-suite] --audits <comma-list> is required.\n${HELP}`,
    );
    process.exit(2);
  }

  const auditWorkflows = values.audits
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (auditWorkflows.length === 0) {
    process.stderr.write(
      `[run-audit-suite] --audits must contain at least one workflow name.\n`,
    );
    process.exit(2);
  }

  const substitutions = parseSubstitutionPairs(values.substitution);
  if (values.ticket && substitutions.ticketId === undefined) {
    substitutions.ticketId = String(values.ticket);
  }
  if (values['base-branch'] && substitutions.baseBranch === undefined) {
    substitutions.baseBranch = values['base-branch'];
  }

  const result = await runAuditSuite({ auditWorkflows, substitutions });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

runAsCli(import.meta.url, main, { source: 'run-audit-suite' });
