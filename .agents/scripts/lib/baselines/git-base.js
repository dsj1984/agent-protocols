// .agents/scripts/lib/baselines/git-base.js
//
// Story #1962 / Task #1969 — Single safe loader for base-ref baseline
// reads. Every per-kind regression CLI in Epic #1943 needs to read the
// committed baseline from a base ref (typically the Epic branch tip or
// `origin/main`) and diff it against the head's working-tree baseline.
// Routing every read through `readBaseFromGit(ref, file)` guarantees:
//
//   - One implementation of "spawn `git show <ref>:<file>`", with
//     identical argv shape, identical env scrubbing, and identical
//     error semantics. Per-kind CLIs do not get to invent their own
//     git invocations and drift apart.
//   - One LRU cache keyed by `(ref, file)`. Within a single dispatcher
//     run, the same `(ref, file)` tuple is read at most once even when
//     multiple gates need it (e.g. when scope resolution and the
//     regression compare both touch the same baseline file). The cache
//     stores the full result — including `null` for "no such file at
//     ref" — so a missing baseline does not re-spawn git on every
//     subsequent lookup.
//   - `child_process.spawn`-based execution (no shell), which is the
//     security baseline (`security-baseline.md` § Output & Rendering):
//     `ref` and `file` are passed as separate argv tokens, never
//     interpolated into a shell command.
//
// Story #5009 moved the spawn itself, the stdout ceiling and the
// failure-message shape out to `lib/child-exec.js` — the one child-process
// surface — so this module now owns only what is genuinely its own: the
// `(ref, file)` LRU, the exit-code semantics below, and the test seam. The
// `__setSpawnRunner` seam still injects a mock runner; it is threaded through
// the shared wrapper as `run` rather than calling `spawnSync` directly.
//
// Exit semantics are intentionally narrow:
//
//   - Exit 0: stdout is the file contents, returned as a UTF-8 string.
//   - Exit 128: git's "path does not exist in this revision" — the
//     loader treats this as a normal "no baseline at base ref" case
//     and returns `null`. Callers branch on `result === null` rather
//     than catching an error.
//   - Any other outcome (bad ref, corrupted repo, git binary missing, or
//     the child killed by signal so `status` is `null`): thrown so the
//     dispatcher can surface a config-error exit code rather than
//     silently treating the failure as "no baseline". A bad ref is a
//     config bug, not a missing file.
//
// That two-way split is load-bearing (Story #4914): `null` means and only
// means "path absent at ref". Callers may therefore treat a throw as a
// hard failure without having to re-diagnose it.

import { formatChildFailure, spawnChild } from '../child-exec.js';

// ---------------------------------------------------------------------------
// LRU cache. Small footprint — even a fan-out across all seven baseline
// kinds against two refs (head + base) is 14 entries. Capping at 64 keeps
// long-lived dispatcher runs (e.g. orchestrators that loop across
// multiple stories) bounded without ever evicting a hot entry in normal
// use. The cache stores `null` as a real value so missing-file lookups
// also hit on the second call.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 64;

/**
 * Injected spawn runner, or `undefined` to use the shared surface's real one.
 * Story #4914's explicit 64 MB ceiling still applies to both git reads below —
 * it is now `child-exec.js`'s `MAX_BUFFER_BYTES`, applied by `spawnChild`.
 *
 * @type {Function | undefined}
 */
let _spawnRunner;
let _cache = new Map();
let _maxEntries = DEFAULT_MAX_ENTRIES;

/**
 * Test-only seam. Lets the unit test inject a mock `spawnSync` (to
 * count invocations and assert "spawn, not exec") and a fresh cache (so
 * test order does not leak through the module-global LRU).
 *
 * Production code MUST NOT call this. The double-underscore prefix is
 * the contract.
 *
 * @param {object} [opts]
 * @param {Function} [opts.spawn]    - Mock spawnSync.
 * @param {number} [opts.maxEntries] - Override LRU capacity.
 */
export function __setSpawnRunner(opts = {}) {
  if (opts.spawn) {
    _spawnRunner = opts.spawn;
  }
  if (typeof opts.maxEntries === 'number') {
    _maxEntries = opts.maxEntries;
  }
  _cache = new Map();
}

/**
 * Reset the loader to factory defaults. Tests call this in `afterEach`
 * to keep state from leaking across files.
 */
export function __resetForTests() {
  _spawnRunner = undefined;
  _maxEntries = DEFAULT_MAX_ENTRIES;
  _cache = new Map();
}

/**
 * Internal: build the cache key. Joining with a NUL byte is cheap and
 * collision-free — neither git refs nor POSIX paths may contain NUL.
 *
 * @param {string} ref
 * @param {string} file
 * @returns {string}
 */
function cacheKey(ref, file) {
  return `${ref}\u0000${file}`;
}

/**
 * Internal: bump an entry to the most-recently-used end of the LRU. Map
 * iteration order is insertion order, so deleting and re-setting moves
 * the entry to the back.
 *
 * @param {string} key
 * @param {string | null} value
 */
function touch(key, value) {
  _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > _maxEntries) {
    // Evict the least-recently-used entry (first key in iteration).
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

/**
 * Build a child-process env that drops every `GIT_*` variable inherited
 * from the parent. Mirrors `git-utils.js#cleanGitEnv` — see that file for
 * the long-form explanation. Without this, husky-driven invocations
 * inherit the parent's `GIT_DIR` / `GIT_WORK_TREE` and end up reading
 * from the wrong worktree.
 */
function cleanGitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
}

/**
 * Read `<file>` at the given git ref. Returns the file contents as a
 * UTF-8 string when the path exists, or `null` when git reports the
 * path does not exist at the ref.
 *
 * Cached: subsequent calls with the same `(ref, file)` skip the
 * subprocess and return the cached value (including a cached `null`).
 *
 * @param {string} ref     - Any ref git understands (`HEAD`, `epic/1943`,
 *                           `origin/main`, a SHA, …).
 * @param {string} file    - Repo-relative path to the file.
 * @param {{ cwd?: string }} [opts] - Optional cwd override; defaults to
 *                                    `process.cwd()`.
 * @returns {string | null}
 */
export function readBaseFromGit(ref, file, opts = {}) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError('readBaseFromGit: ref must be a non-empty string');
  }
  if (typeof file !== 'string' || file.length === 0) {
    throw new TypeError('readBaseFromGit: file must be a non-empty string');
  }

  const key = cacheKey(ref, file);
  if (_cache.has(key)) {
    // Hot path — re-touch to refresh LRU position, but no spawn.
    const cached = _cache.get(key);
    touch(key, cached);
    return cached;
  }

  const cwd = opts.cwd ?? process.cwd();
  const spec = `${ref}:${file}`;
  const result = spawnChild('git', ['show', spec], {
    run: _spawnRunner,
    cwd,
    env: cleanGitEnv(),
  });

  // `child_process.spawnSync` returns `status: null` when the child died
  // by signal. Treat that as a hard failure rather than "no file".
  const status = result.status;
  if (status === 0) {
    const out = typeof result.stdout === 'string' ? result.stdout : '';
    touch(key, out);
    return out;
  }

  // Git uses exit 128 for "path does not exist in this revision" and a
  // handful of other "ref/path not found" cases. The stderr message
  // varies across git versions; matching on the exit code keeps us
  // version-independent and i18n-safe.
  if (status === 128) {
    touch(key, null);
    return null;
  }

  throw new Error(
    formatChildFailure({
      label: `readBaseFromGit: git show ${spec}`,
      status,
      stderr: result.stderr,
    }),
  );
}

/**
 * Read the commit subjects, within the range `<baseRef>..HEAD`, of commits
 * that touched `<file>` (Story #4731). Powers the maintainability
 * refresh-acknowledgment trigger: a `baseline-refresh:`-tagged commit in the
 * compared range that touches the maintainability baseline demotes that run's
 * head-vs-base regressions.
 *
 * Restricting the log to `-- <file>` means the returned subjects already
 * satisfy the "commit whose diff touches the baseline file" half of the
 * predicate; the caller only has to match the tag substring against each
 * subject. Runs through the same shared `spawnChild` surface and injected
 * runner as `readBaseFromGit`, so it inherits the identical env scrubbing
 * (drop inherited `GIT_*`), the same stdout ceiling, and the spawn-not-exec
 * security posture (argv tokens, `shell: false`).
 *
 * Returns an empty array whenever the range cannot be walked (missing base
 * ref, git failure, empty range) — the acknowledgment path treats "no
 * matching commit" and "could not determine" identically: the ratchet stays
 * at full strength. Not cached: the range result depends on live HEAD, which
 * the `(ref, file)` LRU key does not capture.
 *
 * @param {string} baseRef - Range base (e.g. `main`, `origin/main`, a SHA).
 * @param {string} file    - Repo-relative path to the baseline file.
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]} commit subjects, newest first; `[]` on any failure.
 */
export function readRangeSubjectsTouchingFile(baseRef, file, opts = {}) {
  if (typeof baseRef !== 'string' || baseRef.length === 0) return [];
  if (typeof file !== 'string' || file.length === 0) return [];

  const cwd = opts.cwd ?? process.cwd();
  let result;
  try {
    result = spawnChild(
      'git',
      ['log', `${baseRef}..HEAD`, '--format=%s', '--', file],
      { run: _spawnRunner, cwd, env: cleanGitEnv() },
    );
  } catch {
    return [];
  }

  if (!result || result.status !== 0) return [];
  const out = typeof result.stdout === 'string' ? result.stdout : '';
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Inspect the current cache size. Test-only — production code should
 * not reason about cache state.
 *
 * @returns {number}
 */
export function __cacheSize() {
  return _cache.size;
}
