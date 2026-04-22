#!/usr/bin/env node

/**
 * delete-epic-branches.js — Local + remote branch cleanup for an Epic hierarchy.
 *
 * Encapsulates the deletion pattern that `/delete-epic-branches` previously
 * encoded as hand-authored PowerShell loops in the workflow markdown. The .md
 * is now a thin wrapper around this script — the script is the single source
 * of truth for which refs get deleted.
 *
 * Enumerates every local and remote ref matching:
 *   epic/<epicId>
 *   task/epic-<epicId>/*
 *   feature/epic-<epicId>/*
 *   story/epic-<epicId>/*
 *
 * Usage:
 *   node .agents/scripts/delete-epic-branches.js --epic <id> [--dry-run] [--json]
 *
 * Exit codes:
 *   0 — all targeted refs deleted (or nothing matched).
 *   1 — one or more deletions failed (see stderr / JSON payload).
 *   2 — usage / config error.
 */

import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT } from './lib/config-resolver.js';
import { gitSpawn } from './lib/git-utils.js';
import { Logger } from './lib/Logger.js';

function branchPatterns(epicId) {
  return [
    `epic/${epicId}`,
    `task/epic-${epicId}/*`,
    `feature/epic-${epicId}/*`,
    `story/epic-${epicId}/*`,
  ];
}

function listLocalBranches(epicId, cwd = PROJECT_ROOT) {
  const res = gitSpawn(
    cwd,
    'branch',
    '--list',
    '--format=%(refname:short)',
    ...branchPatterns(epicId),
  );
  if (res.status !== 0) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function listRemoteBranches(epicId, cwd = PROJECT_ROOT) {
  const remotePatterns = branchPatterns(epicId).map((p) => `origin/${p}`);
  const res = gitSpawn(
    cwd,
    'branch',
    '-r',
    '--list',
    '--format=%(refname:short)',
    ...remotePatterns,
  );
  if (res.status !== 0) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^origin\//, ''));
}

function deleteLocalBranch(branch, cwd = PROJECT_ROOT) {
  const res = gitSpawn(cwd, 'branch', '-D', branch);
  return { branch, ok: res.status === 0, stderr: res.stderr?.trim() };
}

function deleteRemoteBranch(branch, cwd = PROJECT_ROOT) {
  const res = gitSpawn(cwd, 'push', 'origin', '--delete', branch);
  const stderr = res.stderr?.trim() ?? '';
  // "remote ref does not exist" is idempotent success — treat as ok.
  const alreadyGone = /remote ref does not exist|does not exist/i.test(stderr);
  return {
    branch,
    ok: res.status === 0 || alreadyGone,
    alreadyGone,
    stderr,
  };
}

/**
 * Compute the deletion plan without touching git. Pure function — the CLI
 * entry point wraps this with `gitSpawn`-backed listers and deleters.
 *
 * @param {{
 *   epicId: number,
 *   localLister?: (epicId: number) => string[],
 *   remoteLister?: (epicId: number) => string[],
 * }} opts
 */
export function planDeletion({
  epicId,
  localLister = listLocalBranches,
  remoteLister = listRemoteBranches,
}) {
  const local = localLister(epicId);
  const remote = remoteLister(epicId);
  return { epicId, local, remote };
}

/**
 * Execute the deletion plan. Returns a result summary. Does not throw on
 * individual failures — aggregates them into `failures[]` and returns
 * `ok: false`.
 */
export function executeDeletion({
  plan,
  deleteLocal = deleteLocalBranch,
  deleteRemote = deleteRemoteBranch,
}) {
  const localResults = plan.local.map((b) => deleteLocal(b));
  const remoteResults = plan.remote.map((b) => deleteRemote(b));
  const failures = [
    ...localResults.filter((r) => !r.ok).map((r) => ({ ...r, scope: 'local' })),
    ...remoteResults
      .filter((r) => !r.ok)
      .map((r) => ({ ...r, scope: 'remote' })),
  ];
  return {
    epicId: plan.epicId,
    local: localResults,
    remote: remoteResults,
    failures,
    ok: failures.length === 0,
  };
}

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });
  const epicId = Number.parseInt(values.epic ?? '', 10);
  if (Number.isNaN(epicId) || epicId <= 0) {
    Logger.fatal(
      'Usage: node delete-epic-branches.js --epic <id> [--dry-run] [--json]',
    );
  }

  const plan = planDeletion({ epicId });
  const asJson = values.json === true;
  const dryRun = values['dry-run'] === true;

  if (dryRun) {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ ...plan, dryRun: true })}\n`);
      return;
    }
    console.log(
      `[delete-epic-branches] Epic #${epicId} — DRY RUN (nothing deleted)`,
    );
    console.log(
      `  Local   (${plan.local.length}): ${plan.local.join(', ') || '(none)'}`,
    );
    console.log(
      `  Remote  (${plan.remote.length}): ${plan.remote.join(', ') || '(none)'}`,
    );
    return;
  }

  const result = executeDeletion({ plan });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exit(1);
    return;
  }

  for (const r of result.local) {
    console.log(
      `[delete-epic-branches] ${r.ok ? '✅' : '❌'} local  ${r.branch}`,
    );
  }
  for (const r of result.remote) {
    const icon = r.ok ? '✅' : '❌';
    const note = r.alreadyGone ? ' (already gone)' : '';
    console.log(`[delete-epic-branches] ${icon} remote ${r.branch}${note}`);
  }

  if (!result.ok) {
    console.error(
      `[delete-epic-branches] ❌ ${result.failures.length} deletion(s) failed.`,
    );
    process.exit(1);
  }
  console.log(
    `[delete-epic-branches] ✅ Epic #${epicId} — ${result.local.length} local + ${result.remote.length} remote branch(es) deleted.`,
  );
}

runAsCli(import.meta.url, main, { source: 'delete-epic-branches' });
