/**
 * child-exec.js — the one child-process execution surface (Story #5009).
 *
 * Every synchronous and asynchronous child this framework spawns runs through
 * this module. It owns exactly three policies, and nothing else:
 *
 *   1. **The stdout ceiling.** `MAX_BUFFER_BYTES` is defined here and nowhere
 *      else. Node's child-process runners default `maxBuffer` to 1 MB and
 *      *kill* the child on overflow — `status: null`, `signal: 'SIGTERM'`,
 *      `error.code: 'ENOBUFS'` — so the call fails for a reason that has
 *      nothing to do with the command. That failure class has shipped
 *      operator-visible breakage more than once (Story #4914's committed
 *      baseline read at 1,178,910 bytes; Story #4948's `git push` relaying a
 *      2,166,643-byte `pre-push` envelope, which reddened `phase: push` on
 *      every Story close while the gates themselves were green). Both were
 *      fixed one call site at a time. This module is why there is no third.
 *   2. **Shell-free argv.** `shell: false` on every invocation, so no argument
 *      is ever shell-interpolated (`rules/security-baseline.md` § Output &
 *      Rendering). Callers pass argv tokens; they cannot pass a command line.
 *   3. **Result and error normalisation.** {@link spawnCapture} collapses the
 *      `spawnSync` return into `{ status, stdout, stderr }` with a non-null
 *      status and trimmed streams; {@link formatChildFailure} renders the one
 *      failure-message shape so a thrown child error reads the same wherever
 *      it came from.
 *
 * Every wrapper takes an optional `run` — the injected child-process runner —
 * so a module keeps its own test seam (`git-base.js`'s `__setSpawnRunner`,
 * `git-utils.js`'s `__setGitRunners`, the `run` / `spawn` parameters threaded
 * through the audit-baselines engine) while still delegating buffer, shell and
 * error policy here. Omit it and the real Node runner is used.
 *
 * **Do not re-import `node:child_process` in new modules.**
 * `tests/enforcement/child-process-imports.test.js` captures the current set
 * of direct importers and fails on any addition outside that allowlist.
 *
 * @module lib/child-exec
 */

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

/** One mebibyte, so the ceilings below read as the units they are quoted in. */
const MIB = 1024 * 1024;

/**
 * The stdout ceiling every child in this framework runs under — the single
 * definition of the constant.
 *
 * Deliberately **not** exported. Every wrapper below applies it as its
 * default, so a call site gets the ceiling by importing the wrapper rather
 * than by importing (and possibly forgetting) a number. The only bound a
 * caller ever names explicitly is one that is deliberately *different* —
 * today that is {@link INTERCEPTOR_MAX_BUFFER_BYTES} and nothing else.
 *
 * 64 MiB is not a fresh guess: it is the bound Stories #4914 and #4948 already
 * settled on independently for the git read and git push paths, and the value
 * `run-test-profile.js`, `audit-baselines/trend.js` and
 * `audit-baselines/weights.js` had hand-copied. `maxBuffer` caps a buffer, it
 * does not reserve one, so a generous ceiling costs nothing on the calls that
 * print two lines.
 *
 * @type {number}
 */
const MAX_BUFFER_BYTES = 64 * MIB;

/**
 * The deliberately *lower* ceiling the friction interceptor spawns arbitrary
 * operator commands under (`diagnose-friction.js`).
 *
 * This one is a reported policy bound, not an overflow guard: when it fires,
 * the interceptor records `executionMaxBuffer` on the friction row and tells
 * the operator to quieten the command rather than split it (Story #4915).
 * Raising it to {@link MAX_BUFFER_BYTES} would change that emitted row, so it
 * stays where it was — but it is defined here, alongside the ceiling it is
 * deliberately different from, rather than hand-copied into the interceptor.
 *
 * @type {number}
 */
export const INTERCEPTOR_MAX_BUFFER_BYTES = 10 * MIB;

/**
 * Merge caller options over this module's fixed policy.
 *
 * `maxBuffer` is applied **last** so a caller's spread cannot silently drop it
 * back to Node's 1 MB default — the only way to change the ceiling is to pass
 * `maxBuffer` explicitly, which the two named constants above exist for.
 *
 * @param {{ encoding: string }} defaults - Runner-specific defaults.
 * @param {object} rest      - Caller options (`cwd`, `env`, `stdio`, …).
 * @param {number} maxBuffer - Resolved stdout ceiling.
 * @returns {object}
 */
function childOptions(defaults, rest, maxBuffer) {
  return { ...defaults, shell: false, ...rest, maxBuffer };
}

/**
 * Run a child synchronously via `execFileSync`, returning whatever the runner
 * returns (a UTF-8 string under the default encoding). **Throws** on a
 * non-zero exit, exactly like `execFileSync` — callers that treat failure as a
 * recoverable state want {@link spawnCapture} instead.
 *
 * @param {string}   file   - Executable name (never a shell command line).
 * @param {string[]} args   - Argv tokens.
 * @param {object}   [opts] - `cwd` / `env` / `stdio` / `encoding`, plus:
 * @param {Function} [opts.run]       - Injected runner; defaults to `execFileSync`.
 * @param {number}   [opts.maxBuffer] - Override the ceiling; defaults to {@link MAX_BUFFER_BYTES}.
 * @returns {string}
 */
export function execFileCapture(file, args, opts = {}) {
  const { run = execFileSync, maxBuffer = MAX_BUFFER_BYTES, ...rest } = opts;
  return run(file, args, childOptions({ encoding: 'utf8' }, rest, maxBuffer));
}

/** Promisified `execFile` — the default runner for {@link execFileCaptureAsync}. */
const execFileAsync = promisify(execFile);

/**
 * The asynchronous sibling of {@link execFileCapture}. Resolves to
 * `{ stdout, stderr }` and rejects on a non-zero exit.
 *
 * @param {string}   file   - Executable name.
 * @param {string[]} args   - Argv tokens.
 * @param {object}   [opts] - As {@link execFileCapture}; `run` defaults to a
 *   promisified `execFile`.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function execFileCaptureAsync(file, args, opts = {}) {
  const { run = execFileAsync, maxBuffer = MAX_BUFFER_BYTES, ...rest } = opts;
  return run(file, args, childOptions({ encoding: 'utf8' }, rest, maxBuffer));
}

/**
 * Run a child synchronously via `spawnSync`, returning the runner's **raw**
 * result. Never throws on a non-zero exit.
 *
 * Use this when the caller needs the untouched result — untrimmed `stdout`
 * (file contents, TAP output), a `status` of `null` that must stay `null`
 * (`git show`'s 128-vs-killed split), or `result.error`. Callers that only
 * want a normalised `{ status, stdout, stderr }` should use
 * {@link spawnCapture}.
 *
 * @param {string}   file   - Executable name.
 * @param {string[]} args   - Argv tokens.
 * @param {object}   [opts] - As {@link execFileCapture}; `run` defaults to `spawnSync`.
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function spawnChild(file, args, opts = {}) {
  const { run = spawnSync, maxBuffer = MAX_BUFFER_BYTES, ...rest } = opts;
  return run(
    file,
    args,
    childOptions({ encoding: 'utf-8', stdio: 'pipe' }, rest, maxBuffer),
  );
}

/**
 * {@link spawnChild} with the result normalised: `status` is coerced to `1`
 * when the child did not exit normally (so no caller can read a `null` status
 * as success — `process.exit(null)` exits 0), and both streams are coerced to
 * trimmed strings.
 *
 * @param {string}   file   - Executable name.
 * @param {string[]} args   - Argv tokens.
 * @param {object}   [opts] - As {@link spawnChild}.
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function spawnCapture(file, args, opts = {}) {
  const result = spawnChild(file, args, opts);
  return {
    status: result?.status ?? 1,
    stdout: (result?.stdout ?? '').toString().trim(),
    stderr: (result?.stderr ?? '').toString().trim(),
  };
}

/**
 * The one failure-message shape for a child that exited non-zero.
 *
 * `status` is rendered verbatim — a `null` prints as `status=null`, which is
 * the diagnostic: it means the child was killed (buffer overflow, timeout,
 * signal) rather than having reported an exit code of its own.
 *
 * @param {object} failure
 * @param {string} failure.label    - What was being attempted, e.g. `readBaseFromGit: git show main:x`.
 * @param {number|null} failure.status - Raw child exit status.
 * @param {unknown} [failure.stderr]   - Raw stderr; coerced and trimmed.
 * @returns {string}
 */
export function formatChildFailure({ label, status, stderr }) {
  const detail = (stderr ?? '').toString().trim();
  return `${label} failed (status=${status}): ${detail}`;
}
