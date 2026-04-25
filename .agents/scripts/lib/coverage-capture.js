/**
 * coverage-capture.js — ensure `coverage/coverage-final.json` is present and
 * fresh before any CRAP gate (close-validation pre-flight, pre-push, CI) reads
 * it. The CRAP scorer treats "no coverage" as "skip the method" under the
 * default `requireCoverage: true` policy, so a missing or stale artifact
 * silently weakens the gate. This helper closes that hole by capturing
 * coverage in-band when it is missing or older than the CRAP-target sources.
 *
 * Pure functions live here; the spawn wiring lives in
 * `.agents/scripts/coverage-capture.js` (CLI). Importers test freshness via
 * `isCoverageFresh` and decide whether to delegate to `runCapture`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Walk a directory tree and return the newest mtime (ms since epoch) seen
 * across `.js` and `.mjs` files. Symlinks, missing dirs, and unreadable nodes
 * resolve to 0 so the caller treats "no sources" the same as "ancient sources"
 * — both mean "any existing coverage is fresh enough".
 *
 * Exported for unit testing.
 *
 * @param {string} cwd Absolute repo root.
 * @param {string[]} targetDirs Repo-relative directories to scan.
 * @param {{ statSync?: typeof fs.statSync, readdirSync?: typeof fs.readdirSync }} [io]
 * @returns {number} Newest mtime in ms, or 0 when no source files exist.
 */
export function newestSourceMtime(cwd, targetDirs, io = {}) {
  const statSync = io.statSync ?? fs.statSync;
  const readdirSync = io.readdirSync ?? fs.readdirSync;
  let newest = 0;

  const visit = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        visit(childAbs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue;
      try {
        const m = statSync(childAbs).mtimeMs;
        if (m > newest) newest = m;
      } catch {
        // ignore unreadable file
      }
    }
  };

  for (const dir of targetDirs) {
    if (!dir) continue;
    visit(path.resolve(cwd, dir));
  }
  return newest;
}

/**
 * Decide whether the existing coverage artifact is "fresh" — present and at
 * least as new as the newest source file under `targetDirs`. Missing files,
 * missing target dirs, or any IO error resolve to `false` so the caller
 * captures rather than trusting stale data.
 *
 * @param {{
 *   coveragePath: string,
 *   targetDirs: string[],
 *   cwd: string,
 *   statSync?: typeof fs.statSync,
 *   readdirSync?: typeof fs.readdirSync,
 *   existsSync?: typeof fs.existsSync,
 * }} opts
 * @returns {{ fresh: boolean, reason: 'missing' | 'stale' | 'fresh' | 'no-sources' }}
 */
export function isCoverageFresh({
  coveragePath,
  targetDirs,
  cwd,
  statSync = fs.statSync,
  readdirSync = fs.readdirSync,
  existsSync = fs.existsSync,
}) {
  const absCoverage = path.resolve(cwd, coveragePath);
  if (!existsSync(absCoverage)) return { fresh: false, reason: 'missing' };

  let coverageMtime;
  try {
    coverageMtime = statSync(absCoverage).mtimeMs;
  } catch {
    return { fresh: false, reason: 'missing' };
  }

  const newestSrc = newestSourceMtime(cwd, targetDirs, {
    statSync,
    readdirSync,
  });
  if (newestSrc === 0) return { fresh: true, reason: 'no-sources' };
  return coverageMtime >= newestSrc
    ? { fresh: true, reason: 'fresh' }
    : { fresh: false, reason: 'stale' };
}

/**
 * Decide whether any of `changedFiles` lives under one of `targetDirs`.
 * Used by the pre-push fast-path so we can skip the (slow) coverage capture
 * when the push touches only files outside the CRAP scoring scope.
 *
 * Both inputs are forward-slash-normalised; `targetDirs` are matched as path
 * prefixes followed by `/`. An empty changed-file list returns `false`.
 *
 * @param {string[]} changedFiles
 * @param {string[]} targetDirs
 * @returns {boolean}
 */
export function anyChangedUnderTargets(changedFiles, targetDirs) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return false;
  if (!Array.isArray(targetDirs) || targetDirs.length === 0) return false;
  const norms = targetDirs
    .filter((d) => typeof d === 'string' && d.length > 0)
    .map((d) => d.replace(/\\/g, '/').replace(/\/+$/, ''));
  return changedFiles.some((file) => {
    const f = String(file).replace(/\\/g, '/');
    return norms.some((dir) => f === dir || f.startsWith(`${dir}/`));
  });
}

/**
 * Spawn `npm run test:coverage` in `cwd`. Inherits stdio so the operator sees
 * the raw test output. Returns the exit status; a non-zero exit means the
 * caller should propagate the failure (a broken test suite cannot be papered
 * over by the CRAP gate).
 *
 * @param {{ cwd: string, runner?: typeof spawnSync, log?: (m: string) => void }} opts
 * @returns {number}
 */
export function runCapture({ cwd, runner = spawnSync, log = () => {} } = {}) {
  log('[coverage-capture] ▶ npm run test:coverage');
  const res = runner('npm', ['run', 'test:coverage'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return res.status ?? 1;
}
