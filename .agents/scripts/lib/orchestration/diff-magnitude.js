/**
 * lib/orchestration/diff-magnitude.js — the changed-line magnitude of a diff,
 * split into implementation and mandated-companion halves (Story #4856).
 *
 * ## Why magnitude, and why the split
 *
 * The light path's diff backstop used to bound scope with a single
 * `maxFiles: 4` ceiling. Measured against this repository's own history that
 * ceiling was wrong in both directions:
 *
 *   - **Too tight.** Of 33 real-work squash merges on `main` (excluding
 *     release-please and `chore(baselines)` automation) only 7 — 21% — touch
 *     four files or fewer; the median is 8. The framework's *own* narrow-diff
 *     scale, `DEFAULT_DIFF_WIDTH.softFiles` in `review-depth.js`, is 15.
 *   - **Blind.** A three-file, 323-line rewrite passed while a 190-file change
 *     was rejected 47× over — even though 186 of those files were tests and its
 *     implementation was 7 files.
 *
 * So the axis is **changed lines over implementation files**, and the companion
 * classes the framework itself mandates are exempt from the count: obeying
 * `rules/testing-standards.md` (test-first), the documentation a change of
 * consequence is expected to touch, and the baseline ratchets must not inflate
 * the number that then rejects the change. Re-counting those same 33 merges on implementation files alone moves
 * the four-file pass rate from 21% to 58%.
 *
 * ## Three contracts worth not rediscovering
 *
 *   1. **Additions plus deletions, never net.** A modified line counts twice
 *      (one `+`, one `-`), which is the intended weighting. Net is actively
 *      broken as a size signal: the merge retiring the planner snapshot is
 *      1119 add+del but **−803** net, so a large deletion would measure as
 *      trivial.
 *   2. **A pure rename is free.** `git diff --numstat` reports `0\t0` for one,
 *      and its path arrives in `old => new` form — normalized here to the
 *      destination so the file still counts toward the implementation tally.
 *   3. **Exemption is from *counting*, never from *risk*.** Nothing here
 *      touches sensitive-path derivation, which every caller runs over the
 *      full changed set including companions.
 *
 * Companion matching runs through the audit suite's picomatch seam as a
 * **positive** glob list negated by the caller. A `!`-prefixed picomatch
 * pattern widens a match rather than narrowing it, so expressing the
 * behavior-bearing exceptions as negations would silently exempt more than
 * intended.
 *
 * Every export is total: no throws. {@link readNumstatRows} owns the one git
 * read; everything else is pure.
 *
 * The public surface is deliberately just those two functions. The numstat
 * parse, the rename normalization, and the companion classifier are internal:
 * each is fully observable through them (a stubbed `gitSpawnFn` drives the
 * parse, an `isCompanionFn` seam drives the classification), so exporting them
 * would widen the module's contract for no caller.
 *
 * @module lib/orchestration/diff-magnitude
 */

import { matchesAnyFilePattern } from '../audit-suite/selector.js';
import { gitSpawn } from '../git-utils.js';

/**
 * Paths whose churn is a **mandated companion** of a change rather than the
 * change itself, exempt from the implementation line and file counts.
 *
 * Deliberately absent, and load-bearing in their absence: `.agentrc.json`,
 * `.agents/schemas/**`, `.github/workflows/**`, and `package.json`. Those are
 * "config" by file type but behavior by effect, and `.agents/schemas/audit-rules.json`
 * is the sensitive-path SSOT — exempting it would let a change widen the very
 * allowlist that decides whether it is risky.
 *
 * Note the anchoring: `baselines/**` is the generated baseline **data** at the
 * repository root. The baseline *schemas* under `.agents/schemas/baselines/`
 * are unanchored by this pattern and therefore still count as implementation.
 *
 * Markdown is exempt wholesale, which includes `.agents/workflows/**` and
 * `.agents/rules/**`. That is intended: rewriting a workflow contract is not
 * *effort* the way a module rewrite is, and its real guards are the close-time
 * context-budget, doc-link, and docs-reference-sync gates — none of which this
 * ceiling replaces.
 */
const COMPANION_PATH_GLOBS = Object.freeze([
  // Tests — mandated by rules/testing-standards.md's test-first discipline.
  '**/__tests__/**',
  '**/*.test.js',
  '**/*.test.mjs',
  '**/*.test.cjs',
  '**/*.test.ts',
  '**/*.test.tsx',
  'tests/**',
  'features/**',
  // Documentation — the prose a change of consequence is expected to refresh.
  'docs/**',
  '**/*.md',
  // Generated baseline data — written by the ratchets, not hand-authored.
  'baselines/**',
  // Lockfiles — regenerated wholesale; their line count means nothing.
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

/**
 * Normalize a `git diff --numstat` path field to the single file it names.
 * Rename rows arrive as `old => new` or with a braced infix
 * (`dir/{old => new}/file.js`); both resolve to the destination, so a renamed
 * implementation file still counts as one implementation file.
 *
 * Pure and total.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeNumstatPath(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return '';
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(value);
  if (braced) {
    const [, prefix, , to, suffix] = braced;
    return `${prefix}${to}${suffix}`.replace(/\/{2,}/g, '/');
  }
  const arrow = value.split(' => ');
  return (arrow.length > 1 ? arrow[arrow.length - 1] : value).trim();
}

/**
 * Parse `git diff --numstat` output into per-file rows.
 *
 * Binary rows (`-\t-\tpath`) contribute zero text lines without poisoning the
 * parse. Any line that does not match the numstat shape makes the whole result
 * untrustworthy, so the function returns `null` — the "magnitude unknown"
 * signal every caller fails closed (or fails open) on deliberately.
 *
 * Pure and total.
 *
 * @param {unknown} stdout
 * @returns {Array<{ additions: number, deletions: number, path: string }>|null}
 */
function parseNumstatRows(stdout) {
  if (typeof stdout !== 'string') return null;
  const rows = [];
  for (const line of stdout.split('\n')) {
    const trimmedEnd = line.replace(/\s+$/, '');
    if (trimmedEnd.length === 0) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(trimmedEnd);
    if (!match) return null;
    rows.push({
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      path: normalizeNumstatPath(match[3]),
    });
  }
  return rows;
}

/**
 * True when `file` is a mandated companion rather than implementation.
 *
 * Pure and total — a throwing matcher resolves to `false`, which counts the
 * file as implementation. That is the conservative direction: a
 * classification failure must never shrink the measured magnitude.
 *
 * @param {unknown} file
 * @param {{ matchFn?: typeof matchesAnyFilePattern }} [deps]
 * @returns {boolean}
 */
function isCompanionPath(file, { matchFn = matchesAnyFilePattern } = {}) {
  if (typeof file !== 'string' || file.trim() === '') return false;
  try {
    return matchFn(COMPANION_PATH_GLOBS, [file.trim()]) === true;
  } catch {
    return false;
  }
}

/**
 * Read the per-file numstat rows for the `baseRef...headRef` diff. The one
 * side-effecting function in this module.
 *
 * Total — never throws; returns `null` on any git failure or unparseable
 * output.
 *
 * @param {{
 *   baseRef?: string,
 *   headRef?: string,
 *   cwd?: string,
 *   gitSpawnFn?: typeof gitSpawn,
 * }} [args]
 * @returns {Array<{ additions: number, deletions: number, path: string }>|null}
 */
export function readNumstatRows({
  baseRef,
  headRef,
  cwd = process.cwd(),
  gitSpawnFn = gitSpawn,
} = {}) {
  if (typeof baseRef !== 'string' || baseRef.length === 0) return null;
  if (typeof headRef !== 'string' || headRef.length === 0) return null;
  try {
    const result = gitSpawnFn(
      cwd,
      'diff',
      '--numstat',
      `${baseRef}...${headRef}`,
    );
    if (!result || result.status !== 0) return null;
    return parseNumstatRows(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Summarize a diff's magnitude, splitting implementation from mandated
 * companions.
 *
 * `implFiles` is counted from `changedFiles` — the canonical
 * `git diff --name-only` enumeration produced by `change-set.js` — rather than
 * from the numstat rows, so file counting uses clean paths from the one
 * enumerator every other consumer reads. `implLines` comes from the numstat
 * rows, which is the only surface carrying line counts.
 *
 * Returns `null` when either input is unusable: the magnitude is then *unknown*,
 * which is deliberately distinct from *zero* so a caller can fail closed on the
 * absence of evidence.
 *
 * Pure and total.
 *
 * @param {{
 *   changedFiles?: unknown,
 *   rows?: unknown,
 *   isCompanionFn?: typeof isCompanionPath,
 * }} [args]
 * @returns {{
 *   implFiles: number,
 *   implLines: number,
 *   companionFiles: number,
 *   companionLines: number,
 *   totalFiles: number,
 * }|null}
 */
export function summarizeDiffMagnitude({
  changedFiles,
  rows,
  isCompanionFn = isCompanionPath,
} = {}) {
  if (!Array.isArray(changedFiles) || !Array.isArray(rows)) return null;
  const files = changedFiles.filter(
    (f) => typeof f === 'string' && f.trim() !== '',
  );

  // A classification failure resolves to "implementation" — the conservative
  // direction, since counting a companion as implementation can only ever make
  // the measured magnitude larger. Guarded here as well as inside the default
  // classifier so an injected one cannot break this function's totality.
  const isCompanion = (file) => {
    try {
      return isCompanionFn(file) === true;
    } catch {
      return false;
    }
  };

  let implFiles = 0;
  for (const file of files) {
    if (!isCompanion(file)) implFiles += 1;
  }

  let implLines = 0;
  let companionLines = 0;
  for (const row of rows) {
    const lines = (row?.additions ?? 0) + (row?.deletions ?? 0);
    if (isCompanion(row?.path)) companionLines += lines;
    else implLines += lines;
  }

  return {
    implFiles,
    implLines,
    companionFiles: files.length - implFiles,
    companionLines,
    totalFiles: files.length,
  };
}
