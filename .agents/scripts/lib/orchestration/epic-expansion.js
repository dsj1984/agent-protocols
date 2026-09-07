/**
 * epic-expansion.js — turn a container-Epic id into the open Story ids under it.
 *
 * Split out of `resolve-stories.js` (Story #5139): Epic expansion is a
 * distinct concern from Story resolution — it runs strictly *before* it and
 * hands it an ordinary id list — and folding it into that already-dense module
 * cost 4.19 maintainability points for no cohesion gain.
 *
 * @module lib/orchestration/epic-expansion
 */

import { TYPE_LABELS } from '../label-constants.js';
import { isEpicTicket, readEpicChildIdsFrom } from './epic-container.js';
import { isSatisfiedBlocker } from './resolve-stories.js';

/**
 * Does this issue carry the Story type label?
 *
 * @param {{ labels?: unknown }} issue
 * @returns {boolean}
 */
function isStoryTicket(issue) {
  const raw = issue?.labels;
  if (!Array.isArray(raw)) return false;
  return raw
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .includes(TYPE_LABELS.STORY);
}

/**
 * Expand any container-Epic id in the requested set to its open child
 * Stories, leaving every other id untouched.
 *
 * `/mandrel-deliver <epicId>` means "deliver everything under this Epic". The
 * expansion happens **here, before resolution**, so everything downstream —
 * the DAG, the ready set, the wave tick, the close tail — sees an ordinary
 * list of Story ids and needs no Epic concept at all. That is the whole
 * reason the Epic can exist without touching the delivery engine.
 *
 * Expansion is **per id**, so Epic and Story ids may be mixed freely in one
 * invocation and the result is the deduped union in first-seen order.
 *
 * Two filters apply to children, and they are deliberately quieter than the
 * treatment of a *named* id:
 *
 *   - **A closed / `agent::done` child is dropped.** Delivering an Epic means
 *     delivering what is left of it. A dependent's edge onto a landed sibling
 *     still resolves: the sibling becomes a *foreign* blocker, and foreign
 *     blockers are checked against live state and enter `done[]`.
 *   - **A child that is not a `type::story` is dropped with a warning.** A
 *     named non-Story is an error because the operator asserted it was
 *     deliverable; a linked one is the Epic's assertion, and someone attaching
 *     a stray issue in the GitHub UI must not wedge the whole run.
 *
 * An Epic that expands to nothing is an **error**, not an empty success: a
 * silent empty envelope would report a clean no-op for a delivery the
 * operator asked for and never got.
 *
 * @param {{
 *   ids: number[],
 *   getTicket: (id: number) => Promise<object|null>,
 *   readNativeChildIds?: (epic: object) => Promise<number[]>,
 *   warn?: (msg: string) => void,
 * }} opts
 * @returns {Promise<{ ids: number[], expansions: Array<{ epicId: number, childIds: number[] }> }>}
 */
export async function expandEpicIds({
  ids,
  getTicket,
  readNativeChildIds,
  warn,
}) {
  const out = [];
  const seen = new Set();
  const expansions = [];

  const push = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  for (const id of ids) {
    const issue = await getTicket(id);
    if (!issue) {
      throw new Error(`[resolve-stories] Issue #${id} was not found.`);
    }
    if (!isEpicTicket(issue)) {
      push(id);
      continue;
    }

    const { ids: childIds, nativeReadFailed } = await readEpicChildIdsFrom({
      epic: issue,
      readNativeChildIds,
      onWarn: warn,
    });
    if (childIds.length === 0) {
      // The two empty cases have different remedies, so they get different
      // errors: an operator told to go link Stories that are already linked
      // will do the wrong thing for a transient API failure (Story #5210).
      throw new Error(
        nativeReadFailed
          ? `[resolve-stories] Epic #${id} expanded to no child Stories, but the ` +
              `native sub-issue read failed — the list is incomplete, not empty. ` +
              `Re-run once the GitHub API read succeeds.`
          : `[resolve-stories] Epic #${id} lists no child Stories. An Epic is a container: ` +
              `link its Stories (a "- [ ] #N" checklist line or a GitHub sub-issue) ` +
              `or deliver the Story ids directly.`,
      );
    }

    const open = [];
    for (const childId of childIds) {
      let child;
      try {
        child = await getTicket(childId);
      } catch (err) {
        warn?.(
          `[resolve-stories] Epic #${id}: could not read child #${childId} ` +
            `(${err?.message ?? err}) — skipping it.`,
        );
        continue;
      }
      if (!child) {
        warn?.(
          `[resolve-stories] Epic #${id}: child #${childId} was not found — skipping it.`,
        );
        continue;
      }
      if (!isStoryTicket(child)) {
        warn?.(
          `[resolve-stories] Epic #${id}: child #${childId} is not a ${TYPE_LABELS.STORY} ` +
            `— skipping it. Only Stories are deliverable.`,
        );
        continue;
      }
      if (isSatisfiedBlocker(child)) continue;
      open.push(childId);
    }

    if (open.length === 0) {
      throw new Error(
        `[resolve-stories] Epic #${id} has ${childIds.length} child Story(ies), ` +
          `but none are still open — every one is closed or agent::done. ` +
          `There is nothing left to deliver.`,
      );
    }

    expansions.push({ epicId: id, childIds: open });
    for (const childId of open) push(childId);
  }

  return { ids: out, expansions };
}
