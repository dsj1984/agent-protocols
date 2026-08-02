/**
 * phases/options.js — CLI / injection option parsing for
 * `single-story-close`.
 *
 * Handles the conditional param-vs-CLI branch and all flag defaults in one
 * place so the main `runSingleStoryClose` body stays focused on close
 * pipeline logic. Each `??` operator counts as a branch in escomplex; the
 * `resolveFlag` helper keeps the cyclomatic complexity tally bounded.
 */

import path from 'node:path';
import { parseMergeWatchMode, parseSprintArgs } from '../../../cli-args.js';
import { getDeliveryRouting } from '../../../config/delivery-routing.js';
import { PROJECT_ROOT } from '../../../project-root.js';
import { isOperatorMergeReason } from './auto-merge.js';

/**
 * Resolve a flag value from an explicit override or a parsed CLI arg.
 *
 * Returns `undefined` when neither is supplied — that absence is itself the
 * answer here, letting each caller below apply its own default (a `!!` coerce,
 * a config lookup, or a deliberate `undefined` passed further down). The
 * former third `defaultValue` parameter was dropped in Story #4961: no call
 * site passed it, so it documented a mode nobody used.
 *
 * @template T
 * @param {T|undefined} paramValue
 * @param {T|undefined} parsedValue
 * @returns {T|undefined}
 */
function resolveFlag(paramValue, parsedValue) {
  return paramValue ?? parsedValue;
}

/**
 * Resolve whether close lands the PR in-process (`waitForMerge`).
 *
 * Called by `runSingleStoryClose` **after** config resolution and the
 * auto-merge phase, because two of its four inputs are not knowable at
 * parse time: the resolved config (whose `cwd` this parse produces) and the
 * actual arm outcome. Resolving it here — once, where every input exists —
 * is what makes `delivery.routing.closeAndLand` governable at all.
 *
 * Precedence, highest first:
 *   1. `--no-wait-merge` / injected opt-out — always wins.
 *   2. **Operator owns the merge** (`--no-auto-merge`, or
 *      `delivery.ci.autoMerge: "strict"`): the PR was deliberately left
 *      un-armed, so there is nothing for close to land. Resting at
 *      `agent::closing` for the human IS the documented contract for both
 *      surfaces; waiting would only burn the poll budget and then block a
 *      perfectly healthy Story. An explicit `--wait-merge` cannot override
 *      this — you cannot land-in-one-close a PR you refused to arm — so the
 *      caller is told rather than silently ignored.
 *   3. Explicit `--wait-merge` / injected boolean.
 *   4. `delivery.routing.closeAndLand` (framework default `true`).
 *
 * @param {{
 *   waitForMergeExplicit?: boolean,
 *   noWaitForMerge?: boolean,
 *   config?: object|null,
 *   autoMergeReason?: string|null,
 * }} args
 * @returns {{ waitForMerge: boolean, reason: 'opt-out-flag'|'operator-merge'|'explicit-flag'|'config-close-and-land' }}
 */
export function resolveWaitForMerge({
  waitForMergeExplicit,
  noWaitForMerge = false,
  config = null,
  autoMergeReason = null,
} = {}) {
  if (noWaitForMerge) {
    return { waitForMerge: false, reason: 'opt-out-flag' };
  }
  if (isOperatorMergeReason(autoMergeReason)) {
    return { waitForMerge: false, reason: 'operator-merge' };
  }
  if (typeof waitForMergeExplicit === 'boolean') {
    return { waitForMerge: waitForMergeExplicit, reason: 'explicit-flag' };
  }
  return {
    waitForMerge: getDeliveryRouting(config).closeAndLand,
    reason: 'config-close-and-land',
  };
}

/**
 * Parse and resolve all CLI / injection options for `runSingleStoryClose`.
 *
 * `waitForMerge` is deliberately **not** resolved here — see
 * {@link resolveWaitForMerge}. This returns the raw operator intent
 * (`waitForMergeExplicit` / `noWaitForMerge`) for the runner to resolve once
 * the config and the arm outcome exist.
 *
 * @param {{ storyIdParam, cwdParam, skipValidationParam, skipSyncParam, noAutoMergeParam, waitForMergeParam, noWaitForMergeParam, maxWaitSecondsParam, mergeWatchModeParam }} raw
 * @returns {{ storyId, cwd, skipValidation, skipSync, noAutoMerge, waitForMergeExplicit, noWaitForMerge, maxWaitSeconds, mergeWatchMode }}
 */
export function parseCloseOptions({
  storyIdParam,
  cwdParam,
  skipValidationParam,
  skipSyncParam,
  noAutoMergeParam,
  waitForMergeParam,
  noWaitForMergeParam,
  maxWaitSecondsParam,
  mergeWatchModeParam,
}) {
  // An injecting caller (`storyIdParam` supplied) is not reading argv at all,
  // so there is nothing to parse and `parsed` stays empty. This used to build a
  // stand-in object that copied every `*Param` into the slot of the same name —
  // which is precisely what `resolveFlag` already does below, preferring the
  // param over the parsed slot. One expression per flag now serves both
  // callers, so a new flag is added in one place instead of two that can drift.
  const parsed = storyIdParam === undefined ? parseSprintArgs() : {};
  // Preserve undefined so resolveWaitForMerge can apply the closeAndLand
  // config default when neither flag was supplied.
  const waitForMergeExplicit = resolveFlag(
    waitForMergeParam,
    parsed.waitForMerge,
  );
  const maxWaitSeconds = resolveFlag(
    maxWaitSecondsParam,
    parsed.maxWaitSeconds,
  );
  return {
    storyId: resolveFlag(storyIdParam, parsed.storyId),
    cwd: path.resolve(cwdParam ?? parsed.cwd ?? PROJECT_ROOT),
    // `undefined` when unsupplied — the merge wait then reads
    // `delivery.mergeWatch.maxWaitSeconds`. A per-run override exists so a
    // headless caller with no host tool-invocation ceiling can keep
    // single-block semantics without editing the consumer's config.
    maxWaitSeconds:
      Number.isInteger(maxWaitSeconds) && maxWaitSeconds > 0
        ? maxWaitSeconds
        : undefined,
    // `undefined` when unsupplied — the merge wait then reads
    // `delivery.mergeWatch.mode`. The two merge-watch flags stay composable and
    // mode-agnostic: `--merge-watch-mode async` picks the posture, and an
    // explicit `--max-wait-seconds` still wins over that posture's probe cap.
    mergeWatchMode: parseMergeWatchMode(
      resolveFlag(mergeWatchModeParam, parsed.mergeWatchMode),
    ),
    skipValidation: !!resolveFlag(skipValidationParam, parsed.skipValidation),
    skipSync: !!resolveFlag(skipSyncParam, parsed.skipSync),
    noAutoMerge: !!resolveFlag(noAutoMergeParam, parsed.noAutoMerge),
    waitForMergeExplicit:
      typeof waitForMergeExplicit === 'boolean'
        ? waitForMergeExplicit
        : undefined,
    noWaitForMerge: !!resolveFlag(noWaitForMergeParam, parsed.noWaitForMerge),
  };
}
