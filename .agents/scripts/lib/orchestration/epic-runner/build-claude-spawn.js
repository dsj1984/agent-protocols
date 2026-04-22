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
export function buildClaudeSpawn(argv, options) {
  const bin = process.env.CLAUDE_BIN ?? 'claude';
  if (process.platform === 'win32') {
    const quote = (a) =>
      /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
    const cmdline = [bin, ...argv].map(quote).join(' ');
    return { file: cmdline, args: [], options: { ...options, shell: true } };
  }
  return { file: bin, args: argv, options: { ...options, shell: false } };
}
