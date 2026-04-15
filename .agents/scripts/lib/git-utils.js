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

let _execFileSync = execFileSync;
let _spawnSync = spawnSync;

/**
 * Override git runners. Testing-only seam — not part of the stable API.
 *
 * Production code must not call this. The double-underscore prefix is the
 * contract: `__setGitRunners` exists so the test suite can inject mock
 * child-process runners without requiring a broader DI refactor of every
 * `gitSync`/`gitSpawn` call site. If more injection points become needed,
 * replace this seam with a proper `createGitRunner({exec, spawn})` factory
 * and thread it through the module graph.
 *
 * @param {typeof execFileSync} exec  - Mock for `execFileSync`.
 * @param {typeof spawnSync}    spawn - Mock for `spawnSync`.
 */
export function __setGitRunners(exec, spawn) {
  _execFileSync = exec;
  _spawnSync = spawn;
}

/**
 * Run a git command synchronously, returning trimmed stdout.
 * Throws an Error if the command exits with a non-zero code.
 *
 * @param {string}   cwd  - Working directory for the git process.
 * @param {...string} args - Git sub-command and arguments.
 * @returns {string} Trimmed stdout text.
 */
export function gitSync(cwd, ...args) {
  return _execFileSync('git', args, {
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
  const result = _spawnSync('git', args, {
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
 * Known lock-contention error signatures that occur when two worktrees
 * fetch concurrently against the same repo. Matching any of these is the
 * only condition under which `gitFetchWithRetry` will re-attempt —
 * unrelated fetch failures surface immediately.
 */
const PACKED_REFS_CONTENTION_PATTERNS = [
  /packed-refs\.lock/i,
  /cannot lock ref/i,
  /Unable to create '.*\.lock'/i,
  /another git process seems to be running/i,
];

function isPackedRefsContention(stderr) {
  if (!stderr) return false;
  return PACKED_REFS_CONTENTION_PATTERNS.some((p) => p.test(stderr));
}

/**
 * Sleep helper for retry backoff. Overridable via `__setSleep` so tests
 * can skip real wall-clock delays without relying on node:test timer mocks.
 * @param {number} ms
 * @returns {Promise<void>}
 */
let _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Test-only seam: replace the sleep implementation used by
 * `gitFetchWithRetry` to avoid real backoff in unit tests.
 * @param {(ms: number) => Promise<void>} fn
 */
export function __setSleep(fn) {
  _sleep = fn;
}

/**
 * Run `git fetch …` with a bounded retry loop that only triggers on known
 * packed-refs lock-contention signatures. Non-contention failures surface
 * immediately (no retry). Success short-circuits the loop.
 *
 * Backoff schedule: 250ms, 500ms, 1000ms (3 retries → 4 attempts total).
 * Deliberately no global lock — a mutex would erase the parallelism the
 * worktree-isolation model is designed to enable.
 *
 * @param {string} cwd
 * @param {...string} args - Arguments after `fetch` (e.g. `'origin'`).
 * @returns {Promise<{ status: number, stdout: string, stderr: string, attempts: number }>}
 */
export async function gitFetchWithRetry(cwd, ...args) {
  const backoff = [250, 500, 1000];
  let attempt = 0;
  let last;
  for (;;) {
    attempt++;
    last = gitSpawn(cwd, 'fetch', ...args);
    if (last.status === 0) return { ...last, attempts: attempt };
    if (!isPackedRefsContention(last.stderr)) return { ...last, attempts: attempt };
    if (attempt > backoff.length) return { ...last, attempts: attempt };
    await _sleep(backoff[attempt - 1]);
  }
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
 * Sanitize a string into a URL/branch-safe slug.
 * Lowercases, replaces non-alphanumeric characters with hyphens,
 * collapses multiple hyphens, and trims leading/trailing hyphens.
 *
 * @param {string} text - Raw text to slugify.
 * @returns {string} Sanitized slug.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolves the canonical branch name for a Story.
 * v5 Standard: story-[STORY_ID]
 * @param {string|number} _epicId - Unused; retained for back-compat call sites.
 * @param {string|number} storyId
 * @returns {string}
 */
export function getStoryBranch(_epicId, storyId) {
  return `story-${storyId}`;
}

/**
 * Resolves the canonical branch name for a Task.
 * v5 Standard (Legacy): task/epic-[EPIC_ID]/[TASK_ID]
 * @deprecated In v5, tasks are implemented on their parent story branch (`story-[STORY_ID]`). This is only used as a fallback for orphan tasks.
 * @param {string|number} epicId
 * @param {string|number} taskId
 * @returns {string}
 */
export function getTaskBranch(epicId, taskId) {
  return `task/epic-${epicId}/${taskId}`;
}
