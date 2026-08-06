/**
 * git-utils.js — Shared Git Shell Utilities
 *
 * Centralizes all Git subprocess invocations for the orchestration
 * engine, eliminating duplicated wrappers across the codebase.
 *
 * Two flavours are provided. Choose based on whether a non-zero git exit
 * code represents a bug (use `gitSync`) or a recoverable runtime state
 * (use `gitSpawn`):
 *
 *   - `gitSync(cwd, ...args)`  — throws on non-zero exit; returns trimmed
 *     stdout. Use when the operation must succeed for the caller to
 *     proceed (e.g. `rev-parse HEAD`, `merge-base --is-ancestor` inside a
 *     critical-path check). A non-zero exit is treated as a bug or a
 *     corrupted repo state, and the throw propagates to the caller's
 *     existing error path.
 *
 *   - `gitSpawn(cwd, ...args)` — never throws; returns a {@link GitResult}
 *     object. Use when the caller needs to inspect or recover from the
 *     non-zero case (e.g. `merge-base --is-ancestor` as a boolean check,
 *     `branch -D` where "no such branch" is acceptable, fetch/push retry
 *     loops where the caller decides whether to retry on stderr content).
 *
 * The two functions are intentional siblings — they share argument shape so
 * either can be substituted at a call site by changing the import. Do not
 * unify into a single `git({ throwOnNonZero })` until the call-site split
 * shows roughly even use of each contract.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { execFileCapture, spawnCapture } from './child-exec.js';

/**
 * Result of a `gitSpawn` invocation. Field semantics match `child_process.spawnSync`
 * with two normalisations: `status` is coerced to `1` when null (e.g. when
 * the child terminated by signal), and stdout/stderr are trimmed.
 *
 * @typedef {object} GitResult
 * @property {number} status - Process exit code (0 = success).
 * @property {string} stdout - Trimmed stdout.
 * @property {string} stderr - Trimmed stderr.
 */

let _execFileSync = execFileSync;
let _spawnSync = spawnSync;

/**
 * Memoized cleaned env shared by every `gitSync` / `gitSpawn` /
 * `createGitInterface` invocation in this process. Built lazily on first
 * use so cold imports pay nothing. Call sites pass the object through to
 * `child_process` only — none mutate `GIT_*` (or any other key) between
 * git calls, so reuse is safe. Tests that mutate `process.env` and need
 * a fresh snapshot must call {@link __resetCleanGitEnv}.
 *
 * @type {NodeJS.ProcessEnv | null}
 */
let _cleanGitEnv = null;

/**
 * Build a child-process env that drops every `GIT_*` variable inherited from
 * the parent. When this module's helpers run inside a git hook (e.g. husky
 * pre-push) the parent git invocation exports GIT_DIR / GIT_WORK_TREE /
 * GIT_INDEX_FILE / GIT_PREFIX / GIT_COMMON_DIR / etc. Those env vars
 * override the explicit `cwd` we pass, so a `gitSync(tmpdir, 'init')` ends
 * up operating on the parent worktree's `.git` rather than `tmpdir`. Tests
 * that spin up real git fixtures break reproducibly under that shape.
 *
 * Stripping every `GIT_*` is broader than strictly necessary but cheap and
 * impossible to drift out of sync with future git releases. The result is
 * memoized per process (see `_cleanGitEnv`); author/committer identity is
 * restored via per-call `env:` overrides where required.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function cleanGitEnv() {
  if (_cleanGitEnv) return _cleanGitEnv;
  _cleanGitEnv = Object.freeze(
    Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
    ),
  );
  return _cleanGitEnv;
}

/**
 * Drop the memoized cleaned env so the next git call rebuilds from
 * `process.env`. Testing-only seam — not part of the stable API.
 */
export function __resetCleanGitEnv() {
  _cleanGitEnv = null;
}

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
 * The **single** throwing git runner. Both the module-level {@link gitSync} and
 * the interface returned by {@link createGitInterface} route through this —
 * they differ only in which `execFileSync` they hand it.
 *
 * Buffer, shell and encoding policy belong to
 * [`child-exec.js`](child-exec.js); this function contributes only the git
 * specifics (argv prefix, cwd, scrubbed env).
 *
 * @param {typeof execFileSync} exec
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string} Trimmed stdout text.
 */
function runGitSync(exec, cwd, args) {
  return String(
    execFileCapture('git', args, {
      run: exec,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanGitEnv(),
    }),
  ).trim();
}

/**
 * The **single** non-throwing git runner — the `spawnSync` counterpart of
 * {@link runGitSync}, normalising `status`/stdout/stderr into a
 * {@link GitResult} via the shared exec surface.
 *
 * @param {typeof spawnSync} spawn
 * @param {string} cwd
 * @param {string[]} args
 * @returns {GitResult}
 */
function runGitSpawn(spawn, cwd, args) {
  return spawnCapture('git', args, {
    run: spawn,
    cwd,
    env: cleanGitEnv(),
  });
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
  return runGitSync(_execFileSync, cwd, args);
}

/**
 * Run a git command synchronously, returning a result object.
 * Never throws — callers must inspect `status` to detect failure.
 *
 * @param {string}   cwd  - Working directory for the git process.
 * @param {...string} args - Git sub-command and arguments.
 * @returns {GitResult}
 */
export function gitSpawn(cwd, ...args) {
  return runGitSpawn(_spawnSync, cwd, args);
}

/**
 * Build a git interface closed over injected child-process runners. Preferred
 * seam for callers that want explicit injection without touching the
 * module-global `__setGitRunners` state (which is a test-only override that
 * leaks between suites). The returned object has the same shape as this
 * module's namespace exports (`gitSync`, `gitSpawn`, `gitFetchWithRetry`,
 * `gitPullWithRetry`) so it is drop-in as a `ctx.git` replacement.
 *
 * @param {object} [deps]
 * @param {typeof execFileSync} [deps.exec]   - Defaults to real `execFileSync`.
 * @param {typeof spawnSync}    [deps.spawn]  - Defaults to real `spawnSync`.
 * @param {(ms: number) => Promise<void>} [deps.sleep] - Retry backoff sleep.
 * @param {number} [deps.jitter] - Jitter factor for retry backoff.
 */
export function createGitInterface(deps = {}) {
  const exec = deps.exec ?? execFileSync;
  const spawn = deps.spawn ?? spawnSync;
  const sleep = deps.sleep ?? defaultSleep;
  const jitterFactor = deps.jitter ?? 0.5;

  const boundGitSpawn = (cwd, ...args) => runGitSpawn(spawn, cwd, args);
  const withRetry =
    (argvPrefix) =>
    (cwd, ...args) =>
      gitWithContentionRetry(
        { spawnGit: boundGitSpawn, sleep, jitterFactor },
        cwd,
        argvPrefix,
        args,
      );

  return {
    gitSync: (cwd, ...args) => runGitSync(exec, cwd, args),
    gitSpawn: boundGitSpawn,
    gitFetchWithRetry: withRetry(['fetch']),
    gitPullWithRetry: withRetry(['pull', '--rebase']),
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
 * Real wall-clock sleep — the default backoff delay for both the module-level
 * retry helpers and {@link createGitInterface}.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep helper for retry backoff. Overridable via `__setSleep` so tests
 * can skip real wall-clock delays without relying on node:test timer mocks.
 * @type {(ms: number) => Promise<void>}
 */
let _sleep = defaultSleep;
let _jitterFactor = 0.5;

/**
 * Test-only seam: replace the sleep implementation used by
 * `gitFetchWithRetry` to avoid real backoff in unit tests.
 * @param {(ms: number) => Promise<void>} fn
 * @param {{ jitter?: number }} [opts] - Override jitter factor (default: 0 for mocks).
 */
export function __setSleep(fn, opts = {}) {
  _sleep = fn;
  _jitterFactor = opts.jitter ?? 0;
}

/**
 * Backoff schedule for {@link gitWithContentionRetry}: 250ms, 500ms, 1000ms
 * (3 retries → 4 attempts total).
 */
const CONTENTION_BACKOFF_MS = Object.freeze([250, 500, 1000]);

/**
 * The **single** bounded retry loop for git commands that can hit packed-refs
 * lock contention. Only contention signatures trigger a retry — non-contention
 * failures surface immediately, and success short-circuits the loop.
 *
 * Deliberately no global lock — a mutex would erase the parallelism the
 * worktree-isolation model is designed to enable. The schedule and the jitter
 * policy live only here, so a backoff tuning change has a single point of
 * application: the module-level `gitFetchWithRetry` / `gitPullWithRetry` pass
 * the `_sleep` / `_jitterFactor` seams, and {@link createGitInterface} passes
 * its injected equivalents.
 *
 * @param {{ spawnGit: (cwd: string, ...args: string[]) => GitResult,
 *   sleep: (ms: number) => Promise<void>, jitterFactor: number }} runners
 * @param {string} cwd
 * @param {string[]} argvPrefix - Leading git argv (e.g. `['fetch']`).
 * @param {string[]} args - Trailing arguments (e.g. `['origin']`).
 * @returns {Promise<{ status: number, stdout: string, stderr: string, attempts: number }>}
 */
async function gitWithContentionRetry(
  { spawnGit, sleep, jitterFactor },
  cwd,
  argvPrefix,
  args,
) {
  let attempt = 0;
  for (;;) {
    attempt++;
    const last = spawnGit(cwd, ...argvPrefix, ...args);
    const exhausted = attempt > CONTENTION_BACKOFF_MS.length;
    if (
      last.status === 0 ||
      exhausted ||
      !isPackedRefsContention(last.stderr)
    ) {
      return { ...last, attempts: attempt };
    }
    const base = CONTENTION_BACKOFF_MS[attempt - 1];
    await sleep(base + Math.floor(Math.random() * base * jitterFactor));
  }
}

/**
 * The module-level retry runners — the `__setSleep`-overridable seams bound to
 * the module-global {@link gitSpawn}. Read lazily so `__setSleep` and
 * `__setGitRunners` still take effect after import.
 *
 * @returns {{ spawnGit: typeof gitSpawn, sleep: (ms: number) => Promise<void>,
 *   jitterFactor: number }}
 */
function moduleRetryRunners() {
  return { spawnGit: gitSpawn, sleep: _sleep, jitterFactor: _jitterFactor };
}

/**
 * Run `git fetch …` with the bounded packed-refs-contention retry loop
 * (see `gitWithContentionRetry`).
 *
 * @param {string} cwd
 * @param {...string} args - Arguments after `fetch` (e.g. `'origin'`).
 * @returns {Promise<{ status: number, stdout: string, stderr: string, attempts: number }>}
 */
export function gitFetchWithRetry(cwd, ...args) {
  return gitWithContentionRetry(moduleRetryRunners(), cwd, ['fetch'], args);
}

/**
 * Run `git pull --rebase …` with the same bounded retry loop as
 * `gitFetchWithRetry`. Packed-refs contention can occur during pulls
 * just as during fetches — particularly in multi-worktree setups.
 *
 * @param {string} cwd
 * @param {...string} args - Arguments after `pull --rebase` (e.g. `'origin', 'main'`).
 * @returns {Promise<{ status: number, stdout: string, stderr: string, attempts: number }>}
 */
export function gitPullWithRetry(cwd, ...args) {
  return gitWithContentionRetry(
    moduleRetryRunners(),
    cwd,
    ['pull', '--rebase'],
    args,
  );
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
 * @param {string|number} storyId
 * @returns {string}
 */
export function getStoryBranch(storyId) {
  const id =
    typeof storyId === 'number' ? storyId : Number.parseInt(storyId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`getStoryBranch: invalid storyId: ${storyId}`);
  }
  return `story-${id}`;
}

/**
 * Canonical `story-<id>` branch name matcher. Single source of truth for the
 * Story-branch shape — `parseStoryBranch` and `isStoryBranch` both close over
 * this so call sites never re-author the regex inline.
 */
const STORY_BRANCH_RE = /^story-(\d+)$/;

/**
 * Parse a canonical Story branch name into its numeric Story ID.
 *
 * @param {string} name - Branch name to inspect (e.g. `story-3334`).
 * @returns {number|null} The Story ID when `name` matches `story-<id>`,
 *   otherwise `null`.
 */
export function parseStoryBranch(name) {
  if (typeof name !== 'string') return null;
  const match = STORY_BRANCH_RE.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Predicate: is `name` a canonical `story-<id>` branch name?
 *
 * @param {string} name - Branch name to test.
 * @returns {boolean}
 */
export function isStoryBranch(name) {
  return parseStoryBranch(name) !== null;
}
