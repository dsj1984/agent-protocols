/**
 * bootstrap/baseline-merge-driver — register the `baselines/*.json` merge
 * driver on a consumer clone (Story #5215).
 *
 * Registration has two halves that live in different places, and conflating
 * them is why this needs a doctor check rather than just an installer:
 *
 *   1. **`.gitattributes`** says which files use the driver. It is a tracked
 *      file, so installing the line once ships it to everyone.
 *   2. **`git config merge.mandrel-baseline.driver`** says what the driver
 *      actually is. Git deliberately keeps this out of tracked config —
 *      otherwise a clone would execute a command chosen by whoever wrote the
 *      repo — so it is **per clone**, and a fresh clone silently falls back
 *      to git's text merge with no error at all.
 *
 * That silence is the whole reason `mandrel doctor` carries a check: an
 * unregistered clone is not broken in any way it can report on its own, it
 * just quietly goes back to conflicting (or worse, splicing) baselines.
 *
 * This module owns both halves plus the strings they share, so the installer
 * and the doctor check cannot drift apart on the exact command.
 *
 * @module lib/bootstrap/baseline-merge-driver
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnCapture } from '../child-exec.js';

/** Driver name, as it appears on both sides of the registration. */
export const BASELINE_MERGE_DRIVER_NAME = 'mandrel-baseline';

/** The `.gitattributes` line that routes baselines through the driver. */
export const BASELINE_MERGE_ATTRIBUTE = `baselines/*.json merge=${BASELINE_MERGE_DRIVER_NAME}`;

/** Git config key holding the driver command. */
export const BASELINE_MERGE_DRIVER_CONFIG_KEY = `merge.${BASELINE_MERGE_DRIVER_NAME}.driver`;

/**
 * The driver command. Relative to the worktree root, which is where git runs
 * a merge driver from, and where `mandrel sync` materializes `.agents/`.
 */
export const BASELINE_MERGE_DRIVER_COMMAND =
  'node .agents/scripts/merge-baseline.js %O %A %B %P';

/** The exact command an operator runs to complete registration. */
export const BASELINE_MERGE_DRIVER_REMEDY = `git config ${BASELINE_MERGE_DRIVER_CONFIG_KEY} "${BASELINE_MERGE_DRIVER_COMMAND}"`;

/**
 * Does this `.gitattributes` content route baselines through the driver?
 * Comment lines do not count — a commented-out registration is not one.
 *
 * @param {string|null|undefined} gitattributes
 * @returns {boolean}
 */
export function declaresBaselineMergeDriver(gitattributes) {
  return String(gitattributes ?? '')
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) return false;
      return trimmed.includes(`merge=${BASELINE_MERGE_DRIVER_NAME}`);
    });
}

/**
 * Add the attribute line, preserving every existing line verbatim.
 *
 * @param {string} projectRoot
 * @param {typeof fs} [fsImpl]
 * @returns {{ action: 'created'|'appended'|'already-present', path: string }}
 */
export function ensureGitattributesLine(projectRoot, fsImpl = fs) {
  const target = path.join(projectRoot, '.gitattributes');
  if (!fsImpl.existsSync(target)) {
    fsImpl.writeFileSync(target, `${BASELINE_MERGE_ATTRIBUTE}\n`, 'utf8');
    return { action: 'created', path: target };
  }
  const existing = fsImpl.readFileSync(target, 'utf8');
  if (declaresBaselineMergeDriver(existing)) {
    return { action: 'already-present', path: target };
  }
  // A file not ending in a newline would otherwise glue our line onto the
  // last existing one, silently rewriting it.
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fsImpl.writeFileSync(
    target,
    `${existing}${separator}${BASELINE_MERGE_ATTRIBUTE}\n`,
    'utf8',
  );
  return { action: 'appended', path: target };
}

/**
 * Point `merge.mandrel-baseline.driver` at the driver in THIS clone.
 *
 * @param {string} projectRoot
 * @param {typeof spawnCapture} [spawnImpl]
 * @returns {{ action: 'set'|'already-present'|'not-a-repo'|'failed' }}
 */
export function ensureDriverGitConfig(projectRoot, spawnImpl = spawnCapture) {
  const opts = {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
  };
  const inRepo = spawnImpl('git', ['rev-parse', '--git-dir'], opts);
  if ((inRepo?.status ?? 1) !== 0) return { action: 'not-a-repo' };

  const current = spawnImpl(
    'git',
    ['config', '--local', '--get', BASELINE_MERGE_DRIVER_CONFIG_KEY],
    opts,
  );
  if (
    (current?.status ?? 1) === 0 &&
    String(current.stdout ?? '').trim() === BASELINE_MERGE_DRIVER_COMMAND
  ) {
    return { action: 'already-present' };
  }

  const set = spawnImpl(
    'git',
    [
      'config',
      '--local',
      BASELINE_MERGE_DRIVER_CONFIG_KEY,
      BASELINE_MERGE_DRIVER_COMMAND,
    ],
    opts,
  );
  spawnImpl(
    'git',
    [
      'config',
      '--local',
      `merge.${BASELINE_MERGE_DRIVER_NAME}.name`,
      'mandrel baseline merge by row identity',
    ],
    opts,
  );
  return { action: (set?.status ?? 1) === 0 ? 'set' : 'failed' };
}

/**
 * Install both halves. Idempotent: a second run reports `already-present`
 * and changes no bytes.
 *
 * @param {object} ctx
 * @param {string} ctx.projectRoot
 * @param {typeof spawnCapture} [ctx.spawnImpl]
 * @param {typeof fs} [ctx.fsImpl]
 * @returns {{
 *   action: 'already-present'|'updated',
 *   attributes: string,
 *   config: string,
 *   path: string,
 * }}
 */
export function ensureBaselineMergeDriver(ctx) {
  const attributes = ensureGitattributesLine(ctx.projectRoot, ctx.fsImpl ?? fs);
  const config = ensureDriverGitConfig(ctx.projectRoot, ctx.spawnImpl);
  const settled =
    attributes.action === 'already-present' &&
    (config.action === 'already-present' || config.action === 'not-a-repo');
  return {
    action: settled ? 'already-present' : 'updated',
    attributes: attributes.action,
    config: config.action,
    path: attributes.path,
  };
}
