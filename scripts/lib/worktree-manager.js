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

import fs from 'node:fs';
import path from 'node:path';
import * as defaultGit from './git-utils.js';

const STORY_BRANCH_RE = /^story-\d+$/;

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
      ...config,
    };
    this.logger = logger ?? {
      info: (m) => console.log(`[WorktreeManager] ${m}`),
      warn: (m) => console.warn(`[WorktreeManager] ⚠️ ${m}`),
      error: (m) => console.error(`[WorktreeManager] ❌ ${m}`),
    };
    this.git = git;
    this.platform = platform;

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
      throw new Error(
        `WorktreeManager: git worktree add failed for story-${id}: ${res.stderr || res.stdout}`,
      );
    }

    if (this.platform === 'win32') {
      this.git.gitSpawn(wtPath, 'config', '--local', 'core.longpaths', 'true');
    }

    this._applyNodeModulesStrategy(wtPath);
    this._linkAgentsToRoot(wtPath);

    this.logger.info(`worktree.created storyId=${id} path=${wtPath}`);
    return {
      path: wtPath,
      created: true,
      ...(windowsPathWarning ? { windowsPathWarning } : {}),
    };
  }

  /**
   * Apply the configured `nodeModulesStrategy` after a fresh worktree is
   * added. Called only during creation — existing worktrees keep whatever
   * strategy they started with.
   *
   * Strategies:
   *   - `per-worktree`: no-op. Agents run their own `npm/pnpm install`.
   *   - `symlink`: create `<wtPath>/node_modules` → `<primeFromPath>/node_modules`.
   *     Refuses on win32 unless `allowSymlinkOnWindows: true` (symlink
   *     semantics differ by Windows version / filesystem permissions).
   *   - `pnpm-store`: no-op here. The strategy contract is that the
   *     agent/CI will invoke `pnpm install` against the shared store.
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
          fs.symlinkSync(primeNodeModules, target, 'junction');
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
      // Any other exit (e.g. epic branch missing) we treat as "no epic to
      // compare against" and fall through to safe — matching prior behavior
      // where a missing Epic branch was silently ignored.
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
    }

    return { safe: true };
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

    // Drop the `.agents` symlink (if any) before `git worktree remove`.
    // git refuses to remove a worktree that contains a submodule/nested repo,
    // which is exactly what the tracked `.agents` gitlink looks like in
    // consumer projects. Removing the symlink first sidesteps the check and
    // leaves the root `.agents` untouched.
    this._unlinkAgentsFromRoot(wtPath);

    const res = this.git.gitSpawn(this.repoRoot, 'worktree', 'remove', wtPath);
    if (res.status !== 0) {
      return {
        removed: false,
        reason: `remove-failed: ${res.stderr}`,
        path: wtPath,
      };
    }

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
    const maxAgeMs = opts.maxAgeMs ?? 30_000;
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

  _findByPath(absPath) {
    const res = this.git.gitSpawn(
      this.repoRoot,
      'worktree',
      'list',
      '--porcelain',
    );
    if (res.status !== 0) return null;
    const normalized = path.resolve(absPath);
    return (
      parseWorktreePorcelain(res.stdout).find(
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
      return /\bpath\s*=\s*\.agents\s*$/m.test(body);
    } catch {
      return false;
    }
  }

  /**
   * Replace the worktree's `.agents/` (tracked as a submodule gitlink) with a
   * symlink to the root repo's `.agents/`. Worktrees must never carry their
   * own copy of `.agents`: scripts invoked from any worktree run identical
   * code, and `git worktree remove` no longer refuses on the grounds that
   * there is a submodule inside.
   *
   * Only runs in repos that declare `.agents` as a submodule. The framework
   * repo itself (where `.agents` is tracked directly) skips this.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _linkAgentsToRoot(wtPath) {
    if (!this._isAgentsSubmodule()) return;
    const rootAgents = path.join(this.repoRoot, '.agents');
    if (!fs.existsSync(rootAgents)) {
      this.logger.warn(
        `agents-symlink skipped: root ${rootAgents} does not exist`,
      );
      return;
    }
    const wtAgents = path.join(wtPath, '.agents');
    try {
      fs.rmSync(wtAgents, { recursive: true, force: true });
    } catch {
      // Nothing to remove, or permission — symlink attempt will surface it.
    }
    const linkType = this.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(rootAgents, wtAgents, linkType);
    } catch (err) {
      this.logger.warn(
        `agents-symlink failed path=${wtAgents}: ${err.message}`,
      );
      return;
    }
    // Mark the gitlink path as skip-worktree so the per-worktree index
    // stops reporting the submodule as modified/deleted.
    this.git.gitSpawn(
      wtPath,
      'update-index',
      '--skip-worktree',
      '--',
      '.agents',
    );
    this.logger.info(
      `worktree.agents.symlinked target=${wtAgents} source=${rootAgents}`,
    );
  }

  /**
   * Remove the `.agents` symlink before `git worktree remove`. The real
   * `<repoRoot>/.agents` directory is never touched — this only unlinks the
   * worktree's pointer to it.
   *
   * @param {string} wtPath Absolute worktree path.
   */
  _unlinkAgentsFromRoot(wtPath) {
    const wtAgents = path.join(wtPath, '.agents');
    let target;
    try {
      target = fs.readlinkSync(wtAgents);
    } catch {
      return; // not a symlink — leave alone
    }
    const resolvedTarget = path.resolve(path.dirname(wtAgents), target);
    const rootAgents = path.resolve(this.repoRoot, '.agents');
    if (resolvedTarget !== rootAgents) {
      this.logger.warn(
        `agents-symlink unlink skipped: target ${resolvedTarget} is not root ${rootAgents}`,
      );
      return;
    }
    try {
      fs.unlinkSync(wtAgents);
    } catch {
      try {
        fs.rmdirSync(wtAgents);
      } catch {
        // best-effort; worktree remove will still try
      }
    }
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
