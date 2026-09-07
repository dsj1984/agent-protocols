/**
 * plan-run-labels/reap.js — the cohort label's end of life (Story #5189).
 *
 * `plan-persist` mints one `plan-run::<id>` label per run so the Stories one
 * plan authored stay filterable in the GitHub UI. That is load-bearing while
 * any Story in the cohort is open, and inert the moment they are all closed —
 * but nothing expressed the second half, so the vocabulary grew one label per
 * persist forever. A consumer repository measured 235 `plan-run::` labels out
 * of 313 total; past that a paged label listing stops seeing the labels that
 * sort after the pile, and every list-then-create caller starts failing.
 *
 * This module is the **one decision engine** behind both surfaces that act on
 * that end of life: the per-Story close tail (automatic, incremental) and
 * `prune-plan-run-labels.js` (manual, whole-repository). Keeping the decision
 * here rather than in either caller is what stops the two from disagreeing
 * about when a label is spent.
 *
 * **The decision.** A cohort label is reapable only when it carries at least
 * one issue and every issue carrying it is closed. The "at least one" clause
 * is the subtle half: a label carrying *zero* issues is indistinguishable from
 * one an in-flight persist has just minted before creating its Stories, and
 * deleting it would break that run. So a zero-issue label is reported under an
 * `unreferenced` reason and reaped only under an explicit opt-in — a default
 * sweep is safe to run concurrently with a persist.
 *
 * **Never load-bearing.** Both surfaces treat a reap failure as a warning.
 * Label hygiene is a chore; nothing downstream reads the cohort label as an
 * input (see `PLAN_RUN_LABEL_PREFIX`'s own docblock), so a failed delete costs
 * a stale label and nothing else.
 *
 * @module lib/orchestration/plan-run-labels/reap
 * @see Story #5189
 */

import { PLAN_RUN_LABEL_PREFIX } from '../plan-persist/story-ops.js';

/**
 * Why a cohort label was — or was not — judged reapable. One reason per
 * label, so a `--json` report is auditable without re-deriving anything.
 *
 * - `all-closed`   — carries issues, every one closed. Reapable.
 * - `open-stories` — at least one issue still open. Not reapable, ever.
 * - `unreferenced` — carries no issues at all. Reapable only under the
 *   explicit opt-in, because an in-flight persist looks exactly like this.
 */
export const REAP_REASONS = Object.freeze({
  ALL_CLOSED: 'all-closed',
  OPEN_STORIES: 'open-stories',
  UNREFERENCED: 'unreferenced',
});

/**
 * Is `name` a plan-run cohort label?
 *
 * The prefix is imported from `plan-persist/story-ops.js` rather than
 * re-declared: minting and reaping must not be able to drift onto two
 * different strings, which is exactly the failure a copied literal invites.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
function isPlanRunLabel(name) {
  return typeof name === 'string' && name.startsWith(PLAN_RUN_LABEL_PREFIX);
}

/**
 * Project an arbitrary label collection onto the sorted, de-duplicated set of
 * cohort label names. Accepts either bare strings (a ticket's `labels[]`) or
 * `{ name }` rows (the label listing port), so both callers hand this whatever
 * their own read returned.
 *
 * @param {Array<string|{ name?: string }>} [names]
 * @returns {string[]}
 */
function selectCohortLabels(names) {
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = typeof raw === 'string' ? raw : raw?.name;
    if (isPlanRunLabel(name)) seen.add(name);
  }
  return [...seen].sort();
}

/**
 * Decide one cohort label.
 *
 * Reads through `listIssuesByLabel({ state: 'all' })` — the paginating read
 * port — so the verdict is never a function of how many issues fit on one API
 * page. `state` is compared case-insensitively against `closed` and anything
 * else counts as open: an unknown state must never be read as "safe to
 * delete".
 *
 * @param {{ provider: object, label: string, includeUnreferenced?: boolean }} args
 * @returns {Promise<{
 *   label: string,
 *   reapable: boolean,
 *   reason: string,
 *   issueCount: number,
 *   openIssues: number[],
 * }>}
 */
async function decideCohortLabel({
  provider,
  label,
  includeUnreferenced = false,
}) {
  const result = await provider.listIssuesByLabel({
    state: 'all',
    labels: label,
  });
  const issues = Array.isArray(result) ? result : [];
  const open = issues.filter(
    (issue) => String(issue?.state ?? '').toLowerCase() !== 'closed',
  );
  if (issues.length === 0) {
    return {
      label,
      reapable: includeUnreferenced === true,
      reason: REAP_REASONS.UNREFERENCED,
      issueCount: 0,
      openIssues: [],
    };
  }
  if (open.length > 0) {
    return {
      label,
      reapable: false,
      reason: REAP_REASONS.OPEN_STORIES,
      issueCount: issues.length,
      openIssues: open
        .map((issue) => issue?.number)
        .filter((n) => Number.isInteger(n)),
    };
  }
  return {
    label,
    reapable: true,
    reason: REAP_REASONS.ALL_CLOSED,
    issueCount: issues.length,
    openIssues: [],
  };
}

/**
 * Decide a set of cohort labels.
 *
 * Sequential on purpose. The whole-repository sweep can face hundreds of
 * labels, and a fan-out over a shared REST budget buys wall-clock at the cost
 * of the one property an operator auditing a pile actually needs: a
 * deterministic, label-ordered report.
 *
 * @param {{
 *   provider: object,
 *   labels: Array<string|{ name?: string }>,
 *   includeUnreferenced?: boolean,
 * }} args
 * @returns {Promise<Array<object>>} one decision per cohort label, name-sorted.
 */
async function evaluateCohortLabels({
  provider,
  labels,
  includeUnreferenced = false,
}) {
  const decisions = [];
  for (const label of selectCohortLabels(labels)) {
    decisions.push(
      await decideCohortLabel({ provider, label, includeUnreferenced }),
    );
  }
  return decisions;
}

/**
 * Decide, then (unless `check`) delete.
 *
 * A delete that throws is recorded in `failed[]` and warned about rather than
 * propagated: one unreachable label must not abandon the rest of a sweep, and
 * on the close path it must not touch the land. A delete the provider reports
 * as a no-op (`deleted: false` — the label was already gone) is still a
 * success; that is what makes a re-run idempotent.
 *
 * @param {{
 *   provider: object,
 *   labels: Array<string|{ name?: string }>,
 *   includeUnreferenced?: boolean,
 *   check?: boolean,
 *   onWarn?: ((message: string) => void)|null,
 * }} args
 * @returns {Promise<{
 *   check: boolean,
 *   decisions: Array<object>,
 *   reapable: string[],
 *   deleted: Array<{ label: string, existed: boolean }>,
 *   failed: Array<{ label: string, detail: string }>,
 * }>}
 */
async function reapCohortLabels({
  provider,
  labels,
  includeUnreferenced = false,
  check = false,
  onWarn = null,
}) {
  const decisions = await evaluateCohortLabels({
    provider,
    labels,
    includeUnreferenced,
  });
  const reapable = decisions.filter((d) => d.reapable).map((d) => d.label);
  const deleted = [];
  const failed = [];
  if (check !== true) {
    for (const label of reapable) {
      try {
        const outcome = await provider.deleteLabel(label);
        deleted.push({ label, existed: outcome?.deleted !== false });
      } catch (err) {
        const detail = String(err?.message ?? err);
        failed.push({ label, detail });
        onWarn?.(`could not delete cohort label "${label}": ${detail}`);
      }
    }
  }
  return { check: check === true, decisions, reapable, deleted, failed };
}

/**
 * The automatic surface's entry point: reap the cohort labels carried by the
 * Story that just closed.
 *
 * The Story's own label set comes from `getTicket` (labels are immutable for
 * this purpose, so a cached snapshot is fine); every *state* judgment comes
 * from the fresh `listIssuesByLabel` read inside {@link decideCohortLabel}, so
 * a primed ticket cache cannot make a still-open sibling look closed.
 *
 * A Story whose own issue has not yet registered as closed — the merge webhook
 * that fires `Closes #<id>` is not instantaneous — simply reports
 * `open-stories` and is left alone. Deferring is the safe direction, and the
 * manual sweep is the backstop that collects whatever a race leaves behind.
 *
 * @param {{
 *   storyId: number,
 *   provider: object,
 *   includeUnreferenced?: boolean,
 *   onWarn?: ((message: string) => void)|null,
 * }} args
 * @returns {Promise<object>} the {@link reapCohortLabels} envelope, plus
 *   `evaluated` — how many cohort labels the Story carried.
 */
export async function reapPlanRunLabelsForStory({
  storyId,
  provider,
  includeUnreferenced = false,
  onWarn = null,
}) {
  const ticket = await provider.getTicket(storyId);
  const labels = selectCohortLabels(ticket?.labels);
  if (labels.length === 0) {
    return {
      evaluated: 0,
      check: false,
      decisions: [],
      reapable: [],
      deleted: [],
      failed: [],
    };
  }
  const outcome = await reapCohortLabels({
    provider,
    labels,
    includeUnreferenced,
    onWarn,
  });
  return { evaluated: labels.length, ...outcome };
}

/**
 * The manual surface's entry point: sweep every cohort label in the repository.
 *
 * Reads the whole label vocabulary through the paginating listing port and
 * projects it onto the cohort axis here, so the sweep is bounded by what the
 * repository actually holds rather than by an API page size.
 *
 * @param {{
 *   provider: object,
 *   includeUnreferenced?: boolean,
 *   check?: boolean,
 *   onWarn?: ((message: string) => void)|null,
 * }} args
 * @returns {Promise<object>} the {@link reapCohortLabels} envelope, plus
 *   `totalLabels` (whole vocabulary) and `evaluated` (the cohort slice).
 */
export async function sweepCohortLabels({
  provider,
  includeUnreferenced = false,
  check = false,
  onWarn = null,
}) {
  const all = await provider.listLabels();
  const rows = Array.isArray(all) ? all : [];
  const labels = selectCohortLabels(rows);
  const outcome = await reapCohortLabels({
    provider,
    labels,
    includeUnreferenced,
    check,
    onWarn,
  });
  return { totalLabels: rows.length, evaluated: labels.length, ...outcome };
}

/**
 * Test-only surface. The five helpers below compose the two exported entry
 * points (`reapPlanRunLabelsForStory`, `sweepCohortLabels`) and have no
 * production consumer outside this module, so exporting each one individually
 * would advertise five API surfaces nothing imports — and `dead-exports
 * --production` correctly reports each as dead. They are still worth unit
 * testing per arm, which is what this barrel is for; it follows the same
 * `__testing` idiom `git-probes.js` and `source-classifier.js` use.
 */
export const __testing = {
  isPlanRunLabel,
  selectCohortLabels,
  decideCohortLabel,
  evaluateCohortLabels,
  reapCohortLabels,
};
