/**
 * crap-preview-incremental.js — resolve `runCrapPreview`'s incremental-join
 * `scanAndScore` input (Story #4981).
 *
 * Split into its own file (rather than added inline to `preview-gates.js`)
 * so the Story's opt-in wiring lands as new code, not a same-file expansion
 * of the pre-existing preview runner.
 */
import { getChangedFiles } from '../changed-files.js';

/**
 * Resolve the `incremental` option `scanAndScore` (`crap-utils.js`) expects,
 * or `null` when incremental mode is disabled or the changed-files ref could
 * not be resolved — a resolution failure falls back to full-scope rather
 * than silently relaxing the gate.
 *
 * @param {{
 *   crap: { incrementalCoverage?: { enabled?: boolean, baseRef?: string } },
 *   diffRef: string | null,
 *   cwd: string,
 *   baselineRows: Array<object>,
 *   getChangedFilesImpl?: typeof getChangedFiles,
 * }} opts
 * @returns {{ touchedFiles: Set<string>, baselineRows: Array<object> } | null}
 */
export function resolveCrapPreviewIncremental({
  crap,
  diffRef,
  cwd,
  baselineRows,
  getChangedFilesImpl = getChangedFiles,
}) {
  if (crap.incrementalCoverage?.enabled !== true) return null;
  const baseRef = crap.incrementalCoverage.baseRef || diffRef || 'main';
  try {
    const touchedFiles = new Set(getChangedFilesImpl({ ref: baseRef, cwd }));
    return { touchedFiles, baselineRows };
  } catch {
    return null;
  }
}
