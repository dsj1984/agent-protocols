/**
 * WorktreeManager — single authority over per-story git worktrees.
 *
 * Owns `ensure`, `reap`, `list`, `isSafeToRemove`, and `gc` for the
 * worktree-per-story isolation model (Epic #229 / Tech Spec #231).
 *
 * No other script may call `git worktree` directly. All git calls are
 * argv-based (no shell interpolation) and validate `storyId` / `branch`
 * before shelling out. Paths are resolved and asserted to live inside
 * `repoRoot`, and `reap` never passes `--force`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as defaultGit from './git-utils.js';

const STORY_BRANCH_RE = /^story-\d+$/;

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

/** @returns {number} */
function validateStoryId(storyId) {
  const n = typeof storyId === 'number' ? storyId : parseInt(storyId, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`WorktreeManager: invalid storyId: ${storyId}`);
  }
  return n;
}

/** @returns {string} */
function validateBranch(branch) {
  if (typeof branch !== 'string' || !STORY_BRANCH_RE.test(branch)) {
    throw new Error(
      `WorktreeManager: branch must match ${STORY_BRANCH_RE}, got: ${branch}`,
    );
  }
  return branch;
}

/**
 * Parse `git worktree list --porcelain` output into records.
 *
 * Porcelain format: blank-line-separated blocks where each line is
 * `key value` or a bare key (e.g. `bare`, `detached`).
 *
 * @param {string} raw
 * @returns {Array<{ path: string, head: string|null, branch: string|null, bare: boolean, detached: boolean }>}
 */
export function parseWorktreePorcelain(raw) {
  const out = [];
  const blocks = raw.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) continue;
    const rec = {
      path: '',
      head: null,
      branch: null,
      bare: false,
      detached: false,
    };
    for (const line of lines) {
      const sp = line.indexOf(' ');
      const key = sp === -1 ? line : line.slice(0, sp);
      const value = sp === -1 ? '' : line.slice(sp + 1);
      switch (key) {
        case 'worktree':
          rec.path = value;
          break;
        case 'HEAD':
          rec.head = value;
          break;
        case 'branch':
          rec.branch = value.replace(/^refs\/heads\//, '');
          break;
        case 'bare':
          rec.bare = true;
          break;
        case 'detached':
          rec.detached = true;
          break;
      }
    }
    if (rec.path) out.push(rec);
  }
  return out;
}

export class WorktreeManager {
  /**
   * @param {object} opts
   * @param {string} opts.repoRoot        Absolute path to the main repo.
   * @param {object} [opts.config]        Resolved `orchestration.worktreeIsolation` config.
   * @param {object} [opts.logger]        Logger with info/warn/error (defaults to console-style).
   * @param {object} [opts.git]           Injected `{ gitSync, gitSpawn }` (defaults to git-utils).
   * @param {NodeJS.Platform} [opts.platform]  Defaults to `process.platform`.
   */
  constructor({
    repoRoot,
    config = {},
    logger,
    git = defaultGit,
    platform = process.platform,
  }) {
    if (!repoRoot || typeof repoRoot !== 'string') {
      throw new Error('WorktreeManager: repoRoot is required');
    }
    this.repoRoot = path.resolve(repoRoot);
    this.config = {
      root: '.worktrees',
      nodeModulesStrategy: 'per-worktree',
      warnOnUncommittedOnReap: true,
      windowsPathLengthWarnThreshold: 240,
      bootstrapFiles: ['.env', '.mcp.json'],
      ...config,
    };
    this.logger = logger ?? {
      info: (m) => console.log(`[WorktreeManager] ${m}`),
      warn: (m) => console.warn(`[WorktreeManager] ⚠️ ${m}`),
      error: (m) => console.error(`[WorktreeManager] ❌ ${m}`),
    };
    this.git = git;
    this.platform = platform;
    /** @type {{ list: Array|null, ts: number }} */
    this._worktreeListCache = { list: null, ts: 0 };

    // Path traversal guard: resolve root and assert containment.
    const resolvedRoot = path.resolve(this.repoRoot, this.config.root);
    const rel = path.relative(this.repoRoot, resolvedRoot);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `WorktreeManager: worktreeRoot escapes repoRoot (root=${this.config.root})`,
      );
    }
    this.worktreeRoot = resolvedRoot;
  }

  /** Absolute path for a given storyId. */
  pathFor(storyId) {
    const n = validateStoryId(storyId);
    return path.join(this.worktreeRoot, `story-${n}`);
  }

  /**
   * Idempotently ensure a worktree exists at `.worktrees/story-<id>/` on `branch`.
   *
   * @param {number|string} storyId
   * @param {string} branch
   * @returns {Promise<{ path: string, created: boolean }>}
   */
  async ensure(storyId, branch) {
    const id = validateStoryId(storyId);
    const br = validateBranch(branch);
    if (br !== `story-${id}`) {
      throw new Error(
        `WorktreeManager: branch ${br} does not match storyId ${id}`,
      );
    }

    const wtPath = this.pathFor(id);
    const existing = this._findByPath(wtPath);

    if (existing) {
      if (existing.branch && existing.branch !== br) {
        throw new Error(
          `WorktreeManager: worktree at ${wtPath} is on branch ${existing.branch}, expected ${br}`,
        );
      }
      return { path: wtPath, created: false };
    }

    fs.mkdirSync(this.worktreeRoot, { recursive: true });

    const windowsPathWarning = this._maybeWarnWindowsPath(wtPath);

    // Pre-create the branch if it doesn't exist yet. `git worktree add -B`
    // creates-or-resets the branch to HEAD of the current ref; we use plain
    // `add <path> <branch>` so an existing branch is checked out as-is.
    const branchExists =
      this.git.gitSpawn(
        this.repoRoot,
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${br}`,
      ).status === 0;

    const addArgs = branchExists
      ? ['worktree', 'add', wtPath, br]
      : ['worktree', 'add', '-b', br, wtPath];

    const res = this.git.gitSpawn(this.repoRoot, ...addArgs);
    if (res.status !== 0) {
      // Race: another process may have created the worktree between our
      // _findByPath check and `git worktree add`. Re-check before failing.
      const stderr = res.stderr || res.stdout || '';
      if (/already (exists|checked out)/.test(stderr)) {
        const raceExisting = this._findByPath(wtPath);
        if (raceExisting) {
          this.logger.info(
            `worktree.ensure race: worktree appeared concurrently for story-${id}, reusing`,
          );
          return { path: wtPath, created: false };
        }
      }
      throw new Error(
        `WorktreeManager: git worktree add failed for story-${id}: ${stderr}`,
      );
    }

    this._invalidateWorktreeCache();

    if (this.platform === 'win32') {
      this.git.gitSpawn(wtPath, 'config', '--local', 'core.longpaths', 'true');
    }

    this._applyNodeModulesStrategy(wtPath);
    // Copy bootstrap files (.env, .mcp.json, …) before install so postinstall
    // hooks (Prisma, etc.) and dev-tool configs see them.
    this._copyBootstrapFiles(wtPath);
    const installOk = this._installDependencies(wtPath);
    this._copyAgentsFromRoot(wtPath);

    this.logger.info(`worktree.created storyId=${id} path=${wtPath}`);
    return {
      path: wtPath,
      created: true,
      installFailed: !installOk,
      ...(windowsPathWarning ? { windowsPathWarning } : {}),
    };
  }

  /**
   * Apply the configured `nodeModulesStrategy` after a fresh worktree is
   * added. Called only during creation — existing worktrees keep whatever
   * strategy they started with.
   *
   * Strategies:
   *   - `per-worktree`: no-op here. `_installDependencies` runs the install.
   *   - `symlink`: create `<wtPath>/node_modules` → `<primeFromPath>/node_modules`.
   *     Refuses on win32 unless `allowSymlinkOnWindows: true` (symlink
   *     semantics differ by Windows version / filesystem permissions).
   *   - `pnpm-store`: no-op here. `_installDependencies` runs `pnpm install`
   *     against the shared content-addressable store.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _applyNodeModulesStrategy(wtPath) {
    const strategy = this.config.nodeModulesStrategy ?? 'per-worktree';

    switch (strategy) {
      case 'per-worktree':
      case 'pnpm-store':
        return;

      case 'symlink': {
        const primeFromPath = this.config.primeFromPath;
        if (!primeFromPath) {
          throw new Error(
            "WorktreeManager: nodeModulesStrategy='symlink' requires orchestration.worktreeIsolation.primeFromPath.",
          );
        }
        if (this.platform === 'win32' && !this.config.allowSymlinkOnWindows) {
          throw new Error(
            "WorktreeManager: nodeModulesStrategy='symlink' refuses on Windows. " +
              'Symlink semantics vary by Windows version and may require admin rights. ' +
              'Set orchestration.worktreeIsolation.allowSymlinkOnWindows=true to opt in.',
          );
        }

        const resolvedPrime = path.resolve(this.repoRoot, primeFromPath);
        const primeNodeModules = path.join(resolvedPrime, 'node_modules');
        if (!fs.existsSync(primeNodeModules)) {
          throw new Error(
            `WorktreeManager: primeFromPath '${primeFromPath}' has no node_modules directory. ` +
              'Prime the donor worktree (run install there) before using the symlink strategy.',
          );
        }

        const target = path.join(wtPath, 'node_modules');
        try {
          // On Windows, `junction` works without Administrator privileges
          // (unlike `dir`/`file` symlinks) and is adequate for same-volume
          // node_modules priming. POSIX ignores the third arg. Key off the
          // real host OS — `this.platform` is a test-injection hook and does
          // not change what the filesystem will accept.
          const linkType = process.platform === 'win32' ? 'junction' : 'dir';
          fs.symlinkSync(primeNodeModules, target, linkType);
        } catch (err) {
          throw new Error(
            `WorktreeManager: failed to symlink node_modules for ${wtPath}: ${err.message}`,
          );
        }
        this.logger.info(
          `worktree.node_modules strategy=symlink target=${target} source=${primeNodeModules}`,
        );
        return;
      }

      default:
        throw new Error(
          `WorktreeManager: unknown nodeModulesStrategy '${strategy}'. ` +
            'Expected per-worktree | symlink | pnpm-store.',
        );
    }
  }

  /**
   * Copy untracked bootstrap files from the repo root into a freshly
   * created worktree. Files like `.env` and `.mcp.json` are typically
   * gitignored so `git worktree add` does NOT carry them over — tests
   * that depend on DATABASE_URL, Clerk secrets, seed keys, MCP tool
   * registrations, etc. then silently pick up stale or missing values and
   * fail in non-obvious ways (e.g. RBAC seed/clerkId collisions).
   *
   * Behaviour:
   *   - Existing files in the worktree are preserved (never overwrite —
   *     agents may have placed their own value).
   *   - Missing source files are a no-op.
   *   - Filenames must be bare relative paths under repoRoot (no `..`,
   *     no absolute paths, no glob).
   *
   * Configured via `orchestration.worktreeIsolation.bootstrapFiles`
   * (default: `['.env', '.mcp.json']`).
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _copyBootstrapFiles(wtPath) {
    const names = this.config.bootstrapFiles ?? [];
    if (!Array.isArray(names) || names.length === 0) return;

    for (const name of names) {
      if (typeof name !== 'string' || name.length === 0) continue;
      // Reject traversal / absolute paths — names must be bare, relative
      // to repoRoot, and must not escape it.
      const rel = path.normalize(name);
      if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('\0')) {
        this.logger.warn(
          `worktree.bootstrap skipped invalid name='${name}' (must be relative, no traversal)`,
        );
        continue;
      }

      const src = path.join(this.repoRoot, rel);
      if (!fs.existsSync(src)) continue;

      const dst = path.join(wtPath, rel);
      if (fs.existsSync(dst)) {
        this.logger.info(
          `worktree.bootstrap skipped path=${dst} (already exists)`,
        );
        continue;
      }

      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        this.logger.info(
          `worktree.bootstrap copied source=${src} target=${dst}`,
        );
      } catch (err) {
        this.logger.warn(
          `worktree.bootstrap copy failed name=${name}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Run the appropriate package-manager install inside a freshly created
   * worktree. Handles both `per-worktree` and `pnpm-store` strategies.
   *
   * - `per-worktree`: detects the lock file and runs the matching installer.
   * - `pnpm-store`: runs `pnpm install --frozen-lockfile` — pnpm's
   *   content-addressable store hard-links packages from the global cache,
   *   making repeat installs near-instant.
   * - `symlink`: no-op — node_modules is already linked to the donor.
   *
   * Non-fatal: logs a warning on failure so the agent can retry manually.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  /**
   * @returns {boolean} `true` if install succeeded, `false` otherwise.
   */
  _installDependencies(wtPath) {
    const strategy = this.config.nodeModulesStrategy ?? 'per-worktree';
    if (strategy === 'symlink') return true;

    const pkgJson = path.join(wtPath, 'package.json');
    if (!fs.existsSync(pkgJson)) return true;

    let cmd, args;
    if (strategy === 'pnpm-store') {
      cmd = 'pnpm';
      args = ['install', '--frozen-lockfile'];
    } else {
      // per-worktree: detect lock file to pick the right package manager.
      const hasPnpmLock = fs.existsSync(path.join(wtPath, 'pnpm-lock.yaml'));
      const hasYarnLock = fs.existsSync(path.join(wtPath, 'yarn.lock'));

      if (hasPnpmLock) {
        cmd = 'pnpm';
        args = ['install', '--frozen-lockfile'];
      } else if (hasYarnLock) {
        cmd = 'yarn';
        args = ['install', '--frozen-lockfile'];
      } else {
        cmd = 'npm';
        args = ['ci'];
      }
    }

    // pnpm-store first-run populates the global content-addressable store,
    // which can be slow. Give it more headroom and retry on failure.
    const isPnpm = cmd === 'pnpm';
    const maxAttempts = isPnpm ? 3 : 1;
    const timeout = isPnpm ? 300_000 : 120_000;
    const backoffMs = [0, 2_000, 5_000];

    let lastResult;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = backoffMs[attempt - 1] ?? 5_000;
        this.logger.info(
          `worktree.install retry ${attempt}/${maxAttempts} after ${delay}ms...`,
        );
        sleepSync(delay);
      }

      this.logger.info(
        `worktree.install strategy=${strategy} cmd=${cmd} attempt=${attempt}/${maxAttempts} path=${wtPath}`,
      );
      lastResult = spawnSync(cmd, args, {
        cwd: wtPath,
        stdio: 'pipe',
        encoding: 'utf-8',
        shell: this.platform === 'win32',
        timeout,
      });

      if (lastResult.status === 0) break;

      const reason =
        lastResult.signal === 'SIGTERM'
          ? `timeout after ${timeout / 1000}s`
          : `exit ${lastResult.status}`;
      this.logger.warn(
        `worktree.install attempt ${attempt} failed (${reason}) stderr=${(lastResult.stderr ?? '').slice(0, 500)}`,
      );
    }

    if (lastResult.status !== 0) {
      this.logger.warn(
        `worktree.install FAILED after ${maxAttempts} attempt(s). ` +
          'Agent will need to run install manually in the worktree.',
      );
      return false;
    }

    // Verify node_modules was actually created.
    const nmPath = path.join(wtPath, 'node_modules');
    if (!fs.existsSync(nmPath)) {
      this.logger.warn(
        `worktree.install cmd=${cmd} exited 0 but node_modules missing at ${nmPath}`,
      );
      return false;
    }

    this.logger.info(`worktree.install succeeded cmd=${cmd} path=${wtPath}`);
    return true;
  }

  /**
   * Enumerate all worktrees known to git.
   *
   * @returns {Promise<Array<{ path: string, head: string|null, branch: string|null, bare: boolean, detached: boolean }>>}
   */
  async list() {
    const res = this.git.gitSpawn(
      this.repoRoot,
      'worktree',
      'list',
      '--porcelain',
    );
    if (res.status !== 0) {
      throw new Error(
        `WorktreeManager: git worktree list failed: ${res.stderr}`,
      );
    }
    return parseWorktreePorcelain(res.stdout);
  }

  /**
   * Check whether a worktree is safe to remove: clean tree and fully merged
   * into its Epic base (when one is supplied).
   *
   * @param {string} wtPath
   * @param {{ epicBranch?: string|null }} [opts]
   * @returns {Promise<{ safe: boolean, reason?: string }>}
   */
  async isSafeToRemove(wtPath, opts = {}) {
    if (!fs.existsSync(wtPath)) {
      return { safe: true, reason: 'path-missing' };
    }

    const status = this.git.gitSpawn(wtPath, 'status', '--porcelain');
    if (status.status !== 0) {
      return { safe: false, reason: `status-failed: ${status.stderr}` };
    }
    if (status.stdout.length > 0) {
      return { safe: false, reason: 'uncommitted-changes' };
    }

    // Resolve the checked-out branch, then its Epic base, then compare.
    const headRes = this.git.gitSpawn(
      wtPath,
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    );
    if (headRes.status !== 0) {
      return { safe: false, reason: `rev-parse-failed: ${headRes.stderr}` };
    }
    const branch = headRes.stdout;
    if (branch === 'HEAD') {
      return { safe: false, reason: 'detached-head' };
    }

    const epicBranch = opts.epicBranch ?? null;
    if (epicBranch) {
      // `merge-base --is-ancestor A B` exits 0 when A is an ancestor of B.
      // When A=branch and B=epicBranch, exit 0 ⇒ every commit on `branch`
      // is reachable from `epicBranch` ⇒ fully merged. Exit 1 ⇒ unmerged.
      // Any other exit (e.g. epic branch missing, ref lookup failure) is an
      // unsafe cleanup condition: better to leave the worktree behind than to
      // reap something whose merge status we could not verify.
      const res = this.git.gitSpawn(
        this.repoRoot,
        'merge-base',
        '--is-ancestor',
        branch,
        epicBranch,
      );
      if (res.status === 1) {
        return { safe: false, reason: 'unmerged-commits' };
      }
      if (res.status !== 0) {
        return {
          safe: false,
          reason: `merge-check-failed: ${res.stderr || res.stdout || 'unknown'}`,
        };
      }
    }

    return { safe: true };
  }

  /**
   * Prune stale git worktree registrations for directories that no longer
   * exist. Kept here so all `git worktree` mutations flow through one helper.
   *
   * @returns {{ pruned: boolean, reason?: string }}
   */
  prune() {
    const res = this.git.gitSpawn(this.repoRoot, 'worktree', 'prune');
    if (res.status !== 0) {
      return {
        pruned: false,
        reason: res.stderr || res.stdout || 'worktree-prune-failed',
      };
    }
    this._invalidateWorktreeCache();
    return { pruned: true };
  }

  /**
   * Remove the worktree for a given storyId. Never uses `--force`.
   *
   * @param {number|string} storyId
   * @param {{ force?: boolean, epicBranch?: string|null }} [opts]
   * @returns {Promise<{ removed: boolean, reason?: string, path: string }>}
   */
  async reap(storyId, opts = {}) {
    if (opts.force) {
      throw new Error(
        'WorktreeManager.reap: --force is not permitted by the framework',
      );
    }
    const wtPath = this.pathFor(storyId);

    // Callers that already have a porcelain snapshot (e.g. gc()) can inject
    // it via `opts.worktrees` to skip the N+1 `git worktree list` re-probe.
    const known = opts.worktrees
      ? opts.worktrees.some(
          (r) => path.resolve(r.path) === path.resolve(wtPath),
        )
      : this._findByPath(wtPath) !== null;
    if (!known) {
      return { removed: false, reason: 'not-a-worktree', path: wtPath };
    }

    if (this._storyIdFromPath(wtPath) !== null && !opts.epicBranch) {
      return { removed: false, reason: 'epic-branch-required', path: wtPath };
    }

    const safety = await this.isSafeToRemove(wtPath, {
      epicBranch: opts.epicBranch ?? null,
    });
    if (!safety.safe) {
      if (this.config.warnOnUncommittedOnReap) {
        this.logger.warn(
          `reap-skipped storyId=${storyId} reason=${safety.reason} path=${wtPath}`,
        );
      }
      return { removed: false, reason: safety.reason, path: wtPath };
    }

    // Drop the copied `.agents/` directory and its gitlink (if any) before
    // `git worktree remove`. git refuses to remove a worktree whose index
    // carries a submodule gitlink, and leaving the copied directory on disk
    // would also register as untracked content. Removing both leaves the
    // worktree in a clean, removable state. The root `.agents` is never
    // touched — the copy is a plain directory, not a symlink.
    this._removeCopiedAgents(wtPath);

    const res = this.git.gitSpawn(this.repoRoot, 'worktree', 'remove', wtPath);
    if (res.status !== 0) {
      return {
        removed: false,
        reason: `remove-failed: ${res.stderr}`,
        path: wtPath,
      };
    }
    this._invalidateWorktreeCache();

    this.logger.info(`worktree.reaped storyId=${storyId} path=${wtPath}`);
    return { removed: true, path: wtPath };
  }

  /**
   * Sweep abandoned worktrees. For each worktree under `worktreeRoot`
   * whose `story-<id>` is NOT in `openStoryIds`, reap if safe. Unsafe
   * candidates are left in place with a warning.
   *
   * @param {Array<number|string>} openStoryIds
   * @param {{ epicBranch?: string|null }} [opts]
   * @returns {Promise<{ reaped: Array<{ storyId: number, path: string }>, skipped: Array<{ storyId: number, path: string, reason: string }> }>}
   */
  async gc(openStoryIds, opts = {}) {
    const open = new Set((openStoryIds ?? []).map((x) => validateStoryId(x)));
    const worktrees = await this.list();
    const reaped = [];
    const skipped = [];

    for (const wt of worktrees) {
      const id = this._storyIdFromPath(wt.path);
      if (id === null) continue; // not a managed story worktree
      if (open.has(id)) continue; // still live

      const result = await this.reap(id, {
        epicBranch: opts.epicBranch ?? null,
        worktrees,
      });
      if (result.removed) {
        reaped.push({ storyId: id, path: wt.path });
      } else {
        skipped.push({
          storyId: id,
          path: wt.path,
          reason: result.reason ?? 'unknown',
        });
      }
    }

    return { reaped, skipped };
  }

  /**
   * Sweep stale `*.lock` files under the shared `.git/` dir that crash-left
   * agents and IDE git integrations can leave behind. Worktree isolation
   * protects per-worktree indexes but the main repo's `.git/` is still
   * shared state — `git worktree add/remove/prune`, `fetch`, auto-gc, and
   * VSCode's git extension all touch it. When an orchestrator crashes,
   * orphaned `index.lock` files block the next run.
   *
   * Only files whose mtime is older than `maxAgeMs` are removed. Fresh
   * locks — belonging to a legitimate in-flight operation — are left
   * alone. This is deliberately narrow: we target the well-known lock
   * names, not every `*.lock` under `.git/` (refs have their own lock
   * discipline and should not be touched here).
   *
   * @param {{ maxAgeMs?: number }} [opts]
   * @returns {Promise<{ removed: Array<{ path: string, ageMs: number }>, skipped: Array<{ path: string, ageMs: number }> }>}
   */
  async sweepStaleLocks(opts = {}) {
    const maxAgeMs = opts.maxAgeMs ?? 300_000;
    const now = Date.now();
    const removed = [];
    const skipped = [];

    const gitDir = path.join(this.repoRoot, '.git');
    const candidates = [
      path.join(gitDir, 'index.lock'),
      path.join(gitDir, 'HEAD.lock'),
      path.join(gitDir, 'packed-refs.lock'),
      path.join(gitDir, 'config.lock'),
      path.join(gitDir, 'shallow.lock'),
    ];

    const worktreesDir = path.join(gitDir, 'worktrees');
    if (fs.existsSync(worktreesDir)) {
      for (const name of fs.readdirSync(worktreesDir)) {
        candidates.push(path.join(worktreesDir, name, 'index.lock'));
        candidates.push(path.join(worktreesDir, name, 'HEAD.lock'));
      }
    }

    for (const lockPath of candidates) {
      let stat;
      try {
        stat = fs.statSync(lockPath);
      } catch {
        continue;
      }
      const ageMs = now - stat.mtimeMs;
      if (ageMs < maxAgeMs) {
        skipped.push({ path: lockPath, ageMs });
        continue;
      }
      try {
        fs.unlinkSync(lockPath);
        removed.push({ path: lockPath, ageMs });
        this.logger.warn(
          `stale-lock removed path=${lockPath} ageMs=${Math.round(ageMs)}`,
        );
      } catch (err) {
        this.logger.warn(
          `stale-lock unlink failed path=${lockPath}: ${err.message}`,
        );
      }
    }

    return { removed, skipped };
  }

  // ───────────────────────── internals ─────────────────────────

  /**
   * Fetch the parsed worktree list, cached for 5 seconds to avoid spawning
   * `git worktree list --porcelain` on every call within the same operation.
   */
  _getWorktreeList() {
    const now = Date.now();
    if (
      this._worktreeListCache.list &&
      now - this._worktreeListCache.ts < 5_000
    ) {
      return this._worktreeListCache.list;
    }
    const res = this.git.gitSpawn(
      this.repoRoot,
      'worktree',
      'list',
      '--porcelain',
    );
    if (res.status !== 0) return [];
    const parsed = parseWorktreePorcelain(res.stdout);
    this._worktreeListCache = { list: parsed, ts: now };
    return parsed;
  }

  /** Invalidate the worktree list cache (call after add/remove). */
  _invalidateWorktreeCache() {
    this._worktreeListCache = { list: null, ts: 0 };
  }

  _findByPath(absPath) {
    const normalized = path.resolve(absPath);
    return (
      this._getWorktreeList().find(
        (r) => path.resolve(r.path) === normalized,
      ) ?? null
    );
  }

  /**
   * Detect whether the root repo declares `.agents` as a git submodule.
   * Only consumer projects do — in the framework repo itself `.agents` is a
   * normal tracked directory, and the symlink would fight with tracked files.
   */
  _isAgentsSubmodule() {
    const gitmodulesPath = path.join(this.repoRoot, '.gitmodules');
    if (!fs.existsSync(gitmodulesPath)) return false;
    try {
      const body = fs.readFileSync(gitmodulesPath, 'utf8');
      return /^\s*path\s*=\s*["']?\.agents["']?\s*$/m.test(body);
    } catch {
      return false;
    }
  }

  /**
   * Copy the root repo's `.agents/` into the worktree as a plain directory.
   * Worktrees are self-contained — `git worktree remove` works without any
   * submodule-teardown dance, and there is no symlink for git to follow back
   * into the root (which previously risked wiping `<repoRoot>/.agents` on
   * Windows when junction targets mismatched).
   *
   * Drift: the copy is a point-in-time snapshot. Any `.agents/` update in
   * root after worktree creation does not propagate — acceptable for sprint-
   * length worktrees. If that changes, add a refresh step to sprint-execute.
   *
   * Only runs in repos that declare `.agents` as a submodule. The framework
   * repo itself (where `.agents` is tracked directly) skips this.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _copyAgentsFromRoot(wtPath) {
    if (!this._isAgentsSubmodule()) return;
    const rootAgents = path.resolve(this.repoRoot, '.agents');
    if (!fs.existsSync(rootAgents)) {
      this.logger.warn(
        `agents-copy skipped: root ${rootAgents} does not exist`,
      );
      return;
    }
    const wtAgents = path.resolve(wtPath, '.agents');
    // Containment assertion: refuse to touch anything outside the worktree.
    // Without this, a bad wtPath (e.g. equal to repoRoot) causes `fs.rmSync`
    // to wipe the real `<repoRoot>/.agents`.
    if (this._samePath(wtAgents, rootAgents)) {
      throw new Error(
        `WorktreeManager: refusing to clear root .agents (wtPath=${wtPath} resolves to repoRoot)`,
      );
    }
    const wtRel = path.relative(path.resolve(wtPath), wtAgents);
    if (wtRel.startsWith('..') || path.isAbsolute(wtRel)) {
      throw new Error(
        `WorktreeManager: wtAgents ${wtAgents} escapes wtPath ${wtPath}`,
      );
    }
    // Remove the empty gitlink placeholder dir that `git worktree add` leaves
    // for the .agents submodule. fs.rmSync on a plain dir never traverses a
    // symlink, and we just asserted wtAgents is inside wtPath.
    try {
      fs.rmSync(wtAgents, { recursive: true, force: true });
    } catch {
      // Nothing to remove, or permission — copy attempt will surface it.
    }
    try {
      fs.cpSync(rootAgents, wtAgents, {
        recursive: true,
        dereference: true,
        errorOnExist: false,
        force: true,
      });
    } catch (err) {
      this.logger.warn(`agents-copy failed path=${wtAgents}: ${err.message}`);
      return;
    }
    // Hide `.agents` working-tree drift from routine commits without staging
    // a gitlink deletion. The actual gitlink scrub is deferred to reap().
    this._setAgentsGitlinkSkipWorktree(wtPath, true);
    this.logger.info(
      `worktree.agents.copied target=${wtAgents} source=${rootAgents}`,
    );
  }

  /**
   * Remove the copied `.agents/` directory and scrub the gitlink from the
   * worktree's index before `git worktree remove`. The real
   * `<repoRoot>/.agents` directory is never touched — the worktree copy is a
   * plain directory, not a symlink, so rmSync has no way to traverse out.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _removeCopiedAgents(wtPath) {
    const wtAgents = path.resolve(wtPath, '.agents');
    const rootAgents = path.resolve(this.repoRoot, '.agents');
    // Defense-in-depth: never delete something that resolves to repoRoot's
    // `.agents`. Can only happen if wtPath equals repoRoot, which earlier
    // validation rejects — but keep the guard in case of future refactors.
    if (this._samePath(wtAgents, rootAgents)) {
      throw new Error(
        `WorktreeManager: refusing to remove root .agents (wtPath=${wtPath} resolves to repoRoot)`,
      );
    }
    // If the path is a symlink (legacy worktree created before the copy
    // switch), unlink it rather than rmSync-ing — rmSync with recursive:true
    // on a symlink-to-directory can traverse into the target on some
    // platforms.
    try {
      const st = fs.lstatSync(wtAgents);
      if (st.isSymbolicLink()) {
        fs.unlinkSync(wtAgents);
      } else {
        fs.rmSync(wtAgents, { recursive: true, force: true });
      }
    } catch {
      // Nothing to remove — fall through to index scrub.
    }
    // Clear skip-worktree before the removal scrub so git can mutate the
    // index entry deterministically on every platform/version.
    this._setAgentsGitlinkSkipWorktree(wtPath, false);
    this._dropAgentsGitlinkFromIndex(wtPath);
    this._purgePerWorktreeSubmoduleDir(wtPath);
  }

  /**
   * `git worktree remove` refuses with
   * `working trees containing submodules cannot be moved or removed` when
   * EITHER (a) a 160000 gitlink is in the worktree's index OR
   * (b) `<common-git-dir>/worktrees/<name>/modules/` exists. Scrubbing the
   * index alone is not sufficient when a prior run (or the legacy symlink
   * scheme) populated the per-worktree modules directory. Remove the
   * directory if present so the second guard also passes.
   *
   * Locates the per-worktree gitdir via the `gitdir:` pointer in
   * `<wtPath>/.git`. The root `.git/modules/` (main checkout's submodule
   * working dirs) is never touched.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _purgePerWorktreeSubmoduleDir(wtPath) {
    if (!this._isAgentsSubmodule()) return;
    const dotGit = path.join(wtPath, '.git');
    let gitdir;
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) {
        // Main checkout, not a secondary worktree — nothing to purge here.
        return;
      }
      const raw = fs.readFileSync(dotGit, 'utf8').trim();
      const m = raw.match(/^gitdir:\s*(.+)$/m);
      if (!m) return;
      gitdir = path.resolve(wtPath, m[1].trim());
    } catch {
      return;
    }
    // Containment: per-worktree gitdir must live under the main repo's
    // `.git/worktrees/` — refuse anything else to avoid touching arbitrary
    // paths if the pointer file is malformed.
    const expectedRoot = path.resolve(this.repoRoot, '.git', 'worktrees');
    const rel = path.relative(expectedRoot, gitdir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      this.logger.warn(
        `agents-modules-purge skipped: per-worktree gitdir ${gitdir} is outside ${expectedRoot}`,
      );
      return;
    }
    const modulesDir = path.join(gitdir, 'modules');
    if (!fs.existsSync(modulesDir)) return;
    try {
      fs.rmSync(modulesDir, { recursive: true, force: true });
      this.logger.info(`worktree.agents.modules-purged path=${modulesDir}`);
    } catch (err) {
      this.logger.warn(
        `agents-modules-purge failed path=${modulesDir}: ${err.message}`,
      );
    }
  }

  /**
   * Toggle the skip-worktree bit for `.agents` in a worktree-local index.
   *
   * During ensure(), setting skip-worktree avoids surfacing the copied
   * `.agents/` directory as constant drift while preventing accidental staging
   * of a gitlink deletion in normal task commits. During reap(), we clear the
   * bit first, then drop the gitlink and remove the worktree.
   *
   * @param {string} wtPath Absolute worktree path.
   * @param {boolean} enable
   */
  _setAgentsGitlinkSkipWorktree(wtPath, enable) {
    if (!this._isAgentsSubmodule()) return;
    const ls = this.git.gitSpawn(
      wtPath,
      'ls-files',
      '--stage',
      '--',
      '.agents',
    );
    if (ls.status !== 0 || !/^160000 /.test(ls.stdout)) return;
    const flag = enable ? '--skip-worktree' : '--no-skip-worktree';
    const update = this.git.gitSpawn(
      wtPath,
      'update-index',
      flag,
      '--',
      '.agents',
    );
    if (update.status !== 0) {
      this.logger.warn(
        `agents-skip-worktree ${enable ? 'set' : 'clear'} failed path=${wtPath}: ${update.stderr || update.stdout}`,
      );
    }
  }

  /**
   * Remove any `.agents` gitlink entry from the worktree's index. Called
   * before `git worktree remove` so git's submodule guard does not fire.
   * Safe to call even when there is no gitlink — `git rm --cached` is
   * short-circuited by a pre-check, and a non-zero exit is logged but
   * does not block removal.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _dropAgentsGitlinkFromIndex(wtPath) {
    if (!this._isAgentsSubmodule()) return;
    const ls = this.git.gitSpawn(
      wtPath,
      'ls-files',
      '--stage',
      '--',
      '.agents',
    );
    if (ls.status !== 0 || !/^160000 /.test(ls.stdout)) return;
    const rm = this.git.gitSpawn(
      wtPath,
      'rm',
      '--cached',
      '-f',
      '--',
      '.agents',
    );
    if (rm.status !== 0) {
      this.logger.warn(
        `agents-index-scrub failed path=${wtPath}: ${rm.stderr || rm.stdout}`,
      );
    }
  }

  /**
   * Path equality that handles platform differences. Windows filesystems are
   * case-insensitive, and `fs.readlinkSync` can return paths with different
   * drive-letter casing or separator normalization than the original input.
   *
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  _samePath(a, b) {
    const na = path.resolve(a);
    const nb = path.resolve(b);
    if (this.platform === 'win32') {
      return na.toLowerCase() === nb.toLowerCase();
    }
    return na === nb;
  }

  _storyIdFromPath(wtPath) {
    const resolved = path.resolve(wtPath);
    const rel = path.relative(this.worktreeRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const match = rel.match(/^story-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Compute expected deepest path for a fresh worktree and warn when it
   * crosses `windowsPathLengthWarnThreshold`. Windows has a 260-char MAX_PATH
   * limit unless `core.longpaths=true`; even with that flag set, some older
   * tools still truncate, so surfacing the warning early lets operators
   * relocate the worktree root before a build actually breaks.
   *
   * @returns {{ path: string, length: number, threshold: number } | null}
   *   Warning payload when the threshold is exceeded, otherwise `null`.
   */
  _maybeWarnWindowsPath(wtPath) {
    if (this.platform !== 'win32') return null;
    const threshold = this.config.windowsPathLengthWarnThreshold ?? 240;
    // Approximate the deepest path an agent is likely to touch: worktree
    // root + a conservative project-depth allowance. 80 chars covers the
    // common case of `apps/<name>/src/<module>/<file>.ts` and similar
    // monorepo layouts without requiring tech-stack config wiring.
    const deepestAllowance = 80;
    const estimated = wtPath.length + deepestAllowance;
    if (estimated <= threshold) return null;
    this.logger.warn(
      `windows-long-path path=${wtPath} length=${wtPath.length} estimated=${estimated} threshold=${threshold}`,
    );
    return { path: wtPath, length: estimated, threshold };
  }
}
