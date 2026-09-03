/**
 * ticket-lease.js — assignee-as-lease primitive (Story #3480, Epic #3457).
 *
 * The workflow-guards Feature (#3478) needs a way for one operator to take an
 * exclusive claim on a ticket so two concurrent runs do not both drive the
 * same Story. Rather than invent a new state column, the lease rides the
 * ticket's existing **assignees** surface: the single assignee *is* the lease
 * owner.
 *
 * **A foreign claim is a refusal, full stop (Story #5006).** The lease shipped
 * with a TTL: a claim whose owner's last heartbeat was older than
 * `delivery.lease.ttlMs` counted as stale and was silently reclaimed. The
 * `story.heartbeat` emitter that would have fed it was structurally inert (it
 * demanded an `epicId >= 1` that v2, which has no Epics, never supplies) and
 * was deleted, after which every guard pinned `heartbeatAt` to `now` so the
 * liveness test always answered "live" — the TTL, the heartbeat parameter and
 * the reclaim branch were an elaborate way of writing `true`. They are gone.
 * A stranded claim is cleared with `--steal`, which is now the only way past
 * a foreign owner.
 *
 * The two exported operations are deliberately thin and provider-agnostic:
 *
 *   - `acquireLease`  — claim an unassigned ticket, re-affirm a self-held
 *                       claim, or — with `steal: true` — forcibly transfer a
 *                       foreign claim.
 *   - `releaseLease`  — clear the assignment, but only when the operator
 *                       still holds it (a no-op once the ticket was
 *                       reassigned elsewhere, so a late release never steals
 *                       a claim back from whoever took over).
 *
 * Provider contract (a subset of `ITicketingProvider`):
 *   - `getTicket(id)`               → `{ assignees: string[], ... }`
 *   - `updateTicket(id, { assignees })`    replaces the assignee list.
 *   - `updateTicket(id, { addAssignees })` appends to it (Story #5112).
 */

/**
 * The shipped, non-personal operator-identity placeholder (and its bare,
 * post-normalise form). The committed `.agentrc.json` and the distributed
 * templates carry this sentinel so `github.operatorHandle` is schema-present
 * without naming a real person; each contributor overrides it with their own
 * handle in the gitignored `.agentrc.local.json`. It is NOT a usable lease
 * owner: `normalizeOperatorHandle` maps it to `null` so the guards fail closed
 * (a contributor who never set their handle is loudly refused, never silently
 * coordinated under a shared identity) and no assignee PATCH ever writes a
 * literal `[USERNAME]` (HTTP 422).
 */
// kept (dead-export allowlist): public config sentinel — the distributed
// `.agentrc.json` / templates carry this literal; exported so consumers and
// future call sites resolve it by symbol rather than re-typing the string.
export const OPERATOR_HANDLE_PLACEHOLDER = '@[USERNAME]';
const OPERATOR_HANDLE_PLACEHOLDER_BARE = '[USERNAME]';

/**
 * Normalise an operator handle into the bare login GitHub writes to (and
 * returns from) a ticket's `assignees`. Trims surrounding whitespace and
 * strips a single leading `@` so an `@`-prefixed `operatorHandle` matches a
 * bare assignee login (otherwise the assignee PATCH is rejected HTTP 422 and
 * the self-held-claim comparison `owner === operator` never matches).
 *
 * Returns `null` for a non-string, empty, whitespace-only, or placeholder
 * handle (`@[USERNAME]`) so each caller can apply its own absent-handling
 * (degrade to a no-op, or throw). Treating the placeholder as unset is what
 * makes the shipped sentinel safe: a contributor who never overrode it is
 * indistinguishable from one who set nothing, so the guards fail closed.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeOperatorHandle(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^@/, '');
  if (trimmed.length === 0 || trimmed === OPERATOR_HANDLE_PLACEHOLDER_BARE) {
    return null;
  }
  return trimmed;
}

/**
 * Normalise the assignee list into a single current owner. The lease model is
 * single-holder: the first assignee is authoritative. Returns `null` for an
 * unassigned ticket.
 *
 * @param {string[]|undefined|null} assignees
 * @returns {string|null}
 */
export function currentOwner(assignees) {
  if (!Array.isArray(assignees) || assignees.length === 0) return null;
  return assignees[0];
}

/**
 * Validate and normalise the shared option bag for the lease operations.
 *
 * @param {string} op
 * @param {object} opts
 * @returns {{ provider: object, ticketId: number, operator: string }}
 */
function normaliseOpts(op, opts) {
  const { provider, ticketId, operator } = opts ?? {};

  if (!provider || typeof provider.getTicket !== 'function') {
    throw new Error(`${op}: provider with getTicket/updateTicket is required`);
  }
  if (!Number.isInteger(ticketId) || ticketId < 1) {
    throw new Error(`${op}: ticketId must be a positive integer`);
  }
  if (typeof operator !== 'string' || operator.length === 0) {
    throw new Error(`${op}: operator must be a non-empty string`);
  }

  return { provider, ticketId, operator };
}

/**
 * Acquire (or re-affirm) a lease on a ticket for `operator`.
 *
 * Outcomes:
 *   - Unassigned ticket            → assign operator, `acquired: true`,
 *                                     `reason: 'unclaimed'`.
 *   - Operator already holds it    → no write, `acquired: true`,
 *                                     `reason: 'already-held'`.
 *   - Foreign claim, no steal      → no write, `acquired: false`,
 *                                     `owner: <foreign>`, `reason: 'held'`.
 *   - Foreign claim + `steal:true` → reassign operator, `acquired: true`,
 *                                     `reason: 'stolen'`.
 *   - Lost a write race            → a foreign login co-assigned between our
 *                                     PATCH and the verify re-read; back the
 *                                     operator out, `acquired: false`,
 *                                     `owner: <foreign>`, `reason: 'lost-race'`.
 *
 * Every claiming write is verified: GitHub's assignee write is not a
 * compare-and-set, so two runs that both read the ticket unassigned will both
 * write themselves. {@link claimAndVerify} re-reads after the write and refuses
 * (fail-closed) when a foreign login is present, so the loser of a simultaneous
 * claim never proceeds as though it holds the lease. Story #5112 made the
 * first claim **additive** so that verify can actually see the collision —
 * see {@link claimAndVerify}.
 *
 * @param {object} opts
 * @param {object} opts.provider              Ticketing provider.
 * @param {number} opts.ticketId              Ticket to claim.
 * @param {string} opts.operator              Operator acquiring the lease.
 * @param {boolean} [opts.steal=false]        Transfer a foreign claim.
 * @returns {Promise<{
 *   acquired: boolean,
 *   owner: string,
 *   previousOwner: string|null,
 *   reason: 'unclaimed'|'already-held'|'stolen'|'held'|'lost-race',
 * }>}
 */
export async function acquireLease(opts) {
  const { provider, ticketId, operator } = normaliseOpts('acquireLease', opts);
  const steal = opts.steal === true;

  const ticket = await provider.getTicket(ticketId);
  const owner = currentOwner(ticket?.assignees);

  // Unclaimed → take it.
  if (owner === null) {
    return claimAndVerify({
      provider,
      ticketId,
      operator,
      previousOwner: null,
      reason: 'unclaimed',
    });
  }

  // Already ours → no write needed.
  if (owner === operator) {
    return {
      acquired: true,
      owner: operator,
      previousOwner: operator,
      reason: 'already-held',
    };
  }

  // Foreign claim — refuse unless the operator explicitly steals it.
  if (!steal) {
    return {
      acquired: false,
      owner,
      previousOwner: owner,
      reason: 'held',
    };
  }

  return claimAndVerify({
    provider,
    ticketId,
    operator,
    previousOwner: owner,
    reason: 'stolen',
  });
}

/**
 * Write the operator to a ticket's assignees, then re-read to confirm the
 * claim actually stuck before reporting success.
 *
 * The assignee write is not atomic — GitHub offers no compare-and-set on the
 * assignees surface — so two runs that both observed the ticket unassigned (or
 * a stale foreign claim) will both write themselves in. Without a check the
 * loser of that race returns `acquired: true` and marches into the worktree
 * the winner is already building. The verify closes that window: it re-reads
 * with `fresh: true` (bypassing any provider cache so it sees the other run's
 * write, not our own), and if a foreign login is present it concedes — removes
 * the operator from the assignee set so no phantom co-owner lingers, and
 * returns `acquired: false` / `reason: 'lost-race'` so the fail-closed caller
 * refuses. A clean read (assignees exactly `[operator]`) confirms the claim.
 *
 * **The write must be additive for the verify to work (Story #5112).** With
 * the replacing PATCH this used unconditionally, a simultaneous claim
 * *evicted* the other operator rather than joining it, so the co-assignment
 * the `lost-race` branch keys on was a state the PATCH could never produce:
 * each run read a clean `[self]` on verify and both proceeded. Claiming an
 * unowned ticket therefore goes through the additive assignees endpoint
 * (`addAssignees`), which makes the collision observable and lets exactly one
 * claimer survive. The replacing form stays for the two cases that genuinely
 * mean "replace": the `--steal` transfer of a foreign claim, and the loser's
 * own back-out below.
 *
 * @param {object} args
 * @param {object} args.provider              Ticketing provider.
 * @param {number} args.ticketId              Ticket being claimed.
 * @param {string} args.operator              Operator acquiring the lease.
 * @param {string|null} args.previousOwner    Owner before this write (for the result).
 * @param {string} args.reason                Success reason when the claim holds.
 * @returns {Promise<{ acquired: boolean, owner: string, previousOwner: string|null, reason: string }>}
 */
/**
 * The assignee mutation a claim writes. Additive when the ticket has no
 * previous owner — that is what makes a simultaneous claim show up as a
 * co-assignment {@link claimAndVerify} can detect. Replacing only for a
 * steal, where evicting the previous owner *is* the intent.
 *
 * @param {string} operator
 * @param {string|null} previousOwner
 * @returns {{ addAssignees: string[] }|{ assignees: string[] }}
 */
function claimMutation(operator, previousOwner) {
  if (previousOwner === null) return { addAssignees: [operator] };
  return { assignees: [operator] };
}

async function claimAndVerify({
  provider,
  ticketId,
  operator,
  previousOwner,
  reason,
}) {
  await provider.updateTicket(ticketId, claimMutation(operator, previousOwner));

  const after = await provider.getTicket(ticketId, { fresh: true });
  const assignees = Array.isArray(after?.assignees) ? after.assignees : [];
  const foreign = assignees.filter((login) => login !== operator);

  if (foreign.length === 0) {
    return { acquired: true, owner: operator, previousOwner, reason };
  }

  // A foreign login co-assigned after our write — we lost a simultaneous
  // claim. Back ourselves out so the winner is the sole assignee, and report
  // the loss so the fail-closed caller refuses rather than double-delivering.
  await provider
    .updateTicket(ticketId, { assignees: foreign })
    .catch(() => undefined);
  return {
    acquired: false,
    owner: foreign[0],
    previousOwner,
    reason: 'lost-race',
  };
}

/**
 * Release a lease the operator currently holds.
 *
 * Clears the ticket's assignees only when `operator` is still the recorded
 * owner. If the ticket has since been reassigned (or was never held by this
 * operator), the call is a no-op — a stale release must never yank a claim
 * away from whoever legitimately holds it now.
 *
 * @param {object} opts
 * @param {object} opts.provider   Ticketing provider.
 * @param {number} opts.ticketId   Ticket to release.
 * @param {string} opts.operator   Operator releasing the lease.
 * @returns {Promise<{
 *   released: boolean,
 *   owner: string|null,
 *   reason: 'released'|'not-held',
 * }>}
 */
export async function releaseLease(opts) {
  const { provider, ticketId, operator } = normaliseOpts('releaseLease', opts);
  const ticket = await provider.getTicket(ticketId);
  const owner = currentOwner(ticket?.assignees);

  if (owner !== operator) {
    return { released: false, owner, reason: 'not-held' };
  }

  await provider.updateTicket(ticketId, { assignees: [] });
  return { released: true, owner: null, reason: 'released' };
}
