/**
 * worktree/node-modules-strategy.js
 *
 * Strategies for populating `node_modules` inside a freshly created worktree:
 *
 *   - `per-worktree`  — run the project's package-manager install inside the
 *                       worktree (lock-file aware).
 *   - `symlink`       — symlink (or junction on Windows) the worktree's
 *                       `node_modules` to a donor worktree's copy. Refuses on
 *                       Windows unless `allowSymlinkOnWindows=true`.
 *   - `pnpm-store`    — run `pnpm install --frozen-lockfile` against the
 *                       shared content-addressable store.
 *
 * The context passed to each helper carries the minimum state the strategy
 * needs: config, platform, logger, and repoRoot (for `symlink`).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

/**
 * Apply the configured `nodeModulesStrategy` after a fresh worktree is added.
 * Called only during creation.
 *
 * @param {{ config: object, platform: NodeJS.Platform, logger: object, repoRoot: string }} ctx
 * @param {string} wtPath Absolute worktree path.
 */
export function applyNodeModulesStrategy(ctx, wtPath) {
  const strategy = ctx.config.nodeModulesStrategy ?? 'per-worktree';

  switch (strategy) {
    case 'per-worktree':
    case 'pnpm-store':
      return;

    case 'symlink': {
      const primeFromPath = ctx.config.primeFromPath;
      if (!primeFromPath) {
        throw new Error(
          "WorktreeManager: nodeModulesStrategy='symlink' requires orchestration.worktreeIsolation.primeFromPath.",
        );
      }
      if (ctx.platform === 'win32' && !ctx.config.allowSymlinkOnWindows) {
        throw new Error(
          "WorktreeManager: nodeModulesStrategy='symlink' refuses on Windows. " +
            'Symlink semantics vary by Windows version and may require admin rights. ' +
            'Set orchestration.worktreeIsolation.allowSymlinkOnWindows=true to opt in.',
        );
      }

      const resolvedPrime = path.resolve(ctx.repoRoot, primeFromPath);
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
        // node_modules priming. Key off the real host OS — `ctx.platform` is a
        // test-injection hook and does not change what the filesystem accepts.
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(primeNodeModules, target, linkType);
      } catch (err) {
        throw new Error(
          `WorktreeManager: failed to symlink node_modules for ${wtPath}: ${err.message}`,
        );
      }
      ctx.logger.info(
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
 * Run the appropriate package-manager install inside a freshly created
 * worktree. Non-fatal: logs a warning on failure so the agent can retry.
 *
 * @param {{ config: object, platform: NodeJS.Platform, logger: object }} ctx
 * @param {string} wtPath Absolute worktree path.
 * @returns {boolean} `true` if install succeeded, `false` otherwise.
 */
export function installDependencies(ctx, wtPath) {
  const strategy = ctx.config.nodeModulesStrategy ?? 'per-worktree';
  if (strategy === 'symlink') return true;

  const pkgJson = path.join(wtPath, 'package.json');
  if (!fs.existsSync(pkgJson)) return true;

  let cmd;
  let args;
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
      ctx.logger.info(
        `worktree.install retry ${attempt}/${maxAttempts} after ${delay}ms...`,
      );
      sleepSync(delay);
    }

    ctx.logger.info(
      `worktree.install strategy=${strategy} cmd=${cmd} attempt=${attempt}/${maxAttempts} path=${wtPath}`,
    );
    lastResult = spawnSync(cmd, args, {
      cwd: wtPath,
      stdio: 'pipe',
      encoding: 'utf-8',
      shell: ctx.platform === 'win32',
      timeout,
    });

    if (lastResult.status === 0) break;

    const reason =
      lastResult.signal === 'SIGTERM'
        ? `timeout after ${timeout / 1000}s`
        : `exit ${lastResult.status}`;
    ctx.logger.warn(
      `worktree.install attempt ${attempt} failed (${reason}) stderr=${(lastResult.stderr ?? '').slice(0, 500)}`,
    );
  }

  if (lastResult.status !== 0) {
    ctx.logger.warn(
      `worktree.install FAILED after ${maxAttempts} attempt(s). ` +
        'Agent will need to run install manually in the worktree.',
    );
    return false;
  }

  const nmPath = path.join(wtPath, 'node_modules');
  if (!fs.existsSync(nmPath)) {
    ctx.logger.warn(
      `worktree.install cmd=${cmd} exited 0 but node_modules missing at ${nmPath}`,
    );
    return false;
  }

  ctx.logger.info(`worktree.install succeeded cmd=${cmd} path=${wtPath}`);
  return true;
}

export { sleepSync };
