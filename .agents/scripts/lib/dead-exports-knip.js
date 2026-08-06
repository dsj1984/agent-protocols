/**
 * dead-exports-knip.js — the knip driver behind the dead-export ratchet.
 *
 * Owns everything about talking to knip and normalising what comes back:
 * spawning it, reading a pre-captured report, and flattening its report into
 * `{ file, symbol }` rows. `check-dead-exports.js` stays a thin CLI over this.
 *
 * @module lib/dead-exports-knip
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

/**
 * Spawn `npx knip --reporter json --no-progress` and return the parsed
 * envelope. Never throws — the caller logs the error and treats current rows as
 * empty, which surfaces every baseline row as "removed": loud, but safe.
 *
 * `production` adds knip's `--production` flag, which restricts analysis to
 * entry/project patterns carrying the `!` suffix in `knip.json`. The test globs
 * deliberately lack that suffix, so production mode drops them as entry points
 * and an export reachable only from a test reads as dead. Without those
 * suffixes production mode has no entry patterns at all and reports nothing —
 * `knip.json` and this flag are a matched pair.
 *
 * Exported as a hook so tests can stub the spawn without a working knip
 * workspace.
 *
 * @param {{ cwd?: string, spawn?: typeof spawnSync, production?: boolean }} [opts]
 * @returns {{ ok: true, envelope: unknown } | { ok: false, error: string }}
 */
export function runKnip({
  cwd = process.cwd(),
  spawn = spawnSync,
  production = false,
} = {}) {
  const args = ['knip', '--reporter', 'json', '--no-progress'];
  if (production) args.push('--production');
  const result = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    return { ok: false, error: `spawn failed: ${result.error.message}` };
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout.trim().length === 0) {
    return { ok: false, error: 'knip produced empty stdout' };
  }
  try {
    return { ok: true, envelope: JSON.parse(stdout) };
  } catch (err) {
    return {
      ok: false,
      error: `knip JSON parse failed: ${err?.message ?? err}`,
    };
  }
}

/**
 * Read a pre-captured knip JSON envelope from disk (the `--knip-output` test
 * seam). Returns the parsed envelope or `null` on failure.
 *
 * @param {string} filePath
 * @returns {unknown}
 */
export function readKnipOutput(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Sentinel `symbol` recorded for a **whole-file death** row.
 *
 * Knip's `files` category names a module nothing in the graph imports. There
 * is no per-export identity to record — the whole file is the finding — so the
 * ratchet encodes exactly one row per dead file carrying this symbol. `*` is
 * not a legal JavaScript identifier, so a whole-file row can never collide
 * with a real export row for the same path.
 */
const WHOLE_FILE_SYMBOL = '*';

/**
 * Pull the dead-file paths out of one knip issue's `files` category.
 *
 * Knip emits `files: [{ name: '<path>' }]`, but tolerate a bare string and
 * fall back to the issue's own `file` so a reporter-shape change degrades to
 * "one row for this path" rather than to silence.
 *
 * @param {{ files?: unknown }} issue
 * @param {string} fallbackFile The issue's own `file` path.
 * @returns {string[]}
 */
function extractDeadFileNames(issue, fallbackFile) {
  const entries = Array.isArray(issue.files) ? issue.files : [];
  const names = [];
  for (const entry of entries) {
    const name =
      (typeof entry === 'string' && entry) ||
      (entry && typeof entry.name === 'string' && entry.name) ||
      fallbackFile;
    if (typeof name === 'string' && name.length > 0) names.push(name);
  }
  return names;
}

/**
 * Pull the dead-export symbol names out of one knip issue's `exports`
 * category. Knip emits `exports: [{ name, ... }]`; older shapes used `symbol`.
 *
 * @param {{ exports?: unknown }} issue
 * @returns {string[]}
 */
function extractDeadExportSymbols(issue) {
  const entries = Array.isArray(issue.exports) ? issue.exports : [];
  const symbols = [];
  for (const e of entries) {
    const symbol =
      (e && typeof e.name === 'string' && e.name) ||
      (e && typeof e.symbol === 'string' && e.symbol) ||
      null;
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

/**
 * Flatten knip's `--reporter json` output into `{ file, symbol }` rows. Knip
 * emits `{ issues: [{ file, files: [...], exports: [{ name, ... }], ... }] }`.
 *
 * Two categories are mapped, and the ratchet treats their rows identically:
 *
 * - **`exports`** → one row per unused export, `{ file, symbol: '<name>' }`.
 * - **`files`** → one row per module nothing imports,
 *   `{ file, symbol: '*' }`. Story #5001 added this leg: mapping only
 *   `exports` made the ratchet structurally blind to *whole-file* death, so a
 *   module could lose its last caller and every one of its exports go unused
 *   without a single row changing. Knip reports such a module once, under
 *   `files`, and suppresses its per-export rows — which is exactly why the
 *   export-only reading saw nothing.
 *
 * Whole-file rows are de-duplicated by path so the row set is stable across
 * runs regardless of how many issue records mention the same file. Dependency-
 * and duplicate-level issues stay ignored; knip surfaces those under their own
 * `rules` keys and they are not a code-death signal.
 *
 * @param {unknown} knipEnvelope The parsed knip JSON report.
 * @returns {Array<{ file: string, symbol: string }>}
 */
export function extractRowsFromKnip(knipEnvelope) {
  const rows = [];
  if (!knipEnvelope || typeof knipEnvelope !== 'object') return rows;
  const issues = Array.isArray(knipEnvelope.issues) ? knipEnvelope.issues : [];
  const seenDeadFiles = new Set();
  for (const issue of issues) {
    const file = issue?.file;
    if (typeof file !== 'string' || file.length === 0) continue;
    for (const name of extractDeadFileNames(issue, file)) {
      if (seenDeadFiles.has(name)) continue;
      seenDeadFiles.add(name);
      rows.push({ file: name, symbol: WHOLE_FILE_SYMBOL });
    }
    for (const symbol of extractDeadExportSymbols(issue)) {
      rows.push({ file, symbol });
    }
  }
  return rows;
}
