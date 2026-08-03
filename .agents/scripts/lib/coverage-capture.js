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
import crypto from 'node:crypto';
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
 * Resolve the capture-stamp path that sits next to the coverage artifact.
 * The stamp persists the content digest of the CRAP-target sources at the
 * moment coverage was last captured, so freshness can be decided by content
 * rather than mtime (mtime churns on branch switches / checkouts even when
 * content is unchanged).
 *
 * @param {string} cwd Absolute repo root.
 * @param {string} coveragePath Repo-relative coverage artifact path.
 * @returns {string} Absolute stamp path (`<coverage-dir>/.capture-stamp.json`).
 */
export function captureStampPath(cwd, coveragePath) {
  return path.join(
    path.dirname(path.resolve(cwd, coveragePath)),
    '.capture-stamp.json',
  );
}

const SOURCE_EXT_RE = /\.(?:js|mjs)$/;

/**
 * Compute a stable content digest of the `.js`/`.mjs` sources under
 * `targetDirs`: the `git ls-files -s` listing (mode + blob SHA + path) of
 * tracked content, plus the on-disk bytes of any dirty working-tree files.
 * Checkout/branch churn leaves blob SHAs untouched, so the digest only moves
 * when content actually changes.
 *
 * Returns `null` when the digest cannot be computed (git unavailable, not a
 * repo, empty target list) so callers can fall back to the mtime heuristic.
 *
 * @param {string} cwd Absolute repo root.
 * @param {string[]} targetDirs Repo-relative directories to digest.
 * @param {{ spawnSync?: typeof spawnSync, readFileSync?: typeof fs.readFileSync }} [io]
 * @returns {string | null} Hex SHA-256 digest, or null when unavailable.
 */
export function computeContentDigest(cwd, targetDirs, io = {}) {
  const spawn = io.spawnSync ?? spawnSync;
  const readFileSync = io.readFileSync ?? fs.readFileSync;
  const dirs = (targetDirs ?? []).filter(
    (d) => typeof d === 'string' && d.length > 0,
  );
  if (dirs.length === 0) return null;

  const git = (...args) => {
    const res = spawn('git', args, { cwd, encoding: 'utf8' });
    if (res?.error || res?.status !== 0) {
      throw res?.error ?? new Error(res?.stderr || `git ${args[0]} failed`);
    }
    return res.stdout ?? '';
  };

  try {
    const hash = crypto.createHash('sha256');
    const tracked = git('ls-files', '-s', '--', ...dirs)
      .split('\n')
      .filter((line) => SOURCE_EXT_RE.test(line.trimEnd()));
    hash.update(tracked.join('\n'));

    // Dirty working-tree files are not represented by their index blob SHA,
    // so fold in their on-disk bytes (or absence) explicitly.
    const dirty = git('status', '--porcelain', '--', ...dirs)
      .split('\n')
      .filter((line) => line.length > 3);
    for (const line of dirty) {
      let file = line.slice(3).trim();
      if (file.includes(' -> ')) file = file.split(' -> ').pop();
      file = file.replace(/^"|"$/g, '');
      if (!SOURCE_EXT_RE.test(file)) continue;
      hash.update(`\0${file}\0`);
      try {
        hash.update(readFileSync(path.resolve(cwd, file)));
      } catch {
        hash.update('<absent>');
      }
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Persist the capture stamp next to the coverage artifact. Best-effort: a
 * write failure returns `false` rather than throwing — the worst case is a
 * fall back to the mtime heuristic on the next freshness check.
 *
 * `scope` / `files` / `ref` are Story #4981 additions for incremental-mode
 * capture. They are written to the stamp **only when the caller supplies
 * `scope`** — the default (full-scope) call sites never pass it, so the
 * emitted JSON stays the exact `{ digest, capturedAt }` shape byte-for-byte
 * (AC-5). `isCoverageFresh` reads `scope` back to refuse letting a scoped
 * stamp satisfy a full-scope freshness probe (AC-4).
 *
 * @param {{
 *   cwd: string,
 *   coveragePath: string,
 *   digest: string,
 *   scope?: 'full' | 'incremental',
 *   files?: string[],
 *   ref?: string,
 *   writeFileSync?: typeof fs.writeFileSync,
 * }} opts
 * @returns {boolean} True when the stamp was written.
 */
export function writeCaptureStamp({
  cwd,
  coveragePath,
  digest,
  scope,
  files,
  ref,
  writeFileSync = fs.writeFileSync,
}) {
  if (typeof digest !== 'string' || digest.length === 0) return false;
  const payload = { digest, capturedAt: new Date().toISOString() };
  if (scope !== undefined) payload.scope = scope;
  if (Array.isArray(files)) payload.files = [...files].sort();
  if (typeof ref === 'string' && ref.length > 0) payload.ref = ref;
  try {
    writeFileSync(
      captureStampPath(cwd, coveragePath),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a persisted capture stamp's digest and scope tag back into the shape
 * `isCoverageFresh` needs, applying the Story #4981 scope-asymmetry rule
 * (AC-4) in one place. Extracted so the parent function's own branching
 * stays under the cyclomatic ceiling.
 *
 * @param {{digest?: unknown, scope?: unknown} | null} stamp
 * @param {'full' | 'incremental'} requireScope
 * @returns {{ digest: string } | { scopeMismatch: true } | null} `null`
 *   means the stamp is missing/unreadable/digest-less — fall through to the
 *   mtime heuristic.
 */
function readStampForScope(stamp, requireScope) {
  if (typeof stamp?.digest !== 'string' || stamp.digest.length === 0) {
    return null;
  }
  const stampScope = stamp.scope === 'incremental' ? 'incremental' : 'full';
  if (stampScope === 'incremental' && requireScope !== 'incremental') {
    return { scopeMismatch: true };
  }
  return { digest: stamp.digest };
}

/**
 * Decide whether the existing coverage artifact is "fresh".
 *
 * Primary test (content-aware, Story #3982): when a capture stamp exists
 * next to the artifact, compare its persisted digest against the current
 * content digest of `targetDirs`. Equal digests → fresh; different → stale.
 * Branch switches and checkouts that bump mtimes without changing content
 * no longer invalidate coverage.
 *
 * Fallback (stamp absent / unreadable / digest unavailable): the original
 * mtime heuristic — artifact at least as new as the newest source file
 * under `targetDirs`. Missing files, missing target dirs, or any IO error
 * resolve to `false` so the caller captures rather than trusting stale data.
 *
 * **Scope asymmetry (Story #4981, AC-4).** A stamp written by an incremental
 * capture (`scope: 'incremental'`) only covers the files the diff touched —
 * it must never satisfy a caller that requires the full-scope guarantee
 * (`requireScope` defaults to `'full'`, matching every pre-existing caller
 * byte-for-byte). A full-scope stamp (or a legacy stamp with no `scope`
 * field, which predates this Story and is therefore full-scope by
 * construction) satisfies either probe.
 *
 * @param {{
 *   coveragePath: string,
 *   targetDirs: string[],
 *   cwd: string,
 *   requireScope?: 'full' | 'incremental',
 *   statSync?: typeof fs.statSync,
 *   readdirSync?: typeof fs.readdirSync,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   computeDigest?: typeof computeContentDigest,
 * }} opts
 * @returns {{ fresh: boolean, reason: 'missing' | 'stale' | 'fresh' | 'no-sources' | 'scope-mismatch' }}
 */
export function isCoverageFresh({
  coveragePath,
  targetDirs,
  cwd,
  requireScope = 'full',
  statSync = fs.statSync,
  readdirSync = fs.readdirSync,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  computeDigest = computeContentDigest,
}) {
  const absCoverage = path.resolve(cwd, coveragePath);
  if (!existsSync(absCoverage)) return { fresh: false, reason: 'missing' };

  const stampPath = captureStampPath(cwd, coveragePath);
  if (existsSync(stampPath)) {
    let stamp = null;
    try {
      stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    } catch {
      // Corrupt/unreadable stamp → fall through to the mtime heuristic.
    }
    const resolved = readStampForScope(stamp, requireScope);
    if (resolved?.scopeMismatch) {
      return { fresh: false, reason: 'scope-mismatch' };
    }
    if (resolved) {
      const current = computeDigest(cwd, targetDirs);
      if (typeof current === 'string' && current.length > 0) {
        return current === resolved.digest
          ? { fresh: true, reason: 'fresh' }
          : { fresh: false, reason: 'stale' };
      }
    }
  }

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
 * Narrow `changedFiles` to the subset that lives under one of `targetDirs`.
 *
 * Both inputs are forward-slash-normalised; `targetDirs` are matched as path
 * prefixes followed by `/`. Shared by `anyChangedUnderTargets` (the pre-push
 * fast-path boolean) and the incremental-coverage scope resolver (Story
 * #4981), which needs the actual file list rather than a yes/no.
 *
 * @param {string[]} changedFiles
 * @param {string[]} targetDirs
 * @returns {string[]} Forward-slash-normalised matches, in `changedFiles` order.
 */
export function filterFilesUnderTargets(changedFiles, targetDirs) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return [];
  if (!Array.isArray(targetDirs) || targetDirs.length === 0) return [];
  const norms = targetDirs
    .filter((d) => typeof d === 'string' && d.length > 0)
    .map((d) => d.replace(/\\/g, '/').replace(/\/+$/, ''));
  return changedFiles
    .map((file) => String(file).replace(/\\/g, '/'))
    .filter((f) => norms.some((dir) => f === dir || f.startsWith(`${dir}/`)));
}

/**
 * Decide whether any of `changedFiles` lives under one of `targetDirs`.
 * Used by the pre-push fast-path so we can skip the (slow) coverage capture
 * when the push touches only files outside the CRAP scoring scope.
 *
 * An empty changed-file list returns `false`.
 *
 * @param {string[]} changedFiles
 * @param {string[]} targetDirs
 * @returns {boolean}
 */
export function anyChangedUnderTargets(changedFiles, targetDirs) {
  return filterFilesUnderTargets(changedFiles, targetDirs).length > 0;
}

/**
 * Exit code surfaced when the bounded `npm run test:coverage` spawn was
 * killed by the timeout watchdog. Matches the GNU `timeout(1)` convention so
 * the close-validation caller can branch on "hang" (124) vs. "tests failed"
 * (any other non-zero status). Story #2136 / Task #2142.
 */
export const COVERAGE_TIMEOUT_EXIT_CODE = 124;

/**
 * Spawn `npm run test:coverage` in `cwd` with a bounded wall clock. Inherits
 * stdio so the operator sees the raw test output. Returns the exit status; a
 * non-zero exit means the caller should propagate the failure (a broken test
 * suite cannot be papered over by the CRAP gate).
 *
 * The `timeoutMs` budget is enforced by `spawnSync` with `killSignal:
 * 'SIGKILL'` — Node fires the signal at the budget boundary and the result
 * surfaces with `signal: 'SIGKILL'`. We translate that into the GNU
 * `timeout(1)` convention exit code 124 so callers can pattern-match a
 * runaway runner without inspecting signal names.
 *
 * `files` (Story #4981) scopes the spawn to a file list — `npm run
 * test:coverage -- <files...>`, the standard npm convention for forwarding
 * argv to the underlying script (which most test runners, including Node's
 * own, treat as positional file filters). Omitted or empty means the
 * default full-scope invocation, byte-identical to the pre-#4981 argv
 * (AC-5); a non-empty list makes the scope observable on the emitted
 * command line (AC-1).
 *
 * @param {{
 *   cwd: string,
 *   timeoutMs?: number,
 *   runner?: typeof spawnSync,
 *   log?: (m: string) => void,
 *   files?: string[] | null,
 * }} opts
 * @returns {number}
 */
export function runCapture({
  cwd,
  timeoutMs,
  runner = spawnSync,
  log = () => {},
  files = null,
} = {}) {
  const scopedFiles = Array.isArray(files) && files.length > 0 ? files : null;
  const args = [
    'run',
    'test:coverage',
    ...(scopedFiles ? ['--', ...scopedFiles] : []),
  ];
  log(`[coverage-capture] ▶ npm ${args.join(' ')}`);
  const spawnOpts = {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    killSignal: 'SIGKILL',
  };
  if (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
  ) {
    spawnOpts.timeout = timeoutMs;
  }
  const res = runner('npm', args, spawnOpts);
  // A timeout-induced kill surfaces as `signal: 'SIGKILL'` (or, on some
  // platforms, as a non-numeric status). Either signal indicates the
  // watchdog tripped — surface the GNU `timeout` convention 124 so the
  // caller can distinguish a hang from a normal test-suite failure.
  if (res?.signal === 'SIGKILL') {
    log(
      `[coverage-capture] ⏱ npm run test:coverage exceeded ${timeoutMs}ms — killed (SIGKILL). Returning exit ${COVERAGE_TIMEOUT_EXIT_CODE}.`,
    );
    return COVERAGE_TIMEOUT_EXIT_CODE;
  }
  return res.status ?? 1;
}
