/**
 * git-merge-orchestrator.js — Ephemeral Candidate Branch Merge Logic
 *
 * Encapsulates the complete merge-and-conflict-resolution lifecycle for
 * a single Task integration candidate. Extracted from sprint-integrate.js
 * to satisfy SRP: the orchestrator owns only Git state transitions.
 *
 * Responsibilities:
 *   - Create and tear down the ephemeral candidate branch.
 *   - Detect and triage merge conflicts (major vs minor threshold).
 *   - Auto-resolve minor conflicts (accept theirs) with audit logging.
 */

import { gitSpawn } from './git-utils.js';

/** Thresholds for escalating a conflict to "major" (requires human). */
const MAJOR_CONFLICT_FILES = 3;
const MAJOR_CONFLICT_LINES = 20;

/**
 * Analyse conflict severity using git's binary-safe diff --check.
 *
 * @param {string} cwd - Project root.
 * @returns {{ files: number, lines: number, fileList: string[] }}
 */
function analyzeConflicts(cwd) {
  const unmerged = gitSpawn(cwd, 'diff', '--name-only', '--diff-filter=U');
  if (!unmerged.stdout) return { files: 0, lines: 0, fileList: [] };

  const fileList = unmerged.stdout.split('\n').filter(Boolean);
  const check = gitSpawn(cwd, 'diff', '--check');
  const markerMatches = check.stdout.match(/leftover conflict marker/g);

  return { files: fileList.length, lines: markerMatches ? markerMatches.length : 0, fileList };
}

/**
 * Create (or recreate) an ephemeral candidate branch from the epic base.
 *
 * @param {string} cwd             - Project root.
 * @param {string} epicBranch      - Name of the Epic base branch.
 * @param {string} candidateBranch - Name of the ephemeral candidate branch.
 * @throws {Error} If branch creation fails after one retry.
 */
export function createCandidateBranch(cwd, epicBranch, candidateBranch) {
  let result = gitSpawn(cwd, 'checkout', '-b', candidateBranch, epicBranch);
  if (result.status !== 0) {
    // Branch may already exist from a previous aborted run — clean it up.
    gitSpawn(cwd, 'branch', '-D', candidateBranch);
    result = gitSpawn(cwd, 'checkout', '-b', candidateBranch, epicBranch);
    if (result.status !== 0) {
      throw new Error(`Failed to create candidate branch "${candidateBranch}": ${result.stderr}`);
    }
  }
}

/**
 * Merge the feature branch into the current (candidate) branch.
 * Handles conflict triage and auto-resolution.
 *
 * @param {string}   cwd           - Project root.
 * @param {string}   featureBranch - Branch name to merge in.
 * @param {Function} vlog          - VerboseLogger-compatible `warn` helper.
 * @returns {{ merged: true } | { merged: false, major: true } | never}
 *   Returns `{ merged: true }` on clean merge or resolved minor conflicts.
 *   Returns `{ merged: false, major: true }` on major conflict (caller should exit 2).
 *   Throws on internal git errors.
 */
export function mergeFeatureBranch(cwd, featureBranch, vlog) {
  const merge = gitSpawn(cwd, 'merge', '--no-ff', featureBranch);
  if (merge.status === 0) return { merged: true };

  const conflicts = analyzeConflicts(cwd);

  vlog('warn', 'integration', 'Merge conflict detected', {
    files: conflicts.files,
    lines: conflicts.lines,
    fileList: conflicts.fileList,
  });

  if (conflicts.files >= MAJOR_CONFLICT_FILES || conflicts.lines >= MAJOR_CONFLICT_LINES) {
    gitSpawn(cwd, 'merge', '--abort');
    return { merged: false, major: true, conflicts };
  }

  // Minor conflict — auto-resolve by accepting the feature branch version.
  for (const file of conflicts.fileList) {
    const ourVersion = gitSpawn(cwd, 'show', `:2:${file}`);
    if (ourVersion.stdout) {
      vlog('warn', 'integration', `Auto-resolving "${file}" to theirs — discarding base version`, {
        file,
        discardedPreview: ourVersion.stdout.substring(0, 500),
      });
    }
    gitSpawn(cwd, 'checkout', '--theirs', file);
    gitSpawn(cwd, 'add', file);
  }

  const commitResult = gitSpawn(cwd, 'commit', '--no-edit');
  if (commitResult.status !== 0) {
    throw new Error(`Auto-resolution commit failed: ${commitResult.stderr}`);
  }

  return { merged: true, autoResolved: true, conflicts };
}

/**
 * Delete the ephemeral candidate branch and return to the Epic base branch.
 * Best-effort: git errors are swallowed to avoid masking the primary failure.
 *
 * @param {string} cwd             - Project root.
 * @param {string} epicBranch      - Epic base branch to return to.
 * @param {string} candidateBranch - Ephemeral branch to delete.
 */
export function cleanupCandidateBranch(cwd, epicBranch, candidateBranch) {
  gitSpawn(cwd, 'merge', '--abort');   // no-op if no merge in progress
  gitSpawn(cwd, 'checkout', epicBranch);
  gitSpawn(cwd, 'branch', '-D', candidateBranch);
}

/**
 * Consolidate an accepted candidate branch into the Epic base branch.
 *
 * @param {string} cwd             - Project root.
 * @param {string} epicBranch      - Target (Epic base) branch.
 * @param {string} candidateBranch - Candidate branch to fast-forward merge.
 * @throws {Error} If checkout or merge fails.
 */
export function consolidateCandidate(cwd, epicBranch, candidateBranch) {
  const co = gitSpawn(cwd, 'checkout', epicBranch);
  if (co.status !== 0) {
    throw new Error(`Failed to checkout "${epicBranch}" for consolidation: ${co.stderr}`);
  }

  const merge = gitSpawn(cwd, 'merge', '--no-ff', candidateBranch);
  if (merge.status !== 0) {
    throw new Error(`Failed to consolidate "${candidateBranch}" into "${epicBranch}": ${merge.stderr}`);
  }

  gitSpawn(cwd, 'branch', '-D', candidateBranch);
}
