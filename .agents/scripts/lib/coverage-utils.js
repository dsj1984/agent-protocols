import fs from 'node:fs';

/**
 * Load and parse an istanbul/c8 `coverage-final.json` artifact.
 *
 * Returns the parsed object (keyed by absolute file path) on success, or
 * `null` when the file is missing, unreadable, non-JSON, or structurally
 * unusable. Never throws — consumers treat a null map as "no coverage
 * available" and apply their own `requireCoverage` policy.
 *
 * @param {string} coveragePath
 * @returns {object|null}
 */
export function loadCoverage(coveragePath) {
  try {
    if (!coveragePath || !fs.existsSync(coveragePath)) return null;
    const raw = fs.readFileSync(coveragePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeSep(p) {
  return String(p).replace(/\\/g, '/');
}

function stripLeadingDotSlash(p) {
  return p.replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/**
 * Locate the coverage entry for a repo-relative path.
 *
 * `coverage-final.json` keys are typically absolute, platform-specific paths,
 * while callers pass POSIX-ish repo-relative strings. Match by exact equality
 * or by `/`-bounded suffix so we tolerate both Windows and POSIX producers.
 */
function findFileEntry(map, relPath) {
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
 * Does the map contain any entry whose path matches `relPath`?
 *
 * @param {object|null} map
 * @param {string} relPath
 * @returns {boolean}
 */
export function hasCoverageFor(map, relPath) {
  return findFileEntry(map, relPath) !== null;
}

/**
 * Compute the statement-coverage ratio for a single method inside a single
 * file's coverage entry.
 *
 * The ratio is the fraction of statements whose `start.line` falls within the
 * function's `loc` range that were executed at least once. An empty range
 * returns 0. A missing / malformed entry or no matching function returns
 * `null` so the caller can distinguish "no data" from "tested zero times."
 *
 * @param {object|null} entry One inner value from a `coverage-final.json` map.
 * @param {number} startLine The escomplex `lineStart` for the method.
 * @returns {number|null}
 */
export function coverageForMethodInEntry(entry, startLine) {
  if (!entry || typeof entry !== 'object') return null;
  const fnMap = entry.fnMap ?? {};
  const statementMap = entry.statementMap ?? {};
  const statementHits = entry.s ?? {};

  let fn = null;
  for (const fnId of Object.keys(fnMap)) {
    const f = fnMap[fnId];
    const declLine = f?.decl?.start?.line;
    const locLine = f?.loc?.start?.line;
    if (declLine === startLine || locLine === startLine) {
      fn = f;
      break;
    }
  }
  if (!fn) return null;

  const fnStart = fn.loc?.start?.line ?? fn.decl?.start?.line ?? null;
  const fnEnd = fn.loc?.end?.line ?? null;
  if (fnStart === null || fnEnd === null) return null;

  let total = 0;
  let covered = 0;
  for (const stmtId of Object.keys(statementMap)) {
    const stmt = statementMap[stmtId];
    const sLine = stmt?.start?.line;
    if (typeof sLine !== 'number') continue;
    if (sLine < fnStart || sLine > fnEnd) continue;
    total += 1;
    if ((statementHits[stmtId] ?? 0) > 0) covered += 1;
  }

  if (total === 0) return 0;
  return covered / total;
}

/**
 * Look up per-method coverage in a full coverage map.
 *
 * @param {object|null} map Parsed `coverage-final.json`.
 * @param {string} relPath Repo-relative path of the source file.
 * @param {number} startLine The escomplex `lineStart` for the method.
 * @returns {number|null} Coverage in [0, 1], or null when the file or method
 *   is absent.
 */
export function coverageByMethod(map, relPath, startLine) {
  const entry = findFileEntry(map, relPath);
  if (!entry) return null;
  return coverageForMethodInEntry(entry, startLine);
}
