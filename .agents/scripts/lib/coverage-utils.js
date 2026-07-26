import fs from 'node:fs';

const COVERAGE_INDEX = Symbol('coverage-utils.coverage-index');
const ENTRY_INDEX = Symbol('coverage-utils.entry-index');

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
 * Build a single-pass index over a parsed `coverage-final.json` map.
 *
 * Returns `{map, byNormalizedSuffix}` where `byNormalizedSuffix` is a
 * `Map<string, object>` keyed by the POSIX-normalized form of each original
 * key. Lookups that need exact-equality or `/`-bounded suffix matching
 * consult that Map without re-enumerating `Object.keys(map)` on every call.
 *
 * @param {object|null} map
 * @returns {{map: object|null, byNormalizedSuffix: Map<string, object>}}
 */
export function buildCoverageIndex(map) {
  const byNormalizedSuffix = new Map();
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const key of Object.keys(map)) {
      byNormalizedSuffix.set(normalizeSep(key), map[key]);
    }
  }
  return { map, byNormalizedSuffix };
}

function getCoverageIndex(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const cached = map[COVERAGE_INDEX];
  if (cached) return cached;
  const idx = buildCoverageIndex(map);
  Object.defineProperty(map, COVERAGE_INDEX, {
    value: idx,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return idx;
}

/**
 * Locate the coverage entry for a repo-relative path.
 *
 * `coverage-final.json` keys are typically absolute, platform-specific paths,
 * while callers pass POSIX-ish repo-relative strings. Match by exact equality
 * or by `/`-bounded suffix so we tolerate both Windows and POSIX producers.
 * If two distinct keys both end with the same `/`-bounded suffix (duplicate
 * basenames in different trees), the suffix is ambiguous — return null
 * rather than picking the first iteration-order hit and silently scoring
 * the wrong file.
 */
function findFileEntry(map, relPath) {
  if (!map || !relPath) return null;
  const suffix = stripLeadingDotSlash(normalizeSep(relPath));
  if (!suffix) return null;
  const idx = getCoverageIndex(map);
  if (!idx) return null;
  const direct = idx.byNormalizedSuffix.get(suffix);
  if (direct !== undefined) return direct ?? null;
  const needle = `/${suffix}`;
  let match = null;
  for (const [norm, entry] of idx.byNormalizedSuffix) {
    if (!norm.endsWith(needle)) continue;
    if (match !== null) return null; // ambiguous suffix — refuse to guess
    match = entry ?? null;
  }
  return match;
}

export { findFileEntry as findCoverageEntry };

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
 * Build a per-entry index that turns method-coverage lookups from
 * `O(fnCount + statementCount)` per call into `O(method-line-span)`.
 *
 * - `fnByStartLine`: maps either `decl.start.line` or `loc.start.line` to the
 *   raw `fnMap` entry — so callers may key by the escomplex `lineStart`
 *   (which can match either, depending on producer).
 * - `fnLocByStartLine`: same keying, value is `{fnStart, fnEnd}` derived once.
 * - `fnRanges`: every function's `{fnStart, fnEnd, declLine}` triple, used by
 *   the containment / nearest-decl fallbacks when exact-line keying misses.
 * - `statementsByLine`: `Map<line, {total, covered}>` so range scans don't
 *   re-walk the full statement map.
 *
 * @param {object|null} entry One inner value from a `coverage-final.json` map.
 */
export function buildEntryIndex(entry) {
  const fnByStartLine = new Map();
  const fnLocByStartLine = new Map();
  const fnRanges = [];
  const statementsByLine = new Map();
  if (!entry || typeof entry !== 'object') {
    return { fnByStartLine, fnLocByStartLine, fnRanges, statementsByLine };
  }
  const fnMap = entry.fnMap ?? {};
  const statementMap = entry.statementMap ?? {};
  const statementHits = entry.s ?? {};

  for (const fnId of Object.keys(fnMap)) {
    const f = fnMap[fnId];
    const declLine = f?.decl?.start?.line;
    const locLine = f?.loc?.start?.line;
    const fnStart = locLine ?? declLine ?? null;
    const fnEnd = f?.loc?.end?.line ?? null;
    const loc = { fnStart, fnEnd };
    if (typeof declLine === 'number' && !fnByStartLine.has(declLine)) {
      fnByStartLine.set(declLine, f);
      fnLocByStartLine.set(declLine, loc);
    }
    if (typeof locLine === 'number' && !fnByStartLine.has(locLine)) {
      fnByStartLine.set(locLine, f);
      fnLocByStartLine.set(locLine, loc);
    }
    if (fnStart !== null && fnEnd !== null) {
      fnRanges.push({
        fnStart,
        fnEnd,
        declLine: typeof declLine === 'number' ? declLine : fnStart,
      });
    }
  }

  for (const stmtId of Object.keys(statementMap)) {
    const stmt = statementMap[stmtId];
    const sLine = stmt?.start?.line;
    if (typeof sLine !== 'number') continue;
    let bucket = statementsByLine.get(sLine);
    if (!bucket) {
      bucket = { total: 0, covered: 0 };
      statementsByLine.set(sLine, bucket);
    }
    bucket.total += 1;
    if ((statementHits[stmtId] ?? 0) > 0) bucket.covered += 1;
  }

  return { fnByStartLine, fnLocByStartLine, fnRanges, statementsByLine };
}

/**
 * How far from a `fnMap` declaration line a method start may sit and still
 * be considered the same function.
 *
 * Even after remapping to original-source coordinates (Story #4775), a
 * method's start and istanbul's `decl.start.line` do not always agree on the
 * token: escomplex anchors on the function node, istanbul on the declaration
 * it instruments, and a decorator, a leading `export`, or a multi-line
 * parameter list puts them one line apart. One line of slack absorbs that
 * without letting an unrelated neighbouring function be claimed.
 */
const DECL_MATCH_WINDOW = 1;

/**
 * Resolve the `{fnStart, fnEnd}` range of the function a method start line
 * belongs to, in the coordinate system of the coverage entry.
 *
 * Three strategies, most precise first:
 *
 *   1. **Exact** — the line keys a `fnMap` `decl.start.line` or
 *      `loc.start.line`. This is the pre-#4775 behaviour and still wins, so
 *      every already-resolving row keeps its exact prior value.
 *   2. **Containment** — the innermost function whose `loc` range contains
 *      the line. Smallest span wins, so a nested callback is preferred over
 *      the enclosing function that also contains the line.
 *   3. **Nearest declaration** — the closest `decl` line within
 *      `DECL_MATCH_WINDOW`, which absorbs the ±1 token disagreement between
 *      escomplex's method start and istanbul's declaration line.
 *
 * Returns `null` when none of the three finds a function — the caller
 * surfaces that as "no data" rather than "tested zero times."
 *
 * @param {{fnByStartLine: Map, fnLocByStartLine: Map, fnRanges: Array}} idx
 * @param {number} startLine
 * @returns {{fnStart: number, fnEnd: number}|null}
 */
function resolveFnRangeForLine(idx, startLine) {
  if (typeof startLine !== 'number') return null;
  if (idx.fnByStartLine.has(startLine)) {
    const loc = idx.fnLocByStartLine.get(startLine);
    if (loc && loc.fnStart !== null && loc.fnEnd !== null) return loc;
  }
  const ranges = idx.fnRanges ?? [];
  let innermost = null;
  let innermostSpan = Number.POSITIVE_INFINITY;
  for (const range of ranges) {
    if (startLine < range.fnStart || startLine > range.fnEnd) continue;
    const span = range.fnEnd - range.fnStart;
    if (span < innermostSpan) {
      innermostSpan = span;
      innermost = range;
    }
  }
  if (innermost) return { fnStart: innermost.fnStart, fnEnd: innermost.fnEnd };

  let nearest = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const range of ranges) {
    const dist = Math.abs(range.declLine - startLine);
    if (dist > DECL_MATCH_WINDOW) continue;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = range;
    }
  }
  if (nearest) return { fnStart: nearest.fnStart, fnEnd: nearest.fnEnd };
  return null;
}

function getEntryIndex(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cached = entry[ENTRY_INDEX];
  if (cached) return cached;
  const idx = buildEntryIndex(entry);
  Object.defineProperty(entry, ENTRY_INDEX, {
    value: idx,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return idx;
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
 * `startLine` MUST be in the coverage entry's own (original-source)
 * coordinate system. Callers scoring transpiled TypeScript remap escomplex's
 * transpiled `lineStart` first — see `transpileIfNeeded`'s `withLineMap`
 * option (Story #4775). Matching is exact-then-containment-then-nearest-decl;
 * see `resolveFnRangeForLine`.
 *
 * The first call on a given entry builds and caches a per-entry index via a
 * non-enumerable Symbol property; consecutive method lookups in the same
 * file pay the build cost exactly once.
 *
 * @param {object|null} entry One inner value from a `coverage-final.json` map.
 * @param {number} startLine The method's start line, in entry coordinates.
 * @returns {number|null}
 */
export function coverageForMethodInEntry(entry, startLine) {
  if (!entry || typeof entry !== 'object') return null;
  const idx = getEntryIndex(entry);
  const range = resolveFnRangeForLine(idx, startLine);
  if (!range) return null;
  const { fnStart, fnEnd } = range;

  let total = 0;
  let covered = 0;
  for (let line = fnStart; line <= fnEnd; line += 1) {
    const bucket = idx.statementsByLine.get(line);
    if (!bucket) continue;
    total += bucket.total;
    covered += bucket.covered;
  }

  if (total === 0) return 0;
  return covered / total;
}

/**
 * Look up per-method coverage in a full coverage map.
 *
 * @param {object|null} map Parsed `coverage-final.json`.
 * @param {string} relPath Repo-relative path of the source file.
 * @param {number} startLine The method's start line, in entry coordinates.
 * @returns {number|null} Coverage in [0, 1], or null when the file or method
 *   is absent.
 */
export function coverageByMethod(map, relPath, startLine) {
  const entry = findFileEntry(map, relPath);
  if (!entry) return null;
  return coverageForMethodInEntry(entry, startLine);
}
