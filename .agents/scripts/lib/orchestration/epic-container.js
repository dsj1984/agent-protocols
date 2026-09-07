/**
 * epic-container.js — the one module describing a container Epic.
 *
 * An Epic here is a **pure container**: a `type::epic` issue whose body is a
 * short `## Goal` paragraph and a `- [ ] #N` child checklist, and nothing
 * else. It carries no `## Spec`, no `acceptance[]` / `verify[]`, and no
 * `agent::*` label. It is never branched, never implemented and never
 * delivered — `/mandrel-deliver <epicId>` expands it to its open children and
 * delivers those.
 *
 * **Linkage is parent→child only.** The Epic holds every edge; Story bodies
 * are never touched. That is the whole reason this can exist without
 * reversing ADR `20260726-v2-story-collapse`: the `Epic: #N` footer stays
 * retired and every refusal that reads it still fires, so each Story remains
 * independently deliverable and the delivery engine stays Story-only.
 *
 * Both consumers — `plan-persist` (which writes an Epic) and
 * `resolve-stories` (which expands one) — import from here so the written
 * shape and the read shape cannot drift apart.
 *
 * **The container's lifecycle is derived, never labelled.** It still carries
 * no `agent::*` label — that absence is what keeps it out of the bare
 * `/mandrel-deliver` ready list and outside `lint-issue-body.js`. What it does
 * carry is a Projects v2 Status column, an owner while its children run, and
 * eventually a closed state, all computed from the children by
 * `epic-rollup.js` and written directly (Story #5205). Deriving rather than
 * labelling is the whole reason those two facts can coexist.
 *
 * @module lib/orchestration/epic-container
 * @see Story #5139
 */

import { TYPE_LABELS } from '../label-constants.js';

/**
 * The checklist grammar. `getSubTickets` (`providers/github/issues.js`)
 * already parses this exact form as its strategy-2 child source, so the
 * checklist is a durable mirror of the native sub-issue edges rather than a
 * second, competing representation: when the sub-issues API is unavailable
 * — an older GHES, a revoked scope, a partial write — the children are still
 * discoverable from the body alone.
 *
 * Kept in sync with `_getChecklistChildren` deliberately; a divergence here
 * would strand children the writer believes it linked.
 */
const CHECKLIST_ITEM_RE = /^-\s*\[[ xX]\]\s+#(\d+)\s*$/gm;

/**
 * The same grammar, unanchored to a global cursor — for callers testing one
 * line at a time. Kept beside its `/g` twin so the two cannot drift.
 */
export const CHECKLIST_ITEM_LINE_RE = /^-\s*\[[ xX]\]\s+#\d+\s*$/;

/** Heading the container's one prose section renders under. */
const GOAL_HEADING = '## Goal';

/** Heading the child checklist renders under. */
export const CHILDREN_HEADING = '## Stories';

/**
 * Rendered in place of the checklist when a container has no children yet.
 *
 * Exported because {@link appendEpicChildIds} must *remove* it when the first
 * child arrives: a container that lists a Story and still claims to be empty
 * is a body that contradicts itself, and the two writers have to agree on the
 * exact string to keep that from happening.
 */
export const NO_CHILDREN_PLACEHOLDER = '_No child Stories linked._';

/**
 * Normalize an issue's labels to plain strings. GitHub hands labels back
 * either as objects (`{ name }`) or, once mapped, as bare strings; callers
 * should not have to care which shape they hold.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeLabels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .filter((n) => typeof n === 'string' && n.length > 0);
}

/**
 * Is this issue a container Epic?
 *
 * Reads the `type::epic` label and nothing else — the label is the
 * authoritative marker. Body shape is deliberately NOT part of the test: a
 * hand-edited Epic whose checklist an operator reordered or annotated is
 * still an Epic, and treating it otherwise would silently reclassify it as
 * an ordinary non-Story and hard-error the delivery.
 *
 * @param {{ labels?: unknown }} issue
 * @returns {boolean}
 */
export function isEpicTicket(issue) {
  return normalizeLabels(issue?.labels).includes(TYPE_LABELS.EPIC);
}

/**
 * Render a container Epic's body.
 *
 * The output is intentionally minimal — a goal paragraph and a checklist.
 * The Epic must carry **no information a child does not already carry**: it
 * is a container, so anything unique living here would be a fact with no
 * home in the tickets that actually get executed, invisible to every agent
 * delivering them.
 *
 * @param {{ goal: string, childIds?: number[] }} opts
 * @returns {string} Canonical Epic body markdown.
 */
export function composeEpicBody({ goal, childIds = [] } = {}) {
  const text = typeof goal === 'string' ? goal.trim() : '';
  if (text === '') {
    throw new Error('[epic-container] composeEpicBody requires a goal.');
  }

  const ids = normalizeChildIds(childIds);
  const lines = [GOAL_HEADING, '', text, '', CHILDREN_HEADING, ''];
  if (ids.length === 0) {
    lines.push(NO_CHILDREN_PLACEHOLDER);
  } else {
    for (const id of ids) lines.push(`- [ ] #${id}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Coerce a child-id list to positive integers, deduped, order-preserving.
 *
 * @param {unknown} raw
 * @returns {number[]}
 */
export function normalizeChildIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const id = Number(entry);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Read the child issue numbers an Epic body declares.
 *
 * Body-only, by design: this is the fallback that works with nothing but the
 * issue text. Callers that can reach the API should union this with the
 * native sub-issue edges (`readEpicChildIdsFrom`), because an operator can
 * link a child in the GitHub UI without touching the checklist.
 *
 * @param {string|null|undefined} body
 * @returns {number[]}
 */
export function readEpicChildIds(body) {
  if (typeof body !== 'string' || body === '') return [];
  // `matchAll` on a /g regex starts from lastIndex; the literal is
  // module-scoped, so reset it rather than leaking state across calls.
  CHECKLIST_ITEM_RE.lastIndex = 0;
  return normalizeChildIds(
    [...body.matchAll(CHECKLIST_ITEM_RE)].map((m) => Number.parseInt(m[1], 10)),
  );
}

/**
 * Resolve an Epic's children from **both** sources — the body checklist and
 * the native sub-issue edges — as one deduped list.
 *
 * The two are unioned rather than ranked because each can hold a child the
 * other misses: the API is authoritative for links made in the GitHub UI,
 * and the checklist survives an API that is unavailable or was never
 * written. A child present in either is a child.
 *
 * `readNativeChildIds` is injected and may be absent or throw; a failure
 * degrades to the checklist rather than propagating, since a body-derived
 * child list is a strictly better answer than an error.
 *
 * @param {{
 *   epic: { number?: number, id?: number, body?: string, nodeId?: string },
 *   readNativeChildIds?: (epic: object) => Promise<number[]>,
 *   onWarn?: (message: string) => void,
 * }} opts
 * @returns {Promise<number[]>}
 */
export async function readEpicChildIdsFrom({
  epic,
  readNativeChildIds,
  onWarn,
} = {}) {
  const fromBody = readEpicChildIds(epic?.body);
  if (typeof readNativeChildIds !== 'function') return fromBody;

  let native = [];
  try {
    native = normalizeChildIds(await readNativeChildIds(epic));
  } catch (err) {
    const id = epic?.number ?? epic?.id ?? '?';
    onWarn?.(
      `[epic-container] native sub-issue read failed for Epic #${id} ` +
        `(${err?.message ?? String(err)}); using the body checklist alone.`,
    );
  }

  return normalizeChildIds([...native, ...fromBody]);
}
