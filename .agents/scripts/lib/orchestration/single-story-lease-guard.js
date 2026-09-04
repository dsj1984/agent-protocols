/**
 * single-story-lease-guard.js — wire the assignee-as-lease primitive
 * (`ticket-lease.js`, Story #3480) into the standalone `/single-story-deliver`
 * path (Story #3483, Epic #3457).
 *
 * The standalone workflow has no Epic-scoped dispatch manifest to serialise
 * two operators driving the same Story, so a concurrent `single-story-init`
 * could happily clobber another operator's in-flight run. This guard closes
 * that gap by taking an exclusive, time-bounded lease on the Story ticket at
 * init and clearing it at close:
 *
 *   - `acquireStoryLease` — claim the Story for the resolved operator. A live
 *     **foreign** claim (the assignee is someone else and their heartbeat is
 *     within the TTL) is fatal: the guard throws a message naming the current
 *     owner so the operator knows who to coordinate with. Unclaimed,
 *     self-held, and stale-foreign claims all proceed (the primitive reclaims
 *     stale claims automatically).
 *   - `releaseStoryLease` — clear the Story assignment on a clean close, but
 *     only when the operator still holds it (the primitive no-ops a stale
 *     release so a late close never yanks a claim back from whoever took
 *     over).
 *
 * The guard is deliberately thin and provider-agnostic: it resolves the
 * operator handle from config and delegates assignee mutation to the pure
 * `ticket-lease.js` primitive.
 *
 * **Fail-closed (audit #3513, hard-wired by Story #5006).** The lease
 * primitive used to reclaim a foreign claim whose heartbeat was older than a
 * TTL — and with no heartbeat source, *every* foreign claim looked stale, so
 * the guard silently reclaimed any foreign assignee and was inert as a
 * concurrency guard. The guard worked around that by anchoring the heartbeat
 * to `now`; Story #5006 deleted the TTL outright, so the fail-closed
 * behaviour is now the primitive's own: a foreign assignee refuses the take
 * (naming the current owner) unless the operator passes `--steal` to forcibly
 * transfer it. A genuinely abandoned claim is cleared by hand (or `--steal`)
 * rather than raced into automatically. Unclaimed and self-held tickets still
 * proceed.
 */

import {
  acquireLeaseFailClosed,
  resolveOperatorFromCandidates,
} from './lease-guard-shared.js';
import { releaseLease } from './ticket-lease.js';

/**
 * Resolve the operator handle used as the lease owner from resolved config.
 * Routes through the shared lease-guard kernel
 * (`lease-guard-shared.resolveOperatorFromCandidates`) so a leading `@` is
 * stripped (the assignees API expects bare logins, not `@`-prefixed mentions)
 * and the self-held-claim comparison matches. The standalone surface's
 * missing-handle policy is `'throw'` (intentional divergence from the plan
 * path's `'null'`): init has no best-effort leg that can degrade, so an
 * unowned lease must refuse immediately.
 *
 * @param {object} config Resolved `.agentrc.json` config.
 * @returns {string} Bare operator handle.
 * @throws {Error} When no `github.operatorHandle` resolves — unset, or still the
 *   shipped `@[USERNAME]` placeholder (both normalise to `null`). Without an
 *   operator identity the lease has no owner to record, so the standalone
 *   path cannot safely serialise concurrent runs.
 */
export function resolveOperator(config) {
  return resolveOperatorFromCandidates({
    candidates: [config?.github?.operatorHandle],
    missingHandleBehavior: 'throw',
    missingHandleMessage:
      'single-story lease: no operator identity is configured. ' +
      'github.operatorHandle is unset or still the shipped `@[USERNAME]` ' +
      'placeholder, so the standalone Story lease has no owner. Set your own ' +
      'handle in .agentrc.local.json (e.g. { "github": { "operatorHandle": ' +
      '"@your-login" } }) and re-run.',
  });
}

/**
 * Acquire (or re-affirm) the Story lease for the standalone path.
 *
 * **Fail-closed:** a foreign assignee refuses the take — the guard throws
 * naming the current owner so the operator can coordinate. Pass
 * `steal: true` (`--steal`) to forcibly transfer it. Unclaimed and self-held
 * tickets proceed without a write.
 *
 * @param {object} opts
 * @param {object} opts.provider           Ticketing provider (getTicket/updateTicket).
 * @param {number} opts.storyId            Story ticket to claim.
 * @param {object} opts.config             Resolved config (operator handle).
 * @param {string} [opts.operator]         Override the resolved operator (tests).
 * @param {boolean} [opts.steal=false]     Forcibly transfer a foreign claim.
 * @returns {Promise<{ acquired: boolean, owner: string, previousOwner: string|null, reason: string }>}
 * @throws {Error} When a foreign claim refuses the acquire (no `steal`).
 */
export async function acquireStoryLease({
  provider,
  storyId,
  config,
  operator,
  steal = false,
}) {
  const owner = operator ?? resolveOperator(config);
  return acquireLeaseFailClosed({
    provider,
    ticketId: storyId,
    operator: owner,
    steal,
    renderRefusal: (result) =>
      `single-story lease: Story #${storyId} is currently held by @${result.owner}. ` +
      'Another /mandrel-deliver run owns this Story. Coordinate with that ' +
      'operator, or re-run with --steal to forcibly transfer the claim once you ' +
      'have confirmed the other run is dead. (A foreign assignee always ' +
      'blocks unless stolen.)',
  });
}

/**
 * Release the Story lease on a clean close. No-ops (via the primitive) when
 * the operator no longer holds the claim, so a late close never steals a
 * claim back from whoever legitimately took over.
 *
 * @param {object} opts
 * @param {object} opts.provider    Ticketing provider.
 * @param {number} opts.storyId     Story ticket to release.
 * @param {object} opts.config      Resolved config (operator handle).
 * @param {string} [opts.operator]  Override the resolved operator (tests).
 * @returns {Promise<{ released: boolean, owner: string|null, reason: string }>}
 */
export async function releaseStoryLease({
  provider,
  storyId,
  config,
  operator,
}) {
  const owner = operator ?? resolveOperator(config);
  return releaseLease({ provider, ticketId: storyId, operator: owner });
}
