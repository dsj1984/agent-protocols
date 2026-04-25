/**
 * Build the `[file, args, options]` tuple to hand `child_process.spawn` so we
 * can launch `claude` without tripping DEP0190 or the Node 20+ Windows policy
 * that refuses to spawn `.cmd` shims without `shell: true`.
 *
 * POSIX: direct binary execution, args array, `shell: false`.
 * Windows: cmd.exe-quoted single command line, `shell: true`. Passing a single
 * pre-quoted string (not args-array + shell) is the documented escape hatch
 * from DEP0190 and is the only shape that correctly delivers an arg like
 * `/sprint-execute 386` to the child as a single token — the regression that
 * silently false-positived Wave 1 of Epic #380.
 *
 * Extracted from `.agents/scripts/epic-runner.js` so it can be imported by
 * tests (story-419 hardening suite) and by the pre-wave `SpawnSmokeTest`.
 */
/**
 * Pure: cmd.exe-quote a single token. Wraps in double-quotes (doubling
 * embedded `"` per cmd.exe rules) when the token contains shell-meaningful
 * characters; otherwise returns it unchanged. Exported so it gets coverage
 * on every platform — the previously-inline arrow function only ran on
 * Windows, which made the CRAP baseline platform-skewed.
 */
export function cmdQuote(token) {
  return /[\s"&|<>^]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}

/**
 * Pure: build the cmd.exe-quoted command line `buildClaudeSpawn` hands to
 * `child_process.spawn` under Windows. Exported alongside `cmdQuote` so the
 * Windows assembly path is testable on Linux too.
 */
export function buildWindowsCmdline(bin, argv) {
  return [bin, ...argv].map(cmdQuote).join(' ');
}

/**
 * `platform` is injectable so the CRAP coverage scan exercises both
 * branches on every host (defaults to `process.platform`). Without the
 * injection point, the win32 branch was uncovered on Linux CI and the
 * non-win32 branch was uncovered on Windows local — producing platform-
 * skewed CRAP baselines that flapped on every cross-platform run.
 */
export function buildClaudeSpawn(argv, options, platform = process.platform) {
  const bin = process.env.CLAUDE_BIN ?? 'claude';
  if (platform === 'win32') {
    return {
      file: buildWindowsCmdline(bin, argv),
      args: [],
      options: { ...options, shell: true },
    };
  }
  return { file: bin, args: argv, options: { ...options, shell: false } };
}
