/**
 * git-utils.js — Shared Git Shell Utilities
 *
 * Centralizes all Git subprocess invocations for dispatcher.js and
 * sprint-integrate.js, eliminating duplicated wrappers across the codebase.
 *
 * Two flavours are provided:
 *   gitSync(cwd, ...args)  — throws on non-zero exit; returns trimmed stdout.
 *   gitSpawn(cwd, ...args) — never throws; returns { status, stdout, stderr }.
 */

import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Run a git command synchronously, returning trimmed stdout.
 * Throws an Error if the command exits with a non-zero code.
 *
 * @param {string}   cwd  - Working directory for the git process.
 * @param {...string} args - Git sub-command and arguments.
 * @returns {string} Trimmed stdout text.
 */
export function gitSync(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  }).trim();
}

/**
 * Run a git command synchronously, returning a result object.
 * Never throws — callers must inspect `status` to detect failure.
 *
 * @param {string}   cwd  - Working directory for the git process.
 * @param {...string} args - Git sub-command and arguments.
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function gitSpawn(cwd, ...args) {
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
    shell: false,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

/**
 * Resolves the canonical branch name for an Epic.
 * v5 Standard: epic/[EPIC_ID]
 * @param {string|number} epicId
 * @returns {string}
 */
export function getEpicBranch(epicId) {
  return `epic/${epicId}`;
}

/**
 * Resolves the canonical branch name for a Story.
 * v5 Standard: story/epic-[EPIC_ID]/[STORY_SLUG]
 * @param {string|number} epicId
 * @param {string} storySlug
 * @returns {string}
 */
export function getStoryBranch(epicId, storySlug) {
  // Sanitize slug (alphanumeric, -, _) to ensure valid git branch
  const cleanSlug = storySlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // trim hyphens at ends
  return `story/epic-${epicId}/${cleanSlug}`;
}

/**
 * Resolves the canonical branch name for a Task.
 * v5 Standard (Legacy): task/epic-[EPIC_ID]/[TASK_ID]
 * @param {string|number} epicId
 * @param {string|number} taskId
 * @returns {string}
 */
export function getTaskBranch(epicId, taskId) {
  return `task/epic-${epicId}/${taskId}`;
}

/**
 * Resolves the ephemeral candidate branch name for integration verification.
 * v5 Standard: integration-candidate-epic-[EPIC_ID]-[TASK_ID]
 * @param {string|number} epicId
 * @param {string|number} taskId
 * @returns {string}
 */
export function getIntegrationCandidateBranch(epicId, taskId) {
  return `integration-candidate-epic-${epicId}-${taskId}`;
}
/**
 * Resolves the implementation branch for a task by inspecting its hierarchy.
 *
 * Checks if the task has a parent story; if so, returns a story-grouped branch name.
 * Otherwise, falls back to the legacy task-specific branch.
 *
 * @param {string|number} epicId
 * @param {number} taskId
 * @param {import('./ITicketingProvider.js').ITicketingProvider} provider
 * @returns {Promise<string>}
 */
export async function resolveBranchForTask(epicId, taskId, provider) {
  const task = await provider.getTicket(taskId);
  const parentMatch = task.body?.match(/parent:\s*#(\d+)/i);

  if (parentMatch) {
    const parentId = parseInt(parentMatch[1], 10);
    try {
      const parent = await provider.getTicket(parentId);
      if ((parent.labels ?? []).includes('type::story')) {
        return getStoryBranch(epicId, parent.title);
      }
    } catch (err) {
      console.warn(
        `[git-utils] Could not fetch parent #${parentId} for Task #${taskId}: ${err.message}`,
      );
    }
  }

  return getTaskBranch(epicId, taskId);
}
