/**
 * epic-adoption.js — join the Stories of this persist run to an Epic that
 * already exists.
 *
 * Story #5155. `epic-ops.js` opens a *new* container and, on a resumed run,
 * re-adopts the one carrying its exact fingerprint. This module covers the
 * case neither does: an operator pointing a fresh plan at an Epic an earlier
 * plan opened, with a different cohort and no fingerprint in common.
 *
 * **The posture is deliberately stricter than creation's.** Creation degrades
 * — an unensurable label just skips the container, because the Stories are the
 * part that matters and a missing Epic costs only tidiness. Adoption cannot
 * degrade the same way: the operator named a specific id, so silently not
 * adopting it would leave them believing their Stories were filed somewhere
 * they were not. A bad target is therefore a **hard error, raised before the
 * first Story is created** (dry run included), when nothing has been written
 * and the fix is free. Once the Stories exist, the posture flips to creation's
 * — a failed checklist write or sub-issue edge warns, because by then refusing
 * would strand live Stories over a cosmetic link.
 *
 * @module lib/orchestration/plan-persist/epic-adoption
 * @see Story #5155
 */

import { Logger } from '../../Logger.js';
import { TYPE_LABELS } from '../../label-constants.js';
import { appendEpicChildIds } from '../epic-checklist.js';
import { isEpicTicket } from '../epic-container.js';
import { mirrorSubIssueEdges } from './epic-ops.js';

/**
 * Resolve and validate the Epic an operator asked to adopt.
 *
 * Called **before any create**, so every refusal below costs the operator a
 * re-run of a command that wrote nothing.
 *
 * A null/absent `epicId` is the ordinary "no adoption requested" case and
 * resolves to `null` — only a *supplied* id can be wrong, and every wrong one
 * throws.
 *
 * @param {{ provider: object, epicId: number|null }} opts
 * @returns {Promise<{ id: number, title: string, body: string }|null>}
 * @throws {Error} When a supplied id is missing, closed, or not a container Epic.
 */
export async function resolveAdoptionTarget({ provider, epicId }) {
  if (epicId === null || epicId === undefined) return null;
  const id = Number(epicId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `[plan-persist] --epic expects a positive issue id (got "${epicId}").`,
    );
  }
  if (typeof provider?.getTicket !== 'function') {
    throw new Error(
      '[plan-persist] provider exposes no getTicket — cannot verify the Epic to adopt.',
    );
  }

  let issue;
  try {
    issue = await provider.getTicket(id);
  } catch (err) {
    throw new Error(
      `[plan-persist] --epic #${id} could not be read (${err?.message ?? err}). ` +
        'Adoption needs an existing open container Epic.',
    );
  }
  if (!issue) {
    throw new Error(`[plan-persist] --epic #${id} does not exist.`);
  }

  const state = String(issue.state ?? 'open').toLowerCase();
  if (state !== 'open') {
    throw new Error(
      `[plan-persist] --epic #${id} is ${state}. A closed Epic is a finished body of ` +
        'work and is never reopened by a plan — open a new container, or reopen it by hand first.',
    );
  }
  if (!isEpicTicket(issue)) {
    throw new Error(
      `[plan-persist] --epic #${id} does not carry "${TYPE_LABELS.EPIC}" — it is not a ` +
        'container Epic. Adopting an ordinary Story would file this plan under a work item.',
    );
  }

  return {
    id,
    title: typeof issue.title === 'string' ? issue.title : '',
    body: typeof issue.body === 'string' ? issue.body : '',
  };
}

/**
 * Link this run's Stories into an already-resolved Epic.
 *
 * Runs **after** the Stories exist, because both halves of the linkage need
 * their real ids: the checklist embeds issue numbers and the sub-issue edges
 * need database ids.
 *
 * @param {{
 *   provider: object,
 *   target: { id: number, title: string, body: string },
 *   created: Array<{ id: number }>,
 *   opts?: { dryRun?: boolean },
 * }} args
 * @returns {Promise<{
 *   id: number,
 *   title: string,
 *   childIds: number[],
 *   adopted: true,
 *   edges: { added: number, skipped: number, failed: number }|null,
 * }|null>}
 */
export async function adoptContainerEpic({
  provider,
  target,
  created,
  opts = {},
}) {
  const { dryRun = false } = opts;
  if (!target) return null;

  const all = Array.isArray(created) ? created : [];

  // Dry run reports the intent write-free. `created` carries negative
  // placeholder ids there, so report them as-is rather than filtering to the
  // positives and claiming an empty adoption.
  if (dryRun) {
    return {
      id: target.id,
      title: target.title,
      childIds: all.map((s) => s.id),
      adopted: true,
      edges: null,
    };
  }

  const childIds = all
    .map((s) => s.id)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (childIds.length === 0) return null;

  await appendChecklist({ provider, target, childIds });
  const edges = await mirrorSubIssueEdges({
    provider,
    epicNumber: target.id,
    childIds,
  });

  Logger.info(
    `[plan-persist] adopted container Epic #${target.id} — it now groups ` +
      `${childIds.length} more Story(ies): /mandrel-deliver ${target.id}`,
  );

  return {
    id: target.id,
    title: target.title,
    childIds,
    adopted: true,
    edges,
  };
}

/**
 * Write the appended checklist back to the Epic body.
 *
 * Non-fatal: the Stories are already live, and the native sub-issue edges
 * written next are the other half of the linkage. Losing the checklist costs
 * the body-only fallback path, not the grouping.
 *
 * @param {{ provider: object, target: { id: number, body: string }, childIds: number[] }} opts
 * @returns {Promise<void>}
 */
async function appendChecklist({ provider, target, childIds }) {
  if (typeof provider?.updateTicket !== 'function') {
    Logger.warn(
      '[plan-persist] provider exposes no updateTicket — the adopted Epic body was not ' +
        'updated. The native sub-issue edges still record the grouping.',
    );
    return;
  }
  const next = appendEpicChildIds(target.body, childIds);
  if (next === target.body) return;
  try {
    await provider.updateTicket(target.id, { body: next });
  } catch (err) {
    Logger.warn(
      `[plan-persist] could not update Epic #${target.id}'s checklist ` +
        `(${err?.message ?? err}). The native sub-issue edges still record the grouping.`,
    );
  }
}
