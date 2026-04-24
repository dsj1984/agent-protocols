import fs from 'node:fs';
import path from 'node:path';
import { calculateCrapForSource } from './crap-engine.js';
import { hasCoverageFor } from './coverage-utils.js';
import { scanDirectory } from './maintainability-utils.js';

export const KERNEL_VERSION = '1.0.0';
export const DEFAULT_BASELINE_PATH = 'crap-baseline.json';
const SCHEMA_REF = '.agents/schemas/crap-baseline.schema.json';

function normalizeSep(p) {
  return String(p).replace(/\\/g, '/');
}

function stripLeadingDotSlash(p) {
  return p.replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function findCoverageEntry(map, relPath) {
  if (!map || !relPath) return null;
  const suffix = stripLeadingDotSlash(normalizeSep(relPath));
  if (!suffix) return null;
  for (const key of Object.keys(map)) {
    const norm = normalizeSep(key);
    if (norm === suffix || norm.endsWith(`/${suffix}`)) {
      return map[key] ?? null;
    }
  }
  return null;
}

/**
 * Resolve the running `typhonjs-escomplex` version by walking up from `cwd`
 * and reading the nearest `node_modules/typhonjs-escomplex/package.json`.
 * Returns `'0.0.0'` when the dependency cannot be found — callers treat that
 * sentinel as "unknown environment" and may refuse to persist a baseline.
 *
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveEscomplexVersion(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  const { root } = path.parse(dir);
  while (true) {
    const pkgPath = path.join(
      dir,
      'node_modules',
      'typhonjs-escomplex',
      'package.json',
    );
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (parsed && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        // fall through to parent lookup
      }
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

function resolveBaselinePath({ cwd = process.cwd(), baselinePath } = {}) {
  const rel = baselinePath ?? DEFAULT_BASELINE_PATH;
  return path.isAbsolute(rel) ? rel : path.join(cwd, rel);
}

/**
 * Load the CRAP baseline envelope from disk.
 *
 * Returns the parsed envelope on success, or `null` when the file is missing,
 * unreadable, or structurally unusable. Version-mismatch detection is a
 * caller concern — this loader never silently rescores or mutates the
 * envelope.
 *
 * @param {{cwd?: string, baselinePath?: string}} [opts]
 * @returns {{
 *   kernelVersion: string,
 *   escomplexVersion: string,
 *   rows: Array<{file: string, method: string, startLine: number, crap: number}>,
 * }|null}
 */
export function getCrapBaseline(opts = {}) {
  const filePath = resolveBaselinePath(opts);
  if (!fs.existsSync(filePath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`[crap-utils] unable to read baseline: ${err.message}`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[crap-utils] baseline is not valid JSON: ${err.message}`);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  if (typeof parsed.kernelVersion !== 'string') return null;
  if (typeof parsed.escomplexVersion !== 'string') return null;
  if (!Array.isArray(parsed.rows)) return null;
  return parsed;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    return 0;
  });
}

function canonicalizeRow(row) {
  return {
    crap: row.crap,
    file: row.file,
    method: row.method,
    startLine: row.startLine,
  };
}

function canonicalizeEnvelope(envelope) {
  const ordered = {};
  ordered.$schema = envelope.$schema ?? SCHEMA_REF;
  ordered.escomplexVersion = envelope.escomplexVersion;
  ordered.kernelVersion = envelope.kernelVersion;
  ordered.rows = sortRows(envelope.rows).map(canonicalizeRow);
  return ordered;
}

/**
 * Project rich scan rows onto the minimal baseline row shape and assemble an
 * envelope ready for `saveCrapBaseline`.
 *
 * @param {{
 *   rows: Array<{file: string, method: string, startLine: number, crap: number|null}>,
 *   escomplexVersion: string,
 *   kernelVersion?: string,
 * }} params
 */
export function buildBaselineEnvelope({
  rows,
  escomplexVersion,
  kernelVersion = KERNEL_VERSION,
}) {
  if (typeof escomplexVersion !== 'string' || !escomplexVersion) {
    throw new TypeError('buildBaselineEnvelope: escomplexVersion is required');
  }
  const scored = (rows ?? []).filter(
    (r) => typeof r?.crap === 'number' && Number.isFinite(r.crap),
  );
  return {
    $schema: SCHEMA_REF,
    escomplexVersion,
    kernelVersion,
    rows: scored.map((r) => ({
      crap: r.crap,
      file: r.file,
      method: r.method,
      startLine: r.startLine,
    })),
  };
}

/**
 * Serialize an envelope to disk with deterministic ordering.
 *
 * Rows are sorted by `(file, startLine, method)`, top-level and row keys are
 * alphabetized, and the file terminates with a trailing newline — so a
 * re-save of the same logical envelope is byte-identical across runs and
 * platforms.
 *
 * @param {object} envelope
 * @param {{cwd?: string, baselinePath?: string}} [opts]
 */
export function saveCrapBaseline(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new TypeError('saveCrapBaseline: envelope must be an object');
  }
  const canonical = canonicalizeEnvelope(envelope);
  const filePath = resolveBaselinePath(opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(canonical, null, 2)}\n`);
}

/**
 * Scan `targetDirs` for JS files, score each method via the CRAP kernel, and
 * return enriched rows plus skip counters. Does not write to disk.
 *
 * Files without a coverage entry are skipped when `requireCoverage` is `true`
 * (the default); methods whose coverage cannot be resolved are always
 * skipped from the returned rows so the baseline never contains
 * partially-scored entries. Both counters surface for reporting.
 *
 * @param {{
 *   targetDirs: string[],
 *   coverage: object|null,
 *   requireCoverage?: boolean,
 *   cwd?: string,
 * }} params
 * @returns {{
 *   rows: Array<{
 *     file: string,
 *     method: string,
 *     startLine: number,
 *     cyclomatic: number,
 *     coverage: number,
 *     crap: number,
 *   }>,
 *   scannedFiles: number,
 *   skippedFilesNoCoverage: number,
 *   skippedMethodsNoCoverage: number,
 * }}
 */
export function scanAndScore({
  targetDirs,
  coverage,
  requireCoverage = true,
  cwd = process.cwd(),
}) {
  if (!Array.isArray(targetDirs)) {
    throw new TypeError('scanAndScore: targetDirs must be an array');
  }
  const files = [];
  for (const dir of targetDirs) {
    const abs = path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
    scanDirectory(abs, files);
  }
  files.sort();

  const rows = [];
  let scannedFiles = 0;
  let skippedFilesNoCoverage = 0;
  let skippedMethodsNoCoverage = 0;

  for (const abs of files) {
    const relPath = path.relative(cwd, abs).replace(/\\/g, '/');
    scannedFiles += 1;
    const hasFile = hasCoverageFor(coverage, relPath);
    if (requireCoverage && !hasFile) {
      skippedFilesNoCoverage += 1;
      continue;
    }
    const entry = hasFile ? findCoverageEntry(coverage, relPath) : null;
    let source;
    try {
      source = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const methodRows = calculateCrapForSource(source, entry);
    for (const mr of methodRows) {
      if (mr.crap === null || mr.coverage === null) {
        skippedMethodsNoCoverage += 1;
        continue;
      }
      rows.push({
        file: relPath,
        method: mr.method,
        startLine: mr.startLine,
        cyclomatic: mr.cyclomatic,
        coverage: mr.coverage,
        crap: mr.crap,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    return 0;
  });

  return {
    rows,
    scannedFiles,
    skippedFilesNoCoverage,
    skippedMethodsNoCoverage,
  };
}
