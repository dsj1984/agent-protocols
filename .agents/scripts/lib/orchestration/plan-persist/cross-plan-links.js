/**
 * cross-plan-links.js — resolve every reference a plan makes to something
 * outside itself, before anything is written.
 *
 * Story #5155. A plan can now point at two things it did not author: the
 * container Epic it wants to join (`--epic <id>`) and the open Stories it must
 * wait for (`depends_on: ["#<id>"]`). They are different features with
 * different owners, but they share the one property that decides *when* they
 * are checked, and that is what this module exists to express: both name live
 * tracker state, so both are verified **before the first `createIssue`**, dry
 * run included.
 *
 * The timing is the whole point. Either reference is free to fix while nothing
 * has been written and expensive afterwards — an unresolvable blocker left on
 * a live Story reads to the delivery engine as a permanent wedge rather than
 * an error worth reporting, and a mistyped Epic id would leave the operator
 * believing their Stories were filed somewhere they were not. Resolving them
 * together, at one call site, is what keeps a later edit from quietly moving
 * one of them after the creates.
 *
 * @module lib/orchestration/plan-persist/cross-plan-links
 * @see Story #5155
 */

import { adoptContainerEpic, resolveAdoptionTarget } from './epic-adoption.js';
import { createContainerEpic } from './epic-ops.js';
import { assertExternalDependenciesResolvable } from './external-deps.js';

/**
 * Verify a plan's outward references and return the Epic it adopts.
 *
 * @param {{
 *   provider: object,
 *   stories: Array<{ slug: string, depends_on?: string[] }>,
 *   epicId: number|null,
 * }} args
 * @returns {Promise<{ id: number, title: string, body: string }|null>}
 *   The resolved adoption target, or `null` when none was requested.
 * @throws {Error} When a `#<id>` blocker or the named Epic cannot be used.
 */
export async function resolveCrossPlanLinks({ provider, stories, epicId }) {
  await assertExternalDependenciesResolvable({ provider, stories });
  return resolveAdoptionTarget({ provider, epicId });
}

/**
 * Resolve this run's container Epic — adopted or newly created.
 *
 * The one entry point `run-plan-persist` calls, so the engine holds a single
 * statement rather than a branch it has to keep straight: which of the two
 * paths applies is decided by whether an adoption target was resolved before
 * the creates, and the two have opposite failure postures that are easy to
 * apply to the wrong one when the choice is inlined at the call site.
 *
 * @param {{
 *   provider: object,
 *   adoptionTarget: { id: number, title: string, body: string }|null,
 *   epic: { title: string, goal: string }|null,
 *   created: Array<{ id: number }>,
 *   opts?: { dryRun?: boolean },
 * }} args
 * @returns {Promise<object|null>} `null` when this run has no container.
 */
export async function resolveContainerEpic({
  provider,
  adoptionTarget,
  epic,
  created,
  opts = {},
}) {
  if (adoptionTarget) {
    return adoptContainerEpic({
      provider,
      target: adoptionTarget,
      created,
      opts,
    });
  }
  return createContainerEpic({ provider, epic, created, opts });
}
