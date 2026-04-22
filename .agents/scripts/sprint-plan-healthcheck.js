#!/usr/bin/env node

/* node:coverage ignore file */

/**
 * sprint-plan-healthcheck.js — Post-Plan Readiness Check
 *
 * Runs at the end of /sprint-plan (Phase 5) to validate the backlog and
 * prime the execution environment before handing off to /sprint-execute.
 *
 * Checks:
 *   1. Ticket hierarchy — all Features/Stories/Tasks exist with correct labels.
 *   2. Dependency graph — no cycles in the task DAG.
 *   3. Git remote — origin is reachable and baseBranch exists.
 *   4. Config — .agentrc.json orchestration block is valid.
 *   5. pnpm store — if nodeModulesStrategy is 'pnpm-store', prime the
 *      content-addressable store so worktree installs are near-instant.
 *
 * Non-blocking: reports findings but always exits 0. The plan is already
 * committed to GitHub — failing here doesn't un-create tickets.
 *
 * Usage:
 *   node sprint-plan-healthcheck.js --epic <EPIC_ID> [--dry-run]
 *
 * @see .agents/workflows/sprint-plan.md Phase 5
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import {
  PROJECT_ROOT,
  resolveConfig,
  validateOrchestrationConfig,
} from './lib/config-resolver.js';
import { parseBlockedBy } from './lib/dependency-parser.js';
import { buildGraph, detectCycle } from './lib/Graph.js';
import { gitSpawn } from './lib/git-utils.js';
import { TYPE_LABELS } from './lib/label-constants.js';
import { Logger } from './lib/Logger.js';
import { createProvider } from './lib/provider-factory.js';

const progress = Logger.createProgress('plan-healthcheck', { stderr: true });

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1: Validate ticket hierarchy and dependency graph.
 * Fetches all child tickets under the Epic and verifies structure.
 */
async function checkTickets(provider, epicId) {
  const findings = [];

  let tickets;
  try {
    tickets = await provider.getSubTickets(epicId);
  } catch (err) {
    findings.push({
      level: 'error',
      msg: `Could not fetch Epic #${epicId} tickets: ${err.message}`,
    });
    return findings;
  }

  if (tickets.length === 0) {
    findings.push({
      level: 'error',
      msg: `Epic #${epicId} has no child tickets.`,
    });
    return findings;
  }

  const features = tickets.filter((t) =>
    t.labels.includes(TYPE_LABELS.FEATURE),
  );
  const stories = tickets.filter((t) => t.labels.includes(TYPE_LABELS.STORY));
  const tasks = tickets.filter((t) => t.labels.includes(TYPE_LABELS.TASK));

  if (features.length === 0)
    findings.push({ level: 'error', msg: 'No type::feature tickets found.' });
  if (stories.length === 0)
    findings.push({ level: 'error', msg: 'No type::story tickets found.' });
  if (tasks.length === 0)
    findings.push({ level: 'error', msg: 'No type::task tickets found.' });

  // Check for stories missing complexity labels
  const missingComplexity = stories.filter(
    (s) => !s.labels.some((l) => l.startsWith('complexity::')),
  );
  if (missingComplexity.length > 0) {
    findings.push({
      level: 'warn',
      msg: `${missingComplexity.length} story/stories missing complexity label: ${missingComplexity.map((s) => `#${s.id}`).join(', ')}`,
    });
  }

  // Check for dependency cycles across tasks
  if (tasks.length > 1) {
    const graphTasks = tasks.map((t) => ({
      ...t,
      dependsOn: parseBlockedBy(t.body ?? '').filter((dep) =>
        tasks.some((tt) => tt.id === dep),
      ),
    }));
    const { adjacency } = buildGraph(graphTasks);
    const cycle = detectCycle(adjacency);
    if (cycle) {
      findings.push({
        level: 'error',
        msg: `Dependency cycle detected: #${cycle.join(' -> #')}`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      level: 'ok',
      msg: `${features.length} features, ${stories.length} stories, ${tasks.length} tasks — hierarchy valid, no cycles.`,
    });
  }

  return findings;
}

/**
 * Check 2: Verify git remote is reachable and baseBranch exists.
 */
function checkGitRemote(baseBranch, cwd) {
  const findings = [];

  const remote = gitSpawn(
    cwd,
    'ls-remote',
    '--exit-code',
    'origin',
    baseBranch,
  );
  if (remote.status !== 0) {
    if (
      remote.stderr.includes('Could not resolve host') ||
      remote.stderr.includes('unable to access')
    ) {
      findings.push({
        level: 'error',
        msg: `Git remote 'origin' is not reachable: ${remote.stderr.slice(0, 200)}`,
      });
    } else {
      findings.push({
        level: 'error',
        msg: `Base branch '${baseBranch}' not found on origin.`,
      });
    }
  } else {
    findings.push({
      level: 'ok',
      msg: `Remote reachable, base branch '${baseBranch}' exists.`,
    });
  }

  return findings;
}

/**
 * Check 3: Validate .agentrc.json orchestration config.
 */
function checkConfig(orchestration) {
  const findings = [];
  try {
    validateOrchestrationConfig(orchestration);
    findings.push({ level: 'ok', msg: 'Orchestration config is valid.' });
  } catch (err) {
    findings.push({
      level: 'error',
      msg: `Config validation failed: ${err.message}`,
    });
  }
  return findings;
}

/**
 * Check 4: Prime pnpm store if using pnpm-store strategy.
 * Runs `pnpm install --frozen-lockfile` in the project root so the global
 * content-addressable store is populated before any worktree needs it.
 */
function primePnpmStore(cwd, dryRun) {
  const findings = [];
  const lockFile = path.join(cwd, 'pnpm-lock.yaml');

  if (!fs.existsSync(lockFile)) {
    findings.push({
      level: 'warn',
      msg: 'No pnpm-lock.yaml found — cannot prime store.',
    });
    return findings;
  }

  if (dryRun) {
    findings.push({ level: 'ok', msg: 'pnpm store prime skipped (dry-run).' });
    return findings;
  }

  progress('PRIME', 'Priming pnpm content-addressable store...');
  const start = Date.now();
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    timeout: 300_000,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status === 0) {
    findings.push({ level: 'ok', msg: `pnpm store primed in ${elapsed}s.` });
  } else {
    const reason =
      result.signal === 'SIGTERM'
        ? `timeout after ${elapsed}s`
        : `exit ${result.status}`;
    findings.push({
      level: 'warn',
      msg: `pnpm store prime failed (${reason}). First worktree install will be slower. stderr: ${(result.stderr ?? '').slice(0, 300)}`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runPlanHealthcheck({
  epicId: epicIdParam,
  dryRun: dryRunParam,
  injectedProvider,
  injectedConfig,
} = {}) {
  const parsed =
    epicIdParam !== undefined
      ? { epicId: epicIdParam, dryRun: !!dryRunParam }
      : parseSprintArgs();
  const { epicId, dryRun } = parsed;
  const cwd = PROJECT_ROOT;

  if (!epicId) {
    Logger.fatal(
      'Usage: node sprint-plan-healthcheck.js --epic <EPIC_ID> [--dry-run]',
    );
  }

  const { settings, orchestration } = injectedConfig || resolveConfig();
  const baseBranch = settings.baseBranch ?? 'main';
  const wtConfig = orchestration?.worktreeIsolation;
  const isPnpmStore =
    wtConfig?.enabled && wtConfig?.nodeModulesStrategy === 'pnpm-store';

  progress('HEALTH', `Running post-plan health check for Epic #${epicId}...`);

  // Run independent checks
  const allFindings = [];

  // Config check (no provider needed)
  progress('CHECK', 'Validating orchestration config...');
  allFindings.push(
    ...checkConfig(orchestration).map((f) => ({ ...f, check: 'config' })),
  );

  // Git remote check (no provider needed)
  progress('CHECK', 'Checking git remote...');
  allFindings.push(
    ...checkGitRemote(baseBranch, cwd).map((f) => ({ ...f, check: 'git' })),
  );

  // Ticket hierarchy check
  const provider = injectedProvider || createProvider(orchestration);
  progress('CHECK', 'Validating ticket hierarchy...');
  const ticketFindings = await checkTickets(provider, epicId);
  allFindings.push(...ticketFindings.map((f) => ({ ...f, check: 'tickets' })));

  // pnpm store prime (only if configured)
  if (isPnpmStore) {
    progress('CHECK', 'Priming pnpm store...');
    allFindings.push(
      ...primePnpmStore(cwd, dryRun).map((f) => ({
        ...f,
        check: 'pnpm-store',
      })),
    );
  }

  // Emit summary
  const errors = allFindings.filter((f) => f.level === 'error');
  const warnings = allFindings.filter((f) => f.level === 'warn');
  const oks = allFindings.filter((f) => f.level === 'ok');

  console.log('\n--- PLAN HEALTH CHECK ---');
  for (const f of allFindings) {
    const icon =
      f.level === 'ok' ? '  OK' : f.level === 'warn' ? 'WARN' : ' ERR';
    console.log(`  [${icon}] ${f.check}: ${f.msg}`);
  }

  const summary = [];
  if (oks.length > 0) summary.push(`${oks.length} passed`);
  if (warnings.length > 0) summary.push(`${warnings.length} warning(s)`);
  if (errors.length > 0) summary.push(`${errors.length} error(s)`);
  console.log(`\n  Summary: ${summary.join(', ')}`);
  console.log('--- END HEALTH CHECK ---\n');

  if (errors.length > 0) {
    progress(
      'HEALTH',
      `${errors.length} issue(s) found. Review before starting execution.`,
    );
  } else if (warnings.length > 0) {
    progress(
      'HEALTH',
      `Plan is ready with ${warnings.length} advisory warning(s).`,
    );
  } else {
    progress('HEALTH', 'All checks passed. Plan is ready for execution.');
  }

  return {
    epicId,
    findings: allFindings,
    errors: errors.length,
    warnings: warnings.length,
  };
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

runAsCli(import.meta.url, runPlanHealthcheck, {
  source: 'sprint-plan-healthcheck',
});
