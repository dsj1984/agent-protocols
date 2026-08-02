/**
 * lib/baselines/diff-scope-cli.js — shared `--diff-scope <ref>` parser for
 * the manual baseline-update CLIs (Story #1974 / Task #1986, Epic #1943).
 *
 * `update-coverage-baseline.js`, `update-crap-baseline.js`,
 * `update-maintainability-baseline.js`, and
 * `update-duplication-baseline.js` all accept an opt-in `--diff-scope <ref>`
 * flag. When supplied, the baseline write narrows to files changed since
 * `<ref>`; out-of-scope rows are preserved verbatim from the prior on-disk
 * baseline.
 *
 * The helper is shared to keep the flag's contract identical across the four
 * scripts: one argv parser, one spelling, one error message.
 *
 * **Scope of this module, post-Story #4944.** It parses the flag and nothing
 * else. Everything downstream of the parse — resolving the changed-file set,
 * reading the prior envelope, and assembling the writer call — used to live
 * here too, in `buildWriterScopeArgs` and its helpers. Those were the
 * pre-service path; `lib/baselines/refresh-service.js` owns all of it now
 * (`resolveScope`, `readPriorEnvelope`, and the `writer.write()` handoff),
 * and `refreshBaseline()` derives its own diff via `execFile` rather than
 * `spawnSync`. `update-duplication-baseline.js` was the last caller of the
 * legacy path; when it migrated, the whole write-side half of this module
 * became unreachable and was removed rather than left shipped-but-uncalled.
 *
 * Note for anyone tracing the per-kind prior-row reader that used to live
 * here: it is gone, not relocated. The service reads the prior envelope
 * kind-agnostically (any `{ rows: [], rollup: {} }` document), so the
 * per-kind row-shape filter it needed no longer has a job to do.
 */

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
