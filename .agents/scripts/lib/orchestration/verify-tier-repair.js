/**
 * verify-tier-repair.js — repair-before-judging for the `verify[]` tier suffix
 * (Story #5005).
 *
 * The tier suffix (`… (unit)`) is a deterministic, mechanically-derivable
 * formality. `task-body-validator.js` already computed the corrected entry in
 * order to print it as a "Suggested fix" — then rejected the plan anyway and
 * charged the author a full re-drafting round to paste that exact string back.
 * This module applies the inference the validator already trusts, so the hard
 * error is reserved for the entries only the author can resolve.
 *
 * It lives beside the validator rather than inside it because the validator's
 * job is to *judge*: mixing a mutating repair pass into a module of pure
 * collectors muddies both. `persist-helpers.js#validateTickets` calls this
 * first, then `validateTaskBodies`.
 *
 * @module lib/orchestration/verify-tier-repair
 */

import { suggestVerifyFix } from '../story-body/body-format-lints.js';
import {
  parse as parseStoryBody,
  serialize as serializeStoryBody,
} from '../story-body/story-body.js';
import { VERIFY_TIER_VALUES } from './task-body-validator.js';

/** A parenthesised tier drawn from the canonical vocabulary, at end of entry. */
const VERIFY_TIER_RE = new RegExp(
  `\\((?:${VERIFY_TIER_VALUES.join('|')})\\)\\s*$`,
);

/**
 * Rewrite one `verify[]` list, appending the inferable testing tier to any
 * entry missing one. Returns `null` when nothing changed, so callers can keep
 * an already-compliant list byte-identical (and skip re-serializing the body
 * it came from).
 *
 * @param {unknown} rawVerify
 * @returns {string[]|null} The corrected list, or `null` when no fix applied.
 */
function repairVerifyList(rawVerify) {
  if (!Array.isArray(rawVerify)) return null;
  let changed = false;
  const next = rawVerify.map((entry) => {
    if (typeof entry !== 'string') return entry;
    if (entry.startsWith('manual:') || VERIFY_TIER_RE.test(entry)) return entry;
    const fix = suggestVerifyFix(entry);
    if (fix === null) return entry;
    changed = true;
    return fix;
  });
  return changed ? next : null;
}

/**
 * Repair the `## Verify` section of a serialized (string) body, in place on
 * the ticket. Only re-serializes when a fix actually applied, so a compliant
 * body is never round-tripped through `parse → serialize`.
 *
 * Leaving the body untouched while the top level was repaired would be worse
 * than not repairing at all: `syncContractFieldFromTopLevel` fails closed on a
 * body section that disagrees with its top-level array, so both sides must be
 * repaired by the same rule or neither.
 *
 * @param {object} ticket
 */
function repairStringBodyVerify(ticket) {
  let parsed;
  try {
    parsed = parseStoryBody(ticket.body).body;
  } catch {
    // An unparseable body is already a hard error in `validateTaskBodyShape`;
    // there is nothing to repair and nothing to report twice.
    return;
  }
  const repaired = repairVerifyList(parsed.verify);
  if (repaired === null) return;
  ticket.body = serializeStoryBody({ ...parsed, verify: repaired });
}

/**
 * Auto-append the testing tier to `verify[]` entries that omit one, wherever
 * `suggestVerifyFix` can infer it from the command. An entry whose tier cannot
 * be inferred is left untouched and still hard-errors downstream.
 *
 * Mutates `tickets` in place (the persist pipeline threads this same array on
 * to assembly) and returns it. Already-compliant tickets are untouched, so
 * their persisted output stays byte-identical. Total — a non-array argument
 * and non-Story tickets are no-ops.
 *
 * @param {object[]} tickets
 * @returns {object[]} `tickets`
 */
export function normalizeVerifyTiers(tickets) {
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    if (!ticket || ticket.type !== 'story' || ticket.body == null) continue;
    const topLevel = repairVerifyList(ticket.verify);
    if (topLevel !== null) ticket.verify = topLevel;
    if (typeof ticket.body === 'string') {
      repairStringBodyVerify(ticket);
      continue;
    }
    const bodyLevel = repairVerifyList(ticket.body.verify);
    if (bodyLevel !== null) ticket.body.verify = bodyLevel;
  }
  return tickets;
}
