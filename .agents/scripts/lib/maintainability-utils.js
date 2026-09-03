import fs from 'node:fs';
import path from 'node:path';
import { Minimatch } from 'minimatch';
import { canonicalise as canonicalisePath } from './baselines/path-canon.js';
import { POOL_SERIAL_THRESHOLD, runOnPool } from './cpu-pool.js';
import { Logger } from './Logger.js';
import { scoreFile } from './maintainability-engine.js';
import { isScored, reportUnscorable } from './maintainability-unscorable.js';
import { isScorableSourceFile } from './source-extensions.js';

const MAINTAINABILITY_WORKER_URL = new URL(
  './workers/maintainability-worker.js',
  import.meta.url,
);

// Pool-vs-serial cutover — single-sourced in cpu-pool.js (see the
// POOL_SERIAL_THRESHOLD docstring for the tuning rationale).
const SERIAL_THRESHOLD = POOL_SERIAL_THRESHOLD;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'temp',
  '.worktrees',
  'coverage',
  '.next',
]);

/**
 * Compiled-matcher cache for `isIgnoredByGlobs`, keyed on the pattern list.
 *
 * `minimatch(path, glob)` re-parses `glob` into an AST on every call, so the
 * scan was paying O(files × globs) glob *compilations* to answer O(files ×
 * globs) glob *matches* — 12–17 ms over the 619-file tree against 0.5 ms
 * once the patterns are compiled (Story #5109). The number of distinct
 * pattern lists in a process is tiny (one per gate), and each list is
 * config-derived and immutable, so an unbounded `Map` keyed on the joined
 * patterns is bounded in practice.
 *
 * Each entry also memoises the per-path verdict. The baseline gates ask the
 * same question about the same path many times over — `crap.json` carries
 * thousands of method rows spread over a few hundred files, and the evaluate
 * phase filters every row — so the second and later asks about a path cost a
 * `Map` lookup instead of a globstar walk. Both caches are keyed on
 * config-derived, immutable inputs, and both are bounded by the tree the
 * process is scanning.
 *
 * `\u0000` is the join separator because it cannot occur in a glob, so two
 * different lists cannot collide onto one key.
 *
 * @type {Map<string, {matchers: import('minimatch').Minimatch[], verdicts: Map<string, boolean>}>}
 */
const IGNORE_MATCHER_CACHE = new Map();

/**
 * Compile (once) the `Minimatch` instances for a pattern list, alongside the
 * per-path verdict memo that shares their lifetime.
 *
 * Non-string patterns are dropped rather than compiled — `minimatch()` would
 * have thrown on them, and the functional call site never fed it any, so
 * dropping preserves the observable result set.
 *
 * @param {string[]} ignoreGlobs
 * @returns {{matchers: import('minimatch').Minimatch[], verdicts: Map<string, boolean>}}
 */
function ignoreMatcherEntry(ignoreGlobs) {
  const key = ignoreGlobs.join('\u0000');
  let entry = IGNORE_MATCHER_CACHE.get(key);
  if (entry) return entry;
  entry = {
    matchers: ignoreGlobs
      .filter((g) => typeof g === 'string')
      .map((g) => new Minimatch(g, { dot: true })),
    verdicts: new Map(),
  };
  IGNORE_MATCHER_CACHE.set(key, entry);
  return entry;
}

/**
 * Test whether an absolute (or repo-relative) file path matches any of the
 * configured `ignoreGlobs`. This is the single source of truth for how the
 * maintainability scorer decides a file is ignored: both the full-scope
 * directory walk (`scanDirectory` below) and the diff-scope file-list path
 * in `refresh-service.js` MUST funnel through it so an `ignoreGlobs`-listed
 * file is excluded identically in both scopes (a diff-scope refresh that
 * skipped this check would let an ignored file poison the `rollup["*"].min`
 * floor — see `buildDefaultMaintainabilityScorer`).
 *
 * Matching mirrors `scanDirectory`: the path is reduced to a canonicalised,
 * POSIX, repo-relative form and tested against each glob with minimatch's
 * `{ dot: true }` so dot-prefixed roots like `.agents/` match. The patterns
 * are compiled at most once per distinct list (see `IGNORE_MATCHER_CACHE`);
 * the matched set is identical to the functional `minimatch()` call this
 * replaced, which is what the `gate-scan-fast-path` test pins over the real
 * configured `ignoreGlobs`.
 *
 * @param {string} filePath absolute or relative path to the source file
 * @param {string[]} ignoreGlobs minimatch patterns; empty/absent is a no-op
 * @param {string} [cwd] root for repo-relative resolution; defaults to cwd
 * @returns {boolean} true when the file matches at least one ignore glob
 */
/**
 * Reduce an absolute-or-relative path to the canonicalised, POSIX,
 * repo-relative form the ignore patterns are written against.
 *
 * @param {string} filePath
 * @param {string} matchCwd
 * @returns {string}
 */
function canonicalRelPath(filePath, matchCwd) {
  const absFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(matchCwd, filePath);
  const rawRel = path.relative(matchCwd, absFilePath).replace(/\\/g, '/');
  return canonicalisePath(rawRel);
}

/**
 * Answer "does this path match any of the entry's patterns", consulting and
 * populating the entry's verdict memo.
 *
 * Split out of `isIgnoredByGlobs` rather than inlined: the memo's
 * hit/miss test is a branch, and folding it into the caller pushed that
 * function from cyclomatic 4 to 5 — over the per-method CRAP contract the
 * pre-push preview enforces. The lookup belongs beside the cache it reads
 * anyway, and the hot function keeps a flat shape.
 *
 * @param {{matchers: import('minimatch').Minimatch[], verdicts: Map<string, boolean>}} entry
 * @param {string} relPath Canonicalised, POSIX, repo-relative path.
 * @returns {boolean}
 */
function memoisedIgnoreVerdict(entry, relPath) {
  const memoised = entry.verdicts.get(relPath);
  if (memoised !== undefined) return memoised;
  const verdict = entry.matchers.some((m) => m.match(relPath));
  entry.verdicts.set(relPath, verdict);
  return verdict;
}

export function isIgnoredByGlobs(filePath, ignoreGlobs = [], cwd) {
  if (!Array.isArray(ignoreGlobs) || ignoreGlobs.length === 0) return false;
  const matchCwd = cwd ?? process.cwd();
  return memoisedIgnoreVerdict(
    ignoreMatcherEntry(ignoreGlobs),
    canonicalRelPath(filePath, matchCwd),
  );
}

/**
 * Recursively scans a directory for JS/TS source files, selecting them by
 * the shared `SCORABLE_SOURCE_EXTENSIONS` set (`source-extensions.js`) so the
 * walk, the coverage-freshness check and the close-validation CRAP projection
 * cannot drift apart. Directories listed
 * in `IGNORED_DIRS` (including `coverage` and `.next`, added in 5.29.0
 * to skip vitest's istanbul HTML scaffolding and Next.js build output)
 * are skipped.
 *
 * @param {string} dir
 * @param {string[]} fileList
 * @param {{ ignoreGlobs?: string[], cwd?: string }} [opts]
 *   `ignoreGlobs` — minimatch patterns matched against the canonicalised
 *   repo-relative path of each discovered file. Files whose path matches
 *   any pattern are excluded before scoring. Absent/empty is a no-op.
 *   `cwd` — root used to compute repo-relative paths for glob matching;
 *   defaults to `process.cwd()` when omitted.
 * @returns {string[]}
 */
export function scanDirectory(dir, fileList = [], opts = {}) {
  const { ignoreGlobs = [], cwd: optsCwd } = opts;
  const matchCwd = optsCwd ?? process.cwd();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return fileList;
    throw err;
  }

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanDirectory(filePath, fileList, opts);
      }
    } else if (entry.isFile() && isScorableSourceFile(entry.name)) {
      if (isIgnoredByGlobs(filePath, ignoreGlobs, matchCwd)) {
        continue;
      }
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Calculates maintainability scores for a list of file paths.
 *
 * Each file's transpile-then-analyze unit is dispatched to a
 * worker_threads pool whose width `runOnPool` resolves. Workers
 * are recycled across files so TypeScript loads at most once per
 * worker. The pool is bypassed for batches of fewer than
 * `SERIAL_THRESHOLD` files because spawn overhead dominates at small
 * sizes — the in-process path matches the pre-pool serial behaviour
 * byte-for-byte.
 *
 * Output is sorted by relative file path so the returned object is
 * insertion-order-stable regardless of which worker happened to
 * finish first. Files that fail to read/transpile/parse are dropped
 * from the result (matching the pre-pool log-and-continue contract);
 * worker-side per-item failures surface as a `null` score that is
 * filtered out before assembly.
 *
 * A file the kernel cannot analyse is also dropped — a phantom `mi: 0` row
 * poisons the rollup — but it is **reported** on the way out, with the
 * kernel's own error text, and the count is summarised at the end of the run.
 * Silently omitting these is what let a file sit unmeasured indefinitely: the
 * scorer emitted no row, so no amount of re-seeding could ever produce one,
 * and nothing said so.
 *
 * @param {string[]} paths
 * @param {{serialThreshold?: number}} [opts] `serialThreshold` overrides the
 *   pool-vs-serial cutover for this call only. Production callers omit it;
 *   the parity tests use it to drive the pooled path on a small fixture set
 *   rather than materialising 256 files to clear the cutover.
 * @returns {Promise<Record<string, number>>}
 */
export async function calculateAll(paths, opts = {}) {
  const serialThreshold = Number.isFinite(opts?.serialThreshold)
    ? opts.serialThreshold
    : SERIAL_THRESHOLD;
  const cwd = process.cwd();
  const indexed = paths.map((p) => ({
    abs: p,
    relPath: path.relative(cwd, p).replace(/\\/g, '/'),
  }));

  let perFile;
  if (indexed.length < serialThreshold) {
    perFile = indexed.map(({ abs, relPath }) => {
      try {
        return { relPath, ...scoreFile(abs) };
      } catch (err) {
        Logger.error(
          `[Maintainability] Failed to process ${abs}: ${err.message}`,
        );
        return { relPath, score: null };
      }
    });
  } else {
    const results = await runOnPool(
      MAINTAINABILITY_WORKER_URL,
      indexed.map((e) => e.abs),
    );
    perFile = results.map((r, i) => {
      const { abs, relPath } = indexed[i];
      if (!r || r.__cpuPoolError) {
        Logger.error(
          `[Maintainability] Worker pool error for ${abs}: ${r?.message ?? 'unknown'}`,
        );
        return { relPath, score: null };
      }
      if (r.score === null && r.error) {
        Logger.error(`[Maintainability] Failed to process ${abs}: ${r.error}`);
      }
      return { relPath, ...r };
    });
  }

  perFile.sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );

  reportUnscorable(perFile);

  const scores = {};
  for (const { relPath, score } of perFile.filter(isScored)) {
    scores[relPath] = score;
  }
  return scores;
}
