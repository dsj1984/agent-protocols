/**
 * coverage-capture-incremental.js — the incremental-mode capture path for
 * `coverage-capture.js` (Story #4981).
 *
 * Split into its own module (rather than added inline to the CLI shell) so
 * the Story's opt-in branch lands as new code, not a same-file expansion of
 * `runCoverageCapture`. Every collaborator is injected — no seam differs
 * from the ones `coverage-capture.js` already exposes on its `deps`
 * parameter (`.agents/rules/test-seams.md` rules 1-2, 4).
 */
import path from 'node:path';

/**
 * Run the incremental capture path when
 * `delivery.quality.gates.crap.incrementalCoverage.enabled` is true.
 *
 * **This does not shorten the capture run.** The changed-file set decides
 * *whether* to capture, never *what* the capture executes: when nothing under
 * `crap.targetDirs` changed there is no capture at all, and otherwise the
 * ordinary full `npm run test:coverage` runs. The saving that makes the mode
 * worth having is the skip; the other half is the CRAP join, which resolves
 * methods in untouched files from the committed baseline row
 * (`crap-baseline-join.js`) instead of demanding fresh coverage for them.
 *
 * Returns the process exit code when incremental mode handled the run
 * (skip, capture, or a capture failure), or `null` when the caller should
 * fall through to the full-scope path — either incremental mode is
 * disabled, or the changed-files ref could not be resolved (a
 * misconfiguration must not silently relax the gate).
 *
 * @param {{
 *   crap: object,
 *   coverage: object,
 *   args: { ref: string, cwd: string },
 *   getChangedFilesImpl: Function,
 *   filterFilesUnderTargetsImpl: Function,
 *   isCoverageFreshImpl: Function,
 *   runCaptureImpl: Function,
 *   computeContentDigestImpl: Function,
 *   writeCaptureStampImpl: Function,
 *   logger: { info: Function, warn: Function, error: Function },
 * }} opts
 * @returns {number | null}
 */
export function tryIncrementalCapture({
  crap,
  coverage,
  args,
  getChangedFilesImpl,
  filterFilesUnderTargetsImpl,
  isCoverageFreshImpl,
  runCaptureImpl,
  computeContentDigestImpl,
  writeCaptureStampImpl,
  logger,
}) {
  if (crap.incrementalCoverage?.enabled !== true) return null;

  const ref = crap.incrementalCoverage.baseRef || args.ref;
  let changed = null;
  try {
    changed = getChangedFilesImpl({ ref, cwd: args.cwd });
  } catch (err) {
    logger.warn(
      `[coverage-capture] ⚠ incremental mode: ${err?.message ?? err} — falling back to full-scope capture.`,
    );
    return null;
  }

  const scopedFiles = filterFilesUnderTargetsImpl(changed, crap.targetDirs);
  if (scopedFiles.length === 0) {
    logger.info(
      `[coverage-capture] Incremental mode: no changed files under [${crap.targetDirs.join(', ')}] vs ${ref} — skipping capture.`,
    );
    return 0;
  }

  const freshness = isCoverageFreshImpl({
    coveragePath: crap.coveragePath,
    targetDirs: crap.targetDirs,
    cwd: args.cwd,
    requireScope: 'incremental',
  });
  if (freshness.fresh) {
    logger.info(
      `[coverage-capture] Coverage at ${path.resolve(args.cwd, crap.coveragePath)} is ${freshness.reason} (incremental) — skipping capture.`,
    );
    return 0;
  }

  logger.info(
    `[coverage-capture] Incremental mode: ${scopedFiles.length} changed file(s) under [${crap.targetDirs.join(', ')}] — capturing…`,
  );
  const code = runCaptureImpl({
    cwd: args.cwd,
    timeoutMs: coverage?.timeoutMs,
    log: (m) => logger.info(m),
  });
  if (code !== 0) {
    logger.error(
      `[coverage-capture] ✖ npm run test:coverage exited ${code}. Fix failing tests or coverage-threshold breaches before re-running the CRAP gate.`,
    );
    return code;
  }

  const digest = computeContentDigestImpl(args.cwd, crap.targetDirs);
  if (
    digest &&
    writeCaptureStampImpl({
      cwd: args.cwd,
      coveragePath: crap.coveragePath,
      digest,
      scope: 'incremental',
      files: scopedFiles,
      ref,
    })
  ) {
    logger.info(
      '[coverage-capture] Wrote content-digest capture stamp (incremental scope).',
    );
  }
  return code;
}
