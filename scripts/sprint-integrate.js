import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { VerboseLogger } from './lib/VerboseLogger.js';

/**
 * sprint-integrate.js — Batch Integration Candidate Verification
 *
 * Consolidates the entire per-branch integration loop (Steps 4a-4e of
 * sprint-integration.md) into a single deterministic script. This eliminates
 * the ~8 separate CLI commands per branch that previously required individual
 * agent tool-call approvals.
 *
 * Exit codes:
 *   0 — Build Green: candidate merged into sprint base successfully.
 *   1 — Build Broken: blast-radius contained, friction logged.
 *   2 — Major Conflict: requires human intervention.
 *
 * Usage:
 *   node .agents/scripts/sprint-integrate.js --sprint <NUM> --task <TASK_ID>
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
let sprintNum = null;
let taskId = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--sprint') {
    const next = process.argv[++i];
    if (!next || next.startsWith('--')) {
      Logger.fatal('--sprint requires a value.');
    }
    sprintNum = next;
  } else if (process.argv[i] === '--task') {
    const next = process.argv[++i];
    if (!next || next.startsWith('--')) {
      Logger.fatal('--task requires a value.');
    }
    taskId = next;
  }
}

if (!sprintNum || !taskId) {
  Logger.fatal('Usage: node sprint-integrate.js --sprint <SPRINT_NUMBER> --task <TASK_ID>');
}

// ---------------------------------------------------------------------------
// Resolve configuration
// ---------------------------------------------------------------------------
const { settings } = resolveConfig();
const padding = settings.sprintNumberPadding ?? 3;
const paddedNum = String(sprintNum).padStart(padding, '0');
const sprintBranch = `sprint-${paddedNum}`;
const featureBranch = `task/${sprintBranch}/${taskId}`;
const candidateBranch = `integration-candidate-${taskId}`;
const sprintDocsRoot = settings.sprintDocsRoot ?? 'docs/sprints';
const sprintRoot = path.join(sprintDocsRoot, `sprint-${paddedNum}`);
const typecheckCmd = settings.typecheckCommand ?? 'npm run typecheck';
const testCmd = settings.testCommand ?? 'npm run test';
const scriptsRoot = settings.scriptsRoot ?? '.agents/scripts';
const executionTimeoutMs = settings.executionTimeoutMs ?? 300000;

// Initialize verbose logging for the integration session
const vlog = VerboseLogger.init(settings, PROJECT_ROOT, {
  sprint: paddedNum,
  taskId,
  source: 'sprint-integrate',
});

vlog.info('integration', `Starting candidate verification for ${featureBranch}`, {
  sprintBranch,
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
  console.log(`▶ [sprint-integrate] [${taskId}] ${phase}: ${message}`);
}

/** Log friction to the sprint's agent-friction-log.json */
function logFriction(message) {
  const logPath = path.join(PROJECT_ROOT, sprintRoot, 'agent-friction-log.json');
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'friction_point',
    tool: 'sprint-integrate.js',
    task: taskId,
    error: message,
  };
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`⚠️ Failed to write friction log: ${err.message}`);
  }
}

/** Safely clean up the candidate branch and return to sprint base. */
function cleanup() {
  git('merge', '--abort');  // No-op if no merge in progress
  git('checkout', sprintBranch);
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

// 1. Ensure we start from the sprint base
const currentBranch = git('branch', '--show-current');
if (currentBranch.stdout !== sprintBranch) {
  progress('CHECKOUT', `Switching to ${sprintBranch}`);
  const checkout = git('checkout', sprintBranch);
  if (checkout.status !== 0) {
    Logger.fatal(`Failed to checkout ${sprintBranch}: ${checkout.stderr}`);
  }
}

// 2. Create ephemeral candidate branch
progress('CANDIDATE', `Creating ${candidateBranch} from ${sprintBranch}`);
const createCandidate = git('checkout', '-b', candidateBranch, sprintBranch);
if (createCandidate.status !== 0) {
  // If branch already exists, clean it up and try again
  git('branch', '-D', candidateBranch);
  const retry = git('checkout', '-b', candidateBranch, sprintBranch);
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
    console.error(`   Branches: ${sprintBranch} ← ${featureBranch}`);
    logFriction(`Major merge conflict: ${conflicts.files} files, ${conflicts.lines} lines. Files: ${conflicts.fileList.join(', ')}`);
    git('merge', '--abort');
    cleanup();
    process.exit(2);
  }

  // Minor conflict — attempt auto-resolution
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
    logFriction(`Auto-resolution failed for ${taskId}: ${commitResolve.stderr}`);
    git('merge', '--abort');
    cleanup();
    process.exit(1);
  }
  progress('AUTO-RESOLVE', `Minor conflicts resolved successfully`);
}

// 4. Run verification suite — three sequential steps, no shell interpolation
const lintBaselineScript = path.join(PROJECT_ROOT, scriptsRoot, 'lint-baseline.js');
const diagScript = path.join(PROJECT_ROOT, scriptsRoot, 'diagnose-friction.js');
const anchoredSprintRoot = path.join(PROJECT_ROOT, sprintRoot);

const verifySteps = [
  { label: 'lint-baseline', args: ['node', lintBaselineScript, 'check'] },
  { label: 'typecheck',     args: typecheckCmd.split(' ') },
  { label: 'test',          args: testCmd.split(' ') },
];

for (const step of verifySteps) {
  progress('VERIFY', `Running ${step.label}: ${step.args.join(' ')}`);

  // Route through diagnose-friction for telemetry capture
  const result = spawnSync(
    'node',
    [diagScript, '--sprint', anchoredSprintRoot, '--task', taskId, '--cmd', ...step.args],
    {
      stdio: 'inherit',
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      timeout: executionTimeoutMs,
    }
  );

  if (result.status !== 0) {
    progress('FAIL', `${step.label} failed for ${taskId}. Blast-radius contained.`);
    vlog.error('integration', `Post-merge verification failed at ${step.label}`, {
      taskId,
      step: step.label,
      exitCode: result.status,
    });
    logFriction(
      `${taskId} failed post-merge integration check at ${step.label}. ` +
      `Blast-radius contained. Rework triggered via /sprint-hotfix.`,
    );
    cleanup();
    process.exit(1);
  }
}

// 5. Build Green — consolidate candidate into sprint base
progress('CONSOLIDATE', `Merging ${candidateBranch} into ${sprintBranch}`);
const coResult = git('checkout', sprintBranch);
if (coResult.status !== 0) {
  logFriction(`Failed to checkout ${sprintBranch} for consolidation: ${coResult.stderr}`);
  cleanup();
  process.exit(1);
}
const consolidate = git('merge', '--no-ff', candidateBranch);
if (consolidate.status !== 0) {
  logFriction(`Failed to consolidate ${candidateBranch}: ${consolidate.stderr}`);
  cleanup();
  process.exit(1);
}
git('branch', '-D', candidateBranch);

progress('DONE', `✅ ${taskId} successfully integrated into ${sprintBranch}`);
vlog.info('integration', `Task successfully integrated`, {
  taskId,
  sprintBranch,
});
process.exit(0);
