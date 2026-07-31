/**
 * maintainability-unscorable.js — reporting for files the MI kernel cannot
 * analyse.
 *
 * A file the kernel throws on has no maintainability index, so it gets no
 * baseline row — a phantom `mi: 0` would poison the `min`/p50 rollup and let
 * real regressions hide behind it. Dropping the row is therefore correct; doing
 * it *silently* is not. Without a report, an unscorable file is
 * indistinguishable from a file nobody added yet: the scorer emits nothing, the
 * scope gate sees an absence it cannot explain, and re-seeding the baseline can
 * never produce the missing row no matter how many times it runs.
 *
 * Kept separate from `maintainability-utils.js` so the scoring path stays about
 * scoring and this stays about explaining.
 */

import { Logger } from './Logger.js';

/**
 * Report every unscorable file, then summarise.
 *
 * @param {Array<{ relPath: string, unscorable?: boolean, reason?: string|null }>} perFile
 * @returns {number} how many files were unscorable, for the caller's own use.
 */
export function reportUnscorable(perFile) {
  const unscorable = (perFile ?? []).filter((entry) => entry?.unscorable);
  if (unscorable.length === 0) return 0;

  for (const { relPath, reason } of unscorable) {
    Logger.error(
      `[Maintainability] UNSCORABLE ${relPath}: ${reason ?? 'unknown kernel failure'}`,
    );
  }
  Logger.error(
    `[Maintainability] ${unscorable.length} file(s) could not be scored and will have ` +
      'no baseline row, so the maintainability gate cannot see them. If the cause is a ' +
      'kernel AST gap, add a handler in lib/escomplex-ast-compat.js rather than an ' +
      'allowlist entry.',
  );
  return unscorable.length;
}

/**
 * Whether a per-file entry carries a real maintainability index and so belongs
 * in the baseline.
 *
 * An unscorable entry carries the sentinel score, not an index — letting it
 * through would write an `mi: 0` phantom and drag the rollup floor down with it
 * (Story #2467). `score === null` is the separate I/O-failure case.
 *
 * Tests for a *number* rather than `score !== null`, because the latter passes
 * anything absent: `undefined !== null` is true, so a missing entry or one with
 * no `score` key at all would have been treated as scored.
 *
 * @param {{ score?: number|null, unscorable?: boolean }} entry
 * @returns {boolean}
 */
export function isScored(entry) {
  return typeof entry?.score === 'number' && !entry.unscorable;
}
