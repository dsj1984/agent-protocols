/**
 * worktree/git-hooks.js
 *
 * Materialize the repository's git hooks directory into a linked worktree.
 *
 * `core.hooksPath` is resolved by git against **each working tree's own
 * root**, not against the common git dir. A relative value therefore points
 * at a directory that only exists in the checkout that generated it — husky
 * writes `.husky/_` from its `prepare` script in the main checkout and
 * self-ignores it — so every linked worktree resolves the hooks path to a
 * directory that is not there. Git finds no hooks and proceeds silently:
 * `commit-msg`, `pre-commit` and `pre-push` do not run for any commit made in
 * a worktree, without anyone passing a bypass flag.
 *
 * This module closes that gap by copying the resolved hooks directory into
 * the worktree at the same relative path. It is deliberately total about the
 * cases where there is nothing to do — an unset or absolute `core.hooksPath`,
 * or a source directory that does not exist — because a consumer project
 * without husky must not fail worktree creation. Every other outcome either
 * materializes the hooks or throws: a silent skip is the defect being fixed.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as defaultGit from '../git-utils.js';
import { assertPathContainment } from '../path-security.js';

// Skip reasons. Deliberately not exported: they are part of the result
// digest's observable contract, so callers and tests read them as the literal
// strings they are printed as, not through a symbol that could be renamed
// without anyone noticing the digest changed.
//
//   hooks-path-unset  — git uses the common `hooks` dir, already shared.
//   hooks-path-absolute — resolves alike from every working tree already.
//   source-absent     — no hooks directory to mirror (no husky in this project).
//   same-checkout     — target is the source; copying it onto itself would
//                       destroy the only copy.
const SKIP_UNSET = 'hooks-path-unset';
const SKIP_ABSOLUTE = 'hooks-path-absolute';
const SKIP_SOURCE_ABSENT = 'source-absent';
const SKIP_SAME_CHECKOUT = 'same-checkout';

/**
 * Read `core.hooksPath` as configured for `repoRoot`.
 *
 * `git config --get` exits non-zero when the key is unset, which is a
 * legitimate state rather than an error, so this reports `null` for both an
 * unset key and an empty value.
 *
 * @param {string} repoRoot
 * @param {{ gitSpawn: Function }} gitImpl
 * @returns {string|null}
 */
function readHooksPath(repoRoot, gitImpl) {
  const res = gitImpl.gitSpawn(repoRoot, 'config', '--get', 'core.hooksPath');
  if (res.status !== 0) return null;
  const value = (res.stdout ?? '').trim();
  return value.length > 0 ? value : null;
}

/**
 * Canonical form of `dir` for identity comparison.
 *
 * `realpathSync.native` is used so a symlinked temp root (macOS `/var` →
 * `/private/var`) does not make a checkout look distinct from itself. A path
 * that cannot be resolved falls back to `path.resolve`, which is enough for
 * the comparison to stay conservative.
 *
 * @param {string} dir
 * @param {typeof fs} fsImpl
 * @returns {string}
 */
function canonical(dir, fsImpl) {
  const resolved = path.resolve(dir);
  try {
    return fsImpl.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Names of the regular files directly inside `dir`, sorted.
 *
 * @param {string} dir
 * @param {typeof fs} fsImpl
 * @returns {string[]}
 */
function hookFileNames(dir, fsImpl) {
  return fsImpl
    .readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name)
    .sort();
}

/**
 * Materialize `repoRoot`'s resolved git hooks directory into `worktree`.
 *
 * Idempotent, and refreshing rather than preserving: an existing target is
 * replaced so an upgraded husky can never leave a stale shim behind.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot   Absolute path to the checkout that owns the hooks.
 * @param {string} opts.worktree   Absolute path to the worktree to provision.
 * @param {{ gitSpawn: Function }} [opts.gitImpl]
 * @param {typeof fs} [opts.fsImpl]
 * @returns {{ action: 'materialized' | 'skipped', reason?: string,
 *   hooksPath: string|null, source: string|null, target: string|null,
 *   hooks: string[] }}
 * @throws {Error} when the source exists but the hooks could not be placed.
 */
export function materializeGitHooks({
  repoRoot,
  worktree,
  gitImpl = defaultGit,
  fsImpl = fs,
} = {}) {
  if (!repoRoot || typeof repoRoot !== 'string') {
    throw new Error('worktree.hooks: repoRoot is required');
  }
  if (!worktree || typeof worktree !== 'string') {
    throw new Error('worktree.hooks: worktree is required');
  }

  const skip = (reason, hooksPath = null) => ({
    action: 'skipped',
    reason,
    hooksPath,
    source: null,
    target: null,
    hooks: [],
  });

  const hooksPath = readHooksPath(repoRoot, gitImpl);
  if (hooksPath === null) return skip(SKIP_UNSET);
  if (path.isAbsolute(hooksPath)) return skip(SKIP_ABSOLUTE, hooksPath);

  if (canonical(repoRoot, fsImpl) === canonical(worktree, fsImpl)) {
    return skip(SKIP_SAME_CHECKOUT, hooksPath);
  }

  const source = path.resolve(repoRoot, hooksPath);
  if (!fsImpl.existsSync(source)) return skip(SKIP_SOURCE_ABSENT, hooksPath);

  const target = path.resolve(worktree, hooksPath);
  // `core.hooksPath` is repo configuration, but it still reaches a recursive
  // remove below — a `../..` value must not be able to delete outside the
  // worktree it claims to provision.
  assertPathContainment(
    path.resolve(worktree),
    target,
    'worktree.hooks: core.hooksPath',
    { allowEmpty: false },
  );

  try {
    fsImpl.rmSync(target, { recursive: true, force: true });
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    fsImpl.cpSync(source, target, { recursive: true });
  } catch (err) {
    throw new Error(
      `worktree.hooks: failed to materialize ${source} into ${target}: ${err.message}`,
    );
  }

  // Verify rather than trust the copy. The whole point of this module is that
  // a hooks directory which is absent behaves exactly like one that is
  // present and empty — git runs neither, and says nothing either way.
  const expected = hookFileNames(source, fsImpl);
  const actual = new Set(
    fsImpl.existsSync(target) ? hookFileNames(target, fsImpl) : [],
  );
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(
      `worktree.hooks: materialized ${target} is missing ${missing.length} hook(s): ${missing.join(', ')}`,
    );
  }

  return { action: 'materialized', hooksPath, source, target, hooks: expected };
}

/**
 * Resolve the checkout that owns the shared git config from `cwd`.
 *
 * `--git-common-dir` reports the common git dir from any working tree —
 * `.git` from the main checkout, an absolute path from a linked worktree —
 * so the owning checkout is its parent. This is what lets the standalone CLI
 * be run from inside a worktree with no arguments.
 *
 * @param {string} cwd
 * @param {{ execFileSyncImpl?: typeof execFileSync }} [deps]
 * @returns {string}
 */
export function resolveCommonCheckout(
  cwd,
  { execFileSyncImpl = execFileSync } = {},
) {
  const out = execFileSyncImpl('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return path.dirname(path.resolve(cwd, out));
}
