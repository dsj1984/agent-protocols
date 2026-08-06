/**
 * review-providers/mi-exemptions.js — the maintainability gate's exemption list,
 * as the native review provider reads it.
 *
 * `delivery.quality.gates.maintainability.ignoreGlobs` is the one declared
 * answer to "which files is the maintainability index meaningless for" —
 * declarative schema blobs, generated code, vendored trees. Every other MI
 * consumer already honours it: the baseline writer excludes those files
 * (`update-maintainability-baseline.js`), so the `check-baselines.js` ratchet
 * and the pre-merge MI advisory never see them either.
 *
 * `review-providers/native.js` did not, and the split produced a live
 * contradiction on Story #5007 / PR #5022: the ratchet PASSED while the review
 * lens raised a **critical blocker** on three exempted
 * `config-settings-schema*.js` modules in the same close run. Because a critical
 * finding halts `single-story-close.js` before auto-merge, the only way to land
 * legitimate work was to merge the PR by hand. A gate that must be
 * hand-bypassed to ship is not a gate.
 *
 * This module is that reconciliation, kept separate from the provider so the
 * exemption concern has one home and the provider keeps one reason to change.
 */

import { getQuality } from '../../config/quality.js';
import { resolveConfig } from '../../config-resolver.js';
import { isIgnoredByGlobs } from '../../maintainability-utils.js';

/**
 * Read `delivery.quality.gates.maintainability.ignoreGlobs` so a review's
 * maintainability dimension scores the same file set the ratchet does.
 *
 * Best-effort and total. A config that cannot be resolved yields `[]`, which
 * scores every changed JS file. That direction is deliberate: degrading to
 * "score everything" can only produce an advisory the operator must read,
 * whereas degrading to "score nothing" would silently retire the dimension.
 *
 * @param {{ resolveConfigFn?: typeof resolveConfig, getQualityFn?: typeof getQuality }} [deps]
 * @returns {string[]} minimatch patterns; `[]` when unset or unresolvable.
 */
export function resolveMaintainabilityIgnoreGlobs({
  resolveConfigFn = resolveConfig,
  getQualityFn = getQuality,
} = {}) {
  try {
    const globs = getQualityFn(resolveConfigFn())?.maintainability?.ignoreGlobs;
    return Array.isArray(globs) ? globs.slice() : [];
  } catch {
    return [];
  }
}

/**
 * Pure: split a changed-file list into the set to score and the set the
 * maintainability gate exempts.
 *
 * Matching funnels through `maintainability-utils.js#isIgnoredByGlobs` — the
 * declared single source of truth for how the MI scorer decides a file is
 * ignored — so an exempted file is excluded here by exactly the same rule that
 * kept it out of the baseline. Re-implementing the match with a local
 * `minimatch` call is what let the two surfaces disagree in the first place.
 *
 * Module-local: {@link scopeMaintainabilityFiles} is the single door, and its
 * `scored` / `ignored` split is where this behaviour is observable.
 *
 * @param {string[]} files
 * @param {string[]} ignoreGlobs
 * @param {string} cwd root for repo-relative glob resolution
 * @returns {{ scored: string[], ignored: string[] }}
 */
function partitionByIgnoreGlobs(files, ignoreGlobs, cwd) {
  if (!Array.isArray(ignoreGlobs) || ignoreGlobs.length === 0) {
    return { scored: files, ignored: [] };
  }
  const scored = [];
  const ignored = [];
  for (const relPath of files) {
    if (isIgnoredByGlobs(relPath, ignoreGlobs, cwd)) ignored.push(relPath);
    else scored.push(relPath);
  }
  return { scored, ignored };
}

/**
 * Render the operator-facing notice naming the files the gate exempted, or
 * `null` when nothing was exempted so the caller can `if` past the log call.
 *
 * The notice exists because silence is ambiguous: an operator reading a review
 * that says nothing about three changed schema modules cannot tell "scored and
 * healthy" from "never scored".
 *
 * Module-local: reached through {@link scopeMaintainabilityFiles}'s `notice`.
 *
 * @param {string[]|undefined} ignoredFiles
 * @returns {string|null}
 */
function formatExemptionNotice(ignoredFiles) {
  const files = Array.isArray(ignoredFiles) ? ignoredFiles : [];
  if (files.length === 0) return null;
  return (
    `[native-review] Maintainability: ${files.length} changed file(s) exempt via ` +
    `delivery.quality.gates.maintainability.ignoreGlobs — not scored: ${files.join(', ')}.`
  );
}

/**
 * Resolve the exemption list and split a review's changed-file set into the
 * paths whose maintainability should be scored and the paths the gate exempts.
 *
 * This is the one door the native provider uses: it keeps the resolve → match →
 * report sequence here rather than spread across the provider, so the provider
 * carries no knowledge of how an exemption is decided.
 *
 * @param {string[]} changedFiles
 * @param {{
 *   cwd: string,
 *   resolveIgnoreGlobsFn?: typeof resolveMaintainabilityIgnoreGlobs,
 * }} opts
 * @returns {{ scored: string[], ignored: string[], notice: string|null }}
 */
export function scopeMaintainabilityFiles(
  changedFiles,
  { cwd, resolveIgnoreGlobsFn = resolveMaintainabilityIgnoreGlobs } = {},
) {
  const { scored, ignored } = partitionByIgnoreGlobs(
    changedFiles,
    resolveIgnoreGlobsFn(),
    cwd,
  );
  return { scored, ignored, notice: formatExemptionNotice(ignored) };
}
