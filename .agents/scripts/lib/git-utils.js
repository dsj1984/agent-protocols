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
