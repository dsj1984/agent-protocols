/**
 * external-deps.js — `depends_on` entries that point outside this plan run.
 *
 * Story #5155. A `depends_on[]` entry has always been a **sibling slug**: a
 * name resolvable only inside the `stories.json` being persisted. That makes
 * every ordering edge intra-plan by construction, and leaves the cross-plan
 * case — a new Story that must wait for an open Story from an earlier run —
 * expressible only by hand-editing the issue body after persist.
 *
 * An entry of the form `#1234` is that missing case: an **external** blocker,
 * already live on the tracker. The two forms are distinguished lexically and
 * totally, so nothing has to guess:
 *
 *   - `some-slug` → a sibling, resolved against this run's slug map;
 *   - `#1234`     → an existing issue, resolved against the tracker.
 *
 * External refs are excluded from sibling ordering and cycle detection. They
 * cannot participate in either: a Story already open is not scheduled by this
 * run, so it has no position in the topological sort, and it cannot close a
 * cycle back into a Story that does not exist yet. Treating them as siblings
 * is what would break — the unknown-slug guard would reject every one.
 *
 * They are validated strictly, and **before any create**: an unresolvable
 * blocker that surfaced after the fact would leave a live Story gated on
 * something that can never satisfy it, which the delivery engine reads as a
 * permanent wedge rather than an error.
 *
 * @module lib/orchestration/plan-persist/external-deps
 * @see Story #5155
 */

import { TYPE_LABELS } from '../../label-constants.js';

/** A `depends_on` entry naming an existing issue: `#` followed by digits. */
const EXTERNAL_REF_RE = /^#(\d+)$/;

/**
 * Is this `depends_on` entry an external issue reference?
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isExternalDependencyRef(entry) {
  return typeof entry === 'string' && EXTERNAL_REF_RE.test(entry.trim());
}

/**
 * The issue number an external ref names, or `null` for a sibling slug.
 *
 * @param {unknown} entry
 * @returns {number|null}
 */
export function externalDependencyId(entry) {
  if (typeof entry !== 'string') return null;
  const match = entry.trim().match(EXTERNAL_REF_RE);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Every distinct external id declared across a plan's Stories, in first-seen
 * order.
 *
 * @param {Array<{ depends_on?: string[] }>} stories
 * @returns {number[]}
 */
export function collectExternalDependencyIds(stories) {
  const seen = new Set();
  const out = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    for (const entry of story?.depends_on ?? []) {
      const id = externalDependencyId(entry);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Normalize an issue's labels to plain strings.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function labelNames(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .filter((n) => typeof n === 'string');
}

/**
 * Explain why one external blocker is unusable, or `null` when it is fine.
 *
 * @param {number} id
 * @param {object|null} issue
 * @returns {string|null}
 */
function rejectionReason(id, issue) {
  if (!issue) return `#${id} does not exist`;
  const state = String(issue.state ?? 'open').toLowerCase();
  if (state !== 'open') {
    return `#${id} is ${state} — a landed Story cannot gate new work, so the edge would never lift`;
  }
  const labels = labelNames(issue.labels);
  if (labels.includes(TYPE_LABELS.EPIC)) {
    return `#${id} is a container Epic — Epics are never delivered, so nothing would ever satisfy the edge`;
  }
  if (!labels.includes(TYPE_LABELS.STORY)) {
    return `#${id} is not a ${TYPE_LABELS.STORY} — only a Story can be delivered and thereby unblock this one`;
  }
  return null;
}

/**
 * Verify every external `depends_on` ref resolves to an open Story.
 *
 * Hard-errors listing **every** bad ref rather than the first, so an operator
 * fixing a plan sees the whole set in one pass.
 *
 * @param {{ provider: object, stories: Array<{ slug: string, depends_on?: string[] }> }} args
 * @returns {Promise<number[]>} The validated external ids (possibly empty).
 * @throws {Error} When any ref is missing, closed, an Epic, or not a Story.
 */
export async function assertExternalDependenciesResolvable({
  provider,
  stories,
}) {
  const ids = collectExternalDependencyIds(stories);
  if (ids.length === 0) return [];

  if (typeof provider?.getTicket !== 'function') {
    throw new Error(
      '[plan-persist] provider exposes no getTicket — cannot verify the external ' +
        `depends_on reference(s): ${ids.map((i) => `#${i}`).join(', ')}.`,
    );
  }

  const problems = [];
  for (const id of ids) {
    let issue = null;
    try {
      issue = await provider.getTicket(id);
    } catch (err) {
      problems.push(`#${id} could not be read (${err?.message ?? err})`);
      continue;
    }
    const reason = rejectionReason(id, issue);
    if (reason) problems.push(reason);
  }

  if (problems.length > 0) {
    throw new Error(
      `[plan-persist] ${problems.length} external depends_on reference(s) cannot gate ` +
        `this plan:\n  - ${problems.join('\n  - ')}\n\nEvery "#<id>" entry must name an ` +
        `open ${TYPE_LABELS.STORY}. Drop the entry, or point it at a Story that is still open.`,
    );
  }

  return ids;
}
