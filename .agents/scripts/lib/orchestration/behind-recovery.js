/**
 * behind-recovery.js — the one bounded `BEHIND` → `gh pr update-branch`
 * recovery decision (Story #5006).
 *
 * Two loops watch an open PR and both must fast-forward it when GitHub
 * reports `mergeStateStatus: BEHIND`:
 *
 *   - the CI-watch loop (`pr-watch.js#watchPrToTerminal`),
 *     which probes with a synchronous `gh pr view` spawn and re-enters its
 *     poll loop after each update; and
 *   - the merge wait (`single-story-close/phases/confirm-merge.js`), which
 *     probes with an async `gh` facade and simply re-reads on the next tick.
 *
 * They had two copies of the same three-way decision — *is it BEHIND, is
 * there update budget left, did the update land* — differing only in
 * incidental ordering, which is exactly the shape that drifts. This module
 * owns the decision; the callers keep their own probe source, their own
 * timing model, and their own operator-facing wording (supplied as the
 * `on*` callbacks).
 *
 * Deliberately NOT owned here: probing `mergeStateStatus`, counting the
 * budget across iterations, and deciding what a caller does next with the
 * verdict. The helper is a single bounded step, not a loop.
 */

/**
 * The `gh pr view --json mergeStateStatus` value that licenses a recovery.
 * Module-private: both call sites reach it through {@link applyBehindUpdate},
 * so exporting it would only add a symbol the reachability ratchet scores
 * dead.
 */
const BEHIND_MERGE_STATE = 'BEHIND';

/**
 * Normalise an `updateBranch()` settlement into `{ ok, detail }`.
 *
 * Both callers' invokers signal failure differently — the merge wait's `gh`
 * facade **throws**, the watcher's `spawnSync` port **resolves** a non-zero
 * status — so both shapes are accepted: a throw is a failure, and so is a
 * resolved object carrying `ok === false`. Anything else resolved (including
 * `undefined`) is a success, which is what a facade that only throws on
 * failure returns.
 *
 * @param {() => Promise<unknown>} updateBranch
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function settleUpdate(updateBranch) {
  try {
    const result = await updateBranch();
    if (result && typeof result === 'object' && result.ok === false) {
      return { ok: false, detail: String(result.detail ?? 'update-failed') };
    }
    return { ok: true, detail: '' };
  } catch (err) {
    return { ok: false, detail: String(err?.message ?? err) };
  }
}

/**
 * Apply at most one bounded `gh pr update-branch` to a PR that is BEHIND its
 * base.
 *
 * The order of the two guards is load-bearing: **not-BEHIND is checked
 * first**, so the budget-spent callback fires only for a PR that actually
 * wanted an update. Reversing them would announce an exhausted budget on
 * every poll of a perfectly up-to-date PR.
 *
 * @param {object} args
 * @param {string|undefined|null} args.mergeStateStatus  As probed by the
 *   caller. Anything other than `BEHIND` (including a degraded/unknown probe)
 *   is a no-op — an unreadable merge state must never license a write.
 * @param {number} [args.updatesUsed=0]   Updates already applied this wait.
 * @param {number} [args.maxUpdates=0]    Hard cap on updates per wait.
 * @param {() => Promise<unknown>} args.updateBranch  Invoker that issues the
 *   fast-forward. See {@link settleUpdate} for the accepted settlements.
 * @param {(args: { maxUpdates: number }) => void} [args.onBudgetSpent]
 * @param {(args: { updatesUsed: number, maxUpdates: number }) => void} [args.onUpdated]
 * @param {(detail: string) => void} [args.onUpdateFailed]
 * @returns {Promise<{
 *   attempted: boolean,
 *   updated: boolean,
 *   outcome: 'not-behind'|'budget-spent'|'updated'|'update-failed',
 * }>}
 *   `attempted` is true whenever the invoker ran — a failed update still
 *   counts as an attempt (the merge wait treats it as a consumed tick and
 *   re-reads the real state next poll). `updated` is true only when the
 *   fast-forward actually landed, which is the signal a caller needs before
 *   invalidating a terminal check outcome and re-polling.
 */
export async function applyBehindUpdate({
  mergeStateStatus,
  updatesUsed = 0,
  maxUpdates = 0,
  updateBranch,
  onBudgetSpent,
  onUpdated,
  onUpdateFailed,
}) {
  if (mergeStateStatus !== BEHIND_MERGE_STATE) {
    return { attempted: false, updated: false, outcome: 'not-behind' };
  }
  if (updatesUsed >= maxUpdates) {
    onBudgetSpent?.({ maxUpdates });
    return { attempted: false, updated: false, outcome: 'budget-spent' };
  }

  const settled = await settleUpdate(updateBranch);
  if (!settled.ok) {
    onUpdateFailed?.(settled.detail);
    return { attempted: true, updated: false, outcome: 'update-failed' };
  }
  onUpdated?.({ updatesUsed, maxUpdates });
  return { attempted: true, updated: true, outcome: 'updated' };
}
