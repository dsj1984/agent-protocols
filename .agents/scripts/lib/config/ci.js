/**
 * `delivery.ci` accessor + framework defaults — Story #4356 (Epic #4355).
 *
 * Surviving knobs: `watch` tunes the merge/CI watch poll loop; `autoMerge`
 * (default `"trust-ci"`) selects the merge posture — `"trust-ci"` merges once
 * required checks pass, `"strict"` additionally requires a clean review gate.
 *
 * Story #5096 added `blockOnAdvisoryFailure` (default `true`) and
 * `advisoryAllowlist` (default `[]`). GitHub native auto-merge waits on
 * REQUIRED contexts only, so a red ADVISORY gate would otherwise be merged
 * straight past; these knobs own mandrel's side of that decision. Set
 * `blockOnAdvisoryFailure: false` to restore the pre-#5096 behaviour verbatim,
 * or list a job name in `advisoryAllowlist` to exempt just that one.
 *
 * Retired (no production readers on v2 Story-only delivery): `earlyPr`
 * (Epic early-PR warmup) and `requireChecks` (AutomergePredicate escape hatch
 * whose listener was never landed).
 */

export const CI_DELIVERY_DEFAULTS = Object.freeze({
  autoMerge: 'trust-ci',
  blockOnAdvisoryFailure: true,
  advisoryAllowlist: Object.freeze([]),
});

/**
 * Read the merged `delivery.ci` block, applying framework defaults for any
 * field the operator omitted. Accepts the full resolved config, the bare
 * delivery bag, or the bare ci bag. The `watch` sub-block is passed through
 * as-is (undefined when unset) so consumers apply their own poll-loop
 * defaults; only the scalar knobs carry framework defaults here.
 *
 * @param {object | null | undefined} config
 * @returns {{ autoMerge: 'trust-ci' | 'strict', watch: object | undefined }}
 */
export function getCiDelivery(config) {
  const ci = config?.delivery?.ci ?? config?.ci ?? config ?? {};
  return {
    autoMerge:
      ci.autoMerge === 'trust-ci' || ci.autoMerge === 'strict'
        ? ci.autoMerge
        : CI_DELIVERY_DEFAULTS.autoMerge,
    blockOnAdvisoryFailure:
      typeof ci.blockOnAdvisoryFailure === 'boolean'
        ? ci.blockOnAdvisoryFailure
        : CI_DELIVERY_DEFAULTS.blockOnAdvisoryFailure,
    advisoryAllowlist: Array.isArray(ci.advisoryAllowlist)
      ? ci.advisoryAllowlist.filter(
          (entry) => typeof entry === 'string' && entry,
        )
      : [...CI_DELIVERY_DEFAULTS.advisoryAllowlist],
    watch:
      ci.watch && typeof ci.watch === 'object' ? { ...ci.watch } : undefined,
  };
}
