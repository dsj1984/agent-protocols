/**
 * lib/baselines/diff-scope-cli.js — shared `--diff-scope <ref>` parser for
 * the manual baseline-update CLIs (Story #1974 / Task #1986, Epic #1943).
 *
 * `update-coverage-baseline.js`, `update-crap-baseline.js`,
 * `update-maintainability-baseline.js`, and `update-mutation-baseline.js`
 * all accept an opt-in `--diff-scope <ref>` flag. When supplied, the
 * baseline write narrows to files changed since `<ref>` (resolved via
 * `git diff --name-only <ref>...HEAD`). Out-of-scope rows are preserved
 * verbatim from the prior on-disk baseline via the per-kind `mergeRows`.
 *
 * When the flag is absent, the CLIs behave exactly as they did before
 * #1974 — full regenerate + write — preserving operator workflows that
 * intentionally rewrite the whole baseline.
 *
 * The helper is shared to keep the flag's contract identical across the
 * four scripts: same argv parser, same git invocation, same forward-slash
 * path normalisation. The four CLIs differ only in how they pipe the
 * resolved scope through to their writer.
 *
 * Preservation is only as good as the prior it reads, so the prior reader
 * dispatches on the kind's own row contract (see `PRIOR_ROW_METRIC_FIELDS`)
 * rather than defaulting every non-`crap` kind to the maintainability row
 * shape — that default filtered every duplication row out and left the
 * writer with nothing to preserve (Story #4937).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { parseNameOnlyStdout } from '../changed-files.js';
import { getKindModule } from './kernel.js';

/**
 * Parse `--diff-scope <ref>` (and the legacy `--diff-scope=<ref>` form)
 * from an argv slice. Returns `null` when the flag is absent. Throws a
 * TypeError when the flag is supplied without a value.
 *
 * Pure; no I/O.
 *
 * @param {string[]} argv
 * @returns {string | null}
 */
export function parseDiffScopeFlag(argv = []) {
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--diff-scope') {
      const next = argv[i + 1];
      if (typeof next !== 'string' || next.length === 0) {
        throw new TypeError(
          '[diff-scope-cli] --diff-scope requires a non-empty <ref> argument',
        );
      }
      return next;
    }
    if (typeof tok === 'string' && tok.startsWith('--diff-scope=')) {
      const ref = tok.slice('--diff-scope='.length);
      if (ref.length === 0) {
        throw new TypeError(
          '[diff-scope-cli] --diff-scope= requires a non-empty <ref> value',
        );
      }
      return ref;
    }
  }
  return null;
}

/**
 * Resolve the file footprint of `git diff --name-only <ref>...HEAD`.
 * Returns a `Set<string>` of repo-relative paths with forward-slash
 * normalisation. Returns an empty Set when the diff is empty or git
 * exits non-zero (best-effort; a missing-ref or corrupt repo is the
 * operator's signal to inspect the working tree).
 *
 * The `spawnImpl` seam exists for unit tests — production callers omit it.
 *
 * @param {{ ref: string, cwd?: string, spawnImpl?: typeof spawnSync }} args
 * @returns {Set<string>}
 */
export function resolveDiffScopeFiles({
  ref,
  cwd = process.cwd(),
  spawnImpl = spawnSync,
} = {}) {
  if (typeof ref !== 'string' || ref.length === 0) return new Set();
  const res = spawnImpl('git', ['diff', '--name-only', `${ref}...HEAD`], {
    cwd,
    encoding: 'utf8',
  });
  if (!res || res.status !== 0) return new Set();
  return new Set(parseNameOnlyStdout(res.stdout));
}

/**
 * Convenience: parse `--diff-scope` and resolve files in one call.
 * Returns `null` when the flag is absent (so the caller can branch on
 * "scope was opted in?"); otherwise returns
 * `{ ref, files: Set<string>, scope: { mode: 'diff', files } }` ready to
 * pass into `writer.write({ scope })`.
 *
 * @param {{ argv: string[], cwd?: string, spawnImpl?: typeof spawnSync }} args
 * @returns {{ ref: string, files: Set<string>, scope: {mode: 'diff', files: Set<string>} } | null}
 */
export function resolveDiffScope({ argv, cwd, spawnImpl } = {}) {
  const ref = parseDiffScopeFlag(argv);
  if (ref === null) return null;
  const files = resolveDiffScopeFiles({ ref, cwd, spawnImpl });
  return { ref, files, scope: { mode: 'diff', files } };
}

// Read + JSON-parse a baseline file. Returns `null` on any I/O or parse
// failure (the caller treats "no prior" the same as "unreadable prior").
function readBaselineJson(absBaselinePath, fsImpl) {
  let raw;
  try {
    raw = fsImpl.readFileSync(absBaselinePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Numeric metric fields a canonical baseline row carries, per kind.
 *
 * The table is closed over the same kind set as the gates schema
 * (`lib/config/gates/index.js`) and the writer's kernel registry, and it
 * exists because every kind keys its rows on a *different* metric: only
 * maintainability rows carry `mi`, only duplication rows carry
 * `percentage`, only bundle-size rows carry `rawKb`/`gzippedKb`, and so
 * on. Reading a prior through another kind's field filters every row out
 * and hands the writer an empty `prior` — which silently disables epsilon
 * damping and makes a `--diff-scope` write truncate the baseline to the
 * files in the diff, because preservation has no prior rows to carry
 * forward (Story #4937).
 *
 * Row identity is deliberately NOT duplicated here — it is read from the
 * kind module's own `keyField` (`path` / `route` / `bundle`), so the
 * reader and the writer cannot drift apart on what identifies a row.
 */
const PRIOR_ROW_METRIC_FIELDS = Object.freeze({
  'bundle-size': Object.freeze(['rawKb', 'gzippedKb']),
  coverage: Object.freeze(['lines', 'branches', 'functions']),
  crap: Object.freeze(['crap']),
  duplication: Object.freeze(['percentage']),
  lighthouse: Object.freeze([
    'performance',
    'accessibility',
    'bestPractices',
    'seo',
  ]),
  lint: Object.freeze(['errorCount', 'warningCount']),
  maintainability: Object.freeze(['mi']),
  mutation: Object.freeze(['score']),
});

/**
 * Build the prior-row predicate for `kind`: a row survives when it carries
 * a non-empty identity key under the kind's own `keyField` and a finite
 * number on every metric field the kind's `compare` / `applyEpsilon`
 * inspect.
 *
 * Throws on a kind with no declared row contract. Failing loudly is the
 * point: the defect this replaces was a `return` fall-through that gave
 * every unlisted kind the maintainability filter, so an unmodelled kind
 * read as "prior is empty" instead of "prior is unreadable".
 *
 * Pure; no I/O.
 *
 * @param {string} kind
 * @returns {(row: object) => boolean}
 */
export function priorRowPredicateFor(kind) {
  const metricFields = PRIOR_ROW_METRIC_FIELDS[kind];
  if (!metricFields) {
    throw new Error(
      `[diff-scope-cli] no prior-row contract registered for kind "${kind}" ` +
        `(known: ${Object.keys(PRIOR_ROW_METRIC_FIELDS).join(', ')})`,
    );
  }
  const { keyField } = getKindModule(kind);
  return (row) =>
    Boolean(row) &&
    typeof row[keyField] === 'string' &&
    row[keyField].length > 0 &&
    metricFields.every((field) => Number.isFinite(row[field]));
}

/**
 * Read + parse the prior baseline at `absBaselinePath` and return its
 * canonical `rows[]` array, filtered through `kind`'s own row contract (as
 * expected by the per-kind `mergeRows` / `applyEpsilon` helpers from Story
 * #1974). Returns `null` when the file is absent, malformed, or missing a
 * `rows[]` envelope; the caller treats `null` as "skip the merge"
 * (regression-fail-safe — equivalent to a fresh write).
 *
 * Pure-by-design (file I/O through the injected `fsImpl` seam).
 *
 * @param {{ kind: string, absBaselinePath: string, fsImpl?: typeof fs }} args
 * @returns {Array<object> | null}
 */
export function readPriorBaselineRows({ kind, absBaselinePath, fsImpl = fs }) {
  const predicate = priorRowPredicateFor(kind);
  const parsed = readBaselineJson(absBaselinePath, fsImpl);
  if (!parsed || !Array.isArray(parsed.rows)) return null;
  return parsed.rows.filter(predicate);
}

/**
 * Compose the full Story #1974 write-side payload for a manual baseline
 * CLI: read prior rows, resolve `--diff-scope`, log the scope decision,
 * and return the four params (`prior`, `epsilon`, `scope`, plus the
 * resolved `diffScope` for caller-side logging) that the CLI feeds into
 * `writer.write({ ..., prior, epsilon, scope })`.
 *
 * Returns a flat record so each CLI can spread it into the writer call.
 *
 * The `fsImpl` / `spawnImpl` seams exist so the composed payload can be
 * exercised hermetically — production callers omit both.
 *
 * @param {{
 *   kind: string,
 *   absBaselinePath: string,
 *   epsilon: number,
 *   argv?: string[],
 *   cwd?: string,
 *   logger?: { info?: (msg: string) => void },
 *   logTag: string,
 *   fsImpl?: typeof fs,
 *   spawnImpl?: typeof spawnSync,
 * }} args
 * @returns {{
 *   prior: Array<object> | undefined,
 *   epsilon: number | undefined,
 *   scope: {mode: 'diff', files: Set<string>} | undefined,
 *   diffScope: {ref: string, files: Set<string>, scope: object} | null,
 * }}
 */
export function buildWriterScopeArgs({
  kind,
  absBaselinePath,
  epsilon,
  argv = process.argv.slice(2),
  cwd,
  logger,
  logTag,
  fsImpl = fs,
  spawnImpl = spawnSync,
}) {
  const prior = readPriorBaselineRows({ kind, absBaselinePath, fsImpl });
  const diffScope = resolveDiffScope({ argv, cwd, spawnImpl });
  if (diffScope && logger?.info) {
    logger.info(
      `${logTag} --diff-scope ${diffScope.ref}: ${diffScope.files.size} file(s) in scope; out-of-scope rows preserved verbatim.`,
    );
  }
  return {
    prior: prior ?? undefined,
    epsilon: prior ? epsilon : undefined,
    scope: diffScope?.scope,
    diffScope,
  };
}
