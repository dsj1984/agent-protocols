import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import {
  cleanupCandidateBranch,
  consolidateCandidate,
  createCandidateBranch,
  mergeFeatureBranch,
} from './lib/git-merge-orchestrator.js';
import {
  getEpicBranch,
  getIntegrationCandidateBranch,
  getStoryBranch,
  getTaskBranch,
  gitSpawn,
  resolveBranchForTask,
} from './lib/git-utils.js';
import {
  runVerificationSuite,
  VerificationError,
} from './lib/integration-verifier.js';
import { Logger } from './lib/Logger.js';
import { VerboseLogger } from './lib/VerboseLogger.js';
import { getProvider, postStructuredComment } from './update-ticket-state.js';

/**
 * Extracts parent ID from ticket body using the `parent: #N` convention.
 * @param {string} body
 * @returns {number|null}
 */
function parseParentId(body) {
  const match = (body ?? '').match(/^parent:\s*#(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * sprint-integrate.js — Epic Integration Candidate Verification
 *
 * Consolidates the entire per-task integration loop (Steps 4a-4e of
 * sprint-integration.md) into a single deterministic script.
 *
 * Orchestration responsibilities only — Git merge logic lives in
 * lib/git-merge-orchestrator.js, and verification logic lives in
 * lib/integration-verifier.js.
 *
 * Exit codes:
 *   0 — Build Green: candidate merged into Epic base successfully.
 *   1 — Build Broken: blast-radius contained, friction logged.
 *   2 — Major Conflict: requires human intervention.
 *
 * Usage:
 *   node .agents/scripts/sprint-integrate.js --epic <EPIC_ID> --task <TASK_ID>
 *
 * @see docs/v5-implementation-plan.md Sprint 3E
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Parse CLI arguments (node:util parseArgs — consistent with other scripts)
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    epic: { type: 'string' },
    task: { type: 'string' },
  },
  strict: false,
});

const epicId = values.epic;
const taskId = values.task;

if (!epicId || !taskId) {
  Logger.fatal(
    'Usage: node sprint-integrate.js --epic <EPIC_ID> --task <TASK_ID>',
  );
}

// ---------------------------------------------------------------------------
// Resolve configuration
// ---------------------------------------------------------------------------

const { settings } = resolveConfig();
const provider = getProvider();

const epicBranch = getEpicBranch(epicId);
const featureBranch = await resolveBranchForTask(
  epicId,
  parseInt(taskId, 10),
  provider,
);
const candidateBranch = getIntegrationCandidateBranch(epicId, taskId);
const typecheckCmd = settings.typecheckCommand ?? 'npm run typecheck';
const testCmd = settings.testCommand ?? 'npm run test';
const scriptsRoot = settings.scriptsRoot ?? '.agents/scripts';
const timeoutMs = settings.executionTimeoutMs ?? 300_000;

// Initialize verbose logging for the integration session.
const vlog = VerboseLogger.init(settings, PROJECT_ROOT, {
  epicId,
  taskId,
  source: 'sprint-integrate',
});

vlog.info(
  'integration',
  `Starting candidate verification for ${featureBranch}`,
  {
    epicBranch,
    featureBranch,
    candidateBranch,
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Log progress to stdout so the agent and operator can track state. */
function progress(phase, message) {
  console.log(
    `▶ [sprint-integrate] [epic-${epicId}/#${taskId}] ${phase}: ${message}`,
  );
}

/**
 * Log friction — posts a structured comment to the Task ticket AND logs to
 * console. In v5, GitHub is the SSOT; no local log file is written.
 *
 * @param {string} message
 */
async function logFriction(message) {
  console.error(
    `⚠️ [sprint-integrate] Friction for Task #${taskId}: ${message}`,
  );
  try {
    await postStructuredComment(parseInt(taskId, 10), 'friction', message);
  } catch (err) {
    // Non-fatal: the integration failure is the primary signal.
    console.error(`⚠️ Failed to post friction comment: ${err.message}`);
  }
}

// VerboseLogger shim that matches the signature expected by git-merge-orchestrator.
function vlogShim(level, category, message, meta) {
  vlog[level]?.(category, message, meta);
}

// ---------------------------------------------------------------------------
// Main Integration Flow
// ---------------------------------------------------------------------------

progress('INIT', `Starting candidate verification for ${featureBranch}`);

// 1. Ensure we start from the Epic base branch.
const currentBranch = gitSpawn(PROJECT_ROOT, 'branch', '--show-current');
if (currentBranch.stdout !== epicBranch) {
  progress('CHECKOUT', `Switching to ${epicBranch}`);
  const checkout = gitSpawn(PROJECT_ROOT, 'checkout', epicBranch);
  if (checkout.status !== 0) {
    Logger.fatal(`Failed to checkout ${epicBranch}: ${checkout.stderr}`);
  }
}

// 2. Verify feature branch exists before attempting merge.
const refCheck = gitSpawn(PROJECT_ROOT, 'rev-parse', '--verify', featureBranch);
if (refCheck.status !== 0) {
  Logger.fatal(
    `Feature branch "${featureBranch}" does not exist. Verify the task ID.`,
  );
}

// 3. Create ephemeral candidate branch from Epic base.
progress('CANDIDATE', `Creating ${candidateBranch} from ${epicBranch}`);
try {
  createCandidateBranch(PROJECT_ROOT, epicBranch, candidateBranch);
} catch (err) {
  Logger.fatal(err.message);
}

// 4. Merge feature branch into candidate (with conflict triage).
progress('MERGE', `Merging ${featureBranch} into candidate`);
let mergeResult;
try {
  mergeResult = mergeFeatureBranch(PROJECT_ROOT, featureBranch, vlogShim);
} catch (err) {
  await logFriction(
    `Auto-resolution failed for Task #${taskId}: ${err.message}`,
  );
  cleanupCandidateBranch(PROJECT_ROOT, epicBranch, candidateBranch);
  process.exit(1);
}

if (!mergeResult.merged) {
  // Major conflict — requires human intervention.
  const { conflicts } = mergeResult;
  console.error(
    `\n🚨 MAJOR CONFLICT: ${conflicts.files} file(s) with ${conflicts.lines}+ conflicting lines.`,
  );
  console.error(`   Files: ${conflicts.fileList.join(', ')}`);
  console.error(`   Branches: ${epicBranch} ← ${featureBranch}`);
  await logFriction(
    `Major merge conflict: ${conflicts.files} files, ${conflicts.lines} lines. ` +
      `Files: ${conflicts.fileList.join(', ')}`,
  );
  cleanupCandidateBranch(PROJECT_ROOT, epicBranch, candidateBranch);
  process.exit(2);
}

if (mergeResult.autoResolved) {
  progress('AUTO-RESOLVE', `Minor conflicts resolved successfully`);
}

// 5. Run post-merge verification suite.
try {
  runVerificationSuite({
    cwd: PROJECT_ROOT,
    scriptsRoot,
    taskId,
    typecheckCmd,
    testCmd,
    timeoutMs,
    onProgress: progress,
  });
} catch (err) {
  if (err instanceof VerificationError) {
    progress(
      'FAIL',
      `${err.stepLabel} failed for Task #${taskId}. Blast-radius contained.`,
    );
    vlog.error(
      'integration',
      `Post-merge verification failed at ${err.stepLabel}`,
      {
        taskId,
        epicId,
        step: err.stepLabel,
        exitCode: err.exitCode,
      },
    );
    await logFriction(
      `Task #${taskId} failed post-merge integration check at "${err.stepLabel}". ` +
        `Blast-radius contained. Rework triggered via /sprint-hotfix.`,
    );
    cleanupCandidateBranch(PROJECT_ROOT, epicBranch, candidateBranch);
    process.exit(1);
  }
  throw err;
}

// 6. Build Green — consolidate candidate into Epic base.
progress('CONSOLIDATE', `Merging ${candidateBranch} into ${epicBranch}`);
try {
  consolidateCandidate(PROJECT_ROOT, epicBranch, candidateBranch);
} catch (err) {
  await logFriction(`Consolidation failed: ${err.message}`);
  cleanupCandidateBranch(PROJECT_ROOT, epicBranch, candidateBranch);
  process.exit(1);
}

progress(
  'DONE',
  `✅ Task #${taskId} successfully integrated into ${epicBranch}`,
);
vlog.info('integration', `Task successfully integrated`, {
  taskId,
  epicId,
  epicBranch,
});

// 7. PR Creation (Story-Level tracking)
try {
  const ticket = await provider.getTicket(parseInt(taskId, 10));
  const parentId = parseParentId(ticket.body);
  if (parentId) {
    progress('PR', `Ensuring PR exists for Story #${parentId}...`);
    // ITicketingProvider.createPullRequest is idempotent in our GitHub implementation
    // (it should check for existing PRs or handle the error gracefully).
    const pr = await provider.createPullRequest(featureBranch, parentId);
    progress('PR', `Story PR: ${pr.htmlUrl}`);
  }
} catch (err) {
  // Non-fatal: PR might already exist or the provider might not support it.
  console.warn(`[sprint-integrate] PR check/creation skipped: ${err.message}`);
}

// 8. Progress Comment
try {
  await postStructuredComment(
    parseInt(taskId, 10),
    'progress',
    `Branch \`${featureBranch}\` integrated into \`${epicBranch}\` successfully.`,
  );
} catch (err) {
  console.warn(
    `[sprint-integrate] Failed to post integration comment: ${err.message}`,
  );
}

process.exit(0);
