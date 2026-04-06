import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { VerboseLogger } from './lib/VerboseLogger.js';
import { postStructuredComment } from './update-ticket-state.js';

/**
 * sprint-integrate.js — Epic Integration Candidate Verification
 *
 * Consolidates the entire per-task integration loop (Steps 4a-4e of
 * sprint-integration.md) into a single deterministic script.
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
// Parse CLI arguments
// ---------------------------------------------------------------------------
let epicId = null;
let taskId = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--epic') {
    const next = process.argv[++i];
    if (!next || next.startsWith('--')) {
      Logger.fatal('--epic requires a value.');
    }
    epicId = next;
  } else if (process.argv[i] === '--task') {
    const next = process.argv[++i];
    if (!next || next.startsWith('--')) {
      Logger.fatal('--task requires a value.');
    }
    taskId = next;
  }
}

if (!epicId || !taskId) {
  Logger.fatal('Usage: node sprint-integrate.js --epic <EPIC_ID> --task <TASK_ID>');
}

// ---------------------------------------------------------------------------
// Resolve configuration
// ---------------------------------------------------------------------------
const { settings } = resolveConfig();
const epicBranch = `epic/${epicId}`;
const featureBranch = `task/epic-${epicId}/${taskId}`;
const candidateBranch = `integration-candidate-epic-${epicId}-${taskId}`;
const typecheckCmd = settings.typecheckCommand ?? 'npm run typecheck';
const testCmd = settings.testCommand ?? 'npm run test';
const scriptsRoot = settings.scriptsRoot ?? '.agents/scripts';
const executionTimeoutMs = settings.executionTimeoutMs ?? 300000;

// Initialize verbose logging for the integration session
const vlog = VerboseLogger.init(settings, PROJECT_ROOT, {
  epicId,
  taskId,
  source: 'sprint-integrate',
});

vlog.info('integration', `Starting candidate verification for ${featureBranch}`, {
  epicBranch,
  featureBranch,
  candidateBranch,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a git command, return { status, stdout, stderr }. */
function git(...args) {
  const result = spawnSync('git', args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

/** Log progress to stdout so the agent and operator can track state. */
function progress(phase, message) {
  console.log(`▶ [sprint-integrate] [epic-${epicId}/#${taskId}] ${phase}: ${message}`);
}

/**
 * Log friction — posts a structured comment to the Task ticket AND logs
 * to console. In v5, GitHub is the SSOT; no local log file is written.
 */
async function logFriction(message) {
  console.error(`⚠️ [sprint-integrate] Friction for Task #${taskId}: ${message}`);
  try {
    await postStructuredComment(parseInt(taskId, 10), 'friction', message);
  } catch (err) {
    // Non-fatal: integration failure is the primary signal
    console.error(`⚠️ Failed to post friction comment: ${err.message}`);
  }
}

/** Safely clean up the candidate branch and return to Epic base. */
function cleanup() {
  git('merge', '--abort');  // No-op if no merge in progress
  git('checkout', epicBranch);
  git('branch', '-D', candidateBranch);
}

/** Count conflict markers using git's built-in check (binary-safe). */
function analyzeConflicts() {
  // Check for unmerged paths
  const unmerged = git('diff', '--name-only', '--diff-filter=U');
  if (!unmerged.stdout) return { files: 0, lines: 0, fileList: [] };

  const conflictFiles = unmerged.stdout.split('\n').filter(Boolean);

  // Use git diff --check to count conflict markers without reading files directly.
  // This is binary-safe and avoids loading large files into memory.
  const check = git('diff', '--check');
  const markerMatches = check.stdout.match(/leftover conflict marker/g);
  const totalLines = markerMatches ? markerMatches.length : 0;

  return { files: conflictFiles.length, lines: totalLines, fileList: conflictFiles };
}

// ---------------------------------------------------------------------------
// Main Integration Flow
// ---------------------------------------------------------------------------

progress('INIT', `Starting candidate verification for ${featureBranch}`);

// 1. Ensure we start from the Epic base branch
const currentBranch = git('branch', '--show-current');
if (currentBranch.stdout !== epicBranch) {
  progress('CHECKOUT', `Switching to ${epicBranch}`);
  const checkout = git('checkout', epicBranch);
  if (checkout.status !== 0) {
    Logger.fatal(`Failed to checkout ${epicBranch}: ${checkout.stderr}`);
  }
}

// 2. Create ephemeral candidate branch from Epic base
progress('CANDIDATE', `Creating ${candidateBranch} from ${epicBranch}`);
const createCandidate = git('checkout', '-b', candidateBranch, epicBranch);
if (createCandidate.status !== 0) {
  // If branch already exists, clean it up and try again
  git('branch', '-D', candidateBranch);
  const retry = git('checkout', '-b', candidateBranch, epicBranch);
  if (retry.status !== 0) {
    Logger.fatal(`Failed to create candidate branch: ${retry.stderr}`);
  }
}

// 3. Verify feature branch exists, then merge into candidate
const refCheck = git('rev-parse', '--verify', featureBranch);
if (refCheck.status !== 0) {
  Logger.fatal(`Feature branch "${featureBranch}" does not exist. Verify the task ID.`);
}

progress('MERGE', `Merging ${featureBranch} into candidate`);
const merge = git('merge', '--no-ff', featureBranch);

if (merge.status !== 0) {
  // Merge conflict — analyze severity
  const conflicts = analyzeConflicts();
  progress('CONFLICT', `${conflicts.files} file(s), ~${conflicts.lines} conflict markers`);
  vlog.warn('integration', `Merge conflict detected`, {
    files: conflicts.files,
    lines: conflicts.lines,
    fileList: conflicts.fileList,
  });

  if (conflicts.files >= 3 || conflicts.lines >= 20) {
    // Major conflict — exit 2, requires human
    console.error(`\n🚨 MAJOR CONFLICT: ${conflicts.files} file(s) with ${conflicts.lines}+ conflicting lines.`);
    console.error(`   Files: ${conflicts.fileList.join(', ')}`);
    console.error(`   Branches: ${epicBranch} ← ${featureBranch}`);
    await logFriction(`Major merge conflict: ${conflicts.files} files, ${conflicts.lines} lines. Files: ${conflicts.fileList.join(', ')}`);
    git('merge', '--abort');
    cleanup();
    process.exit(2);
  }

  // Minor conflict — attempt auto-resolution (accept theirs for minor conflicts)
  progress('AUTO-RESOLVE', `Attempting auto-resolution of minor conflicts`);
  // Accept theirs for minor conflicts (feature branch has the intended changes)
  for (const file of conflicts.fileList) {
    // Log what the sprint-base version contained so discarded changes are auditable
    const ourVersion = git('show', `:2:${file}`);
    if (ourVersion.stdout) {
      vlog.warn('integration', `Auto-resolving "${file}" to theirs — discarding base version`, {
        file,
        discardedPreview: ourVersion.stdout.substring(0, 500),
      });
    }
    git('checkout', '--theirs', file);
    git('add', file);
  }
  const commitResolve = git('commit', '--no-edit');
  if (commitResolve.status !== 0) {
    await logFriction(`Auto-resolution failed for Task #${taskId}: ${commitResolve.stderr}`);
    git('merge', '--abort');
    cleanup();
    process.exit(1);
  }
  progress('AUTO-RESOLVE', `Minor conflicts resolved successfully`);
}

// 4. Run verification suite — three sequential steps, no shell interpolation
const lintBaselineScript = path.join(PROJECT_ROOT, scriptsRoot, 'lint-baseline.js');
const diagScript = path.join(PROJECT_ROOT, scriptsRoot, 'diagnose-friction.js');

const verifySteps = [
  { label: 'lint-baseline', args: ['node', lintBaselineScript, 'check'] },
  { label: 'typecheck',     args: typecheckCmd.split(' ') },
  { label: 'test',          args: testCmd.split(' ') },
];

for (const step of verifySteps) {
  progress('VERIFY', `Running ${step.label}: ${step.args.join(' ')}`);

  // Route through diagnose-friction for telemetry; pass epicId as task context
  const result = spawnSync(
    'node',
    [diagScript, '--task', taskId, '--cmd', ...step.args],
    {
      stdio: 'inherit',
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      timeout: executionTimeoutMs,
    }
  );

  if (result.status !== 0) {
    progress('FAIL', `${step.label} failed for Task #${taskId}. Blast-radius contained.`);
    vlog.error('integration', `Post-merge verification failed at ${step.label}`, {
      taskId,
      epicId,
      step: step.label,
      exitCode: result.status,
    });
    await logFriction(
      `Task #${taskId} failed post-merge integration check at "${step.label}". ` +
      `Blast-radius contained. Rework triggered via /sprint-hotfix.`,
    );
    cleanup();
    process.exit(1);
  }
}

// 5. Build Green — consolidate candidate into Epic base
progress('CONSOLIDATE', `Merging ${candidateBranch} into ${epicBranch}`);
const coResult = git('checkout', epicBranch);
if (coResult.status !== 0) {
  await logFriction(`Failed to checkout ${epicBranch} for consolidation: ${coResult.stderr}`);
  cleanup();
  process.exit(1);
}
const consolidate = git('merge', '--no-ff', candidateBranch);
if (consolidate.status !== 0) {
  await logFriction(`Failed to consolidate ${candidateBranch}: ${consolidate.stderr}`);
  cleanup();
  process.exit(1);
}
git('branch', '-D', candidateBranch);

progress('DONE', `✅ Task #${taskId} successfully integrated into ${epicBranch}`);
vlog.info('integration', `Task successfully integrated`, {
  taskId,
  epicId,
  epicBranch,
});

// Post a structured progress comment on the Task ticket (non-fatal)
try {
  await postStructuredComment(
    parseInt(taskId, 10),
    'progress',
    `Branch \`${featureBranch}\` integrated into \`${epicBranch}\` successfully.`,
  );
} catch (err) {
  console.warn(`[sprint-integrate] Failed to post integration comment: ${err.message}`);
}

process.exit(0);
