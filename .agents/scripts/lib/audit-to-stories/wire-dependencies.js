/**
 * lib/audit-to-stories/wire-dependencies.js — turn a standalone audit cohort's
 * detected group edges into declared ordering, once the issues exist.
 *
 * `groupFindings` detects `edges[]` between finding groups, but at emit time
 * the groups have no issue numbers, so the ordering could only be rendered as
 * prose. Every standalone audit Story therefore shipped with `depends_on: []`,
 * and what actually kept a cohort from being co-dispatched onto colliding
 * branches was an **accident**: siblings shared the sweep-wide audit provenance
 * footers `plan-persist` stamps, and the delivery footprint guard scraped
 * path-shaped tokens out of them. Story #5044 narrows that scrape, which is why
 * this module lands with it — removing the accidental serializer without giving
 * the cohort a real one would leave it less ordered than before.
 *
 * The shape is `plan-persist`'s two-pass crossing (`plan-persist/story-ops.js`),
 * because it is the same problem: **create every issue first, then mirror the
 * edges**. Both halves are written:
 *
 *   1. The **body footer** (`---` / `blocked by #N`) — canonical, parsed by
 *      `/deliver`'s resolver, and the fallback when the dependencies API is
 *      unavailable.
 *   2. The **native `blocked_by` relation** — visible in the GitHub UI,
 *      readable without parsing markdown, and settable by an operator later.
 *
 * Native mirroring is **non-fatal by design**, matching `plan-persist`: the
 * footer has already been written by the time it runs, so a dependencies API
 * that says no costs visibility, not ordering.
 *
 * @module lib/audit-to-stories/wire-dependencies
 */

import { applyBlockedByDependencies } from '../../providers/github/blocked-by-add.js';
import { Logger } from '../Logger.js';
import { buildStoryBody } from './build-story-body.js';

/**
 * Re-render each created Story's body with its blockers resolved to `#N`, and
 * mirror the same edges as native `blocked_by` relations.
 *
 * Groups whose issue was not created — deduped against an existing Issue,
 * suppressed by the ledger, or simply not in `issueByGroupKey` — are skipped
 * rather than guessed at, and an edge pointing at one drops with them
 * (`dependencyRefs` filters it). A `blocked by #undefined` would gate a Story
 * on nothing forever, which is strictly worse than the un-ordered cohort this
 * replaces.
 *
 * @param {object} args
 * @param {Array<object>} args.groups          The `create`-eligible groups, in
 *   the order their issues were opened.
 * @param {Array<{ fromGroupKey: string, toGroupKey: string }>} [args.edges]
 * @param {Record<string, number>} args.issueByGroupKey  Group key → issue number.
 * @param {(issueNumber: number, body: string) => Promise<unknown>} args.updateBody
 *   Persist a re-rendered body. Injected so the caller owns the provider call.
 * @param {object|null} [args.provider] Provider for native edge mirroring.
 *   Omit (or pass one without the dependency ports) to write footers only.
 * @returns {Promise<{
 *   storiesWired: number,
 *   bodiesUpdated: number,
 *   edgesDeclared: number,
 *   native: { edgesAdded: number, edgesSkipped: number, edgesFailed: number }|null
 * }>}
 */
export async function wireAuditStoryEdges({
  groups,
  edges = [],
  issueByGroupKey,
  updateBody,
  provider = null,
}) {
  const wired = collectWiredStories({ groups, edges, issueByGroupKey });
  if (wired.length === 0) {
    return {
      storiesWired: 0,
      bodiesUpdated: 0,
      edgesDeclared: 0,
      native: null,
    };
  }

  let bodiesUpdated = 0;
  for (const story of wired) {
    await updateBody(story.issueNumber, story.body);
    bodiesUpdated++;
  }

  return {
    storiesWired: wired.length,
    bodiesUpdated,
    edgesDeclared: wired.reduce((n, s) => n + s.blockerKeys.length, 0),
    native: await mirrorNativeEdges({ provider, wired, issueByGroupKey }),
  };
}

/**
 * Re-render every group that both has an issue **and** has at least one blocker
 * whose issue also exists.
 *
 * A group with no resolvable blocker is deliberately left alone rather than
 * rewritten to an identical body: an issue-body update is a mutation and a
 * notification, and doing it for a no-op edit is noise on every Story of every
 * sweep.
 *
 * @param {object} args
 * @returns {Array<{ groupKey: string, issueNumber: number, body: string, blockerKeys: string[] }>}
 */
function collectWiredStories({ groups, edges, issueByGroupKey }) {
  const wired = [];
  for (const group of groups ?? []) {
    const issueNumber = issueByGroupKey?.[group?.groupKey];
    if (!Number.isInteger(issueNumber)) continue;
    const rendered = buildStoryBody({ group, edges, issueByGroupKey });
    const blockerKeys = rendered.dependsOn.filter((key) =>
      Number.isInteger(issueByGroupKey[key]),
    );
    if (blockerKeys.length === 0) continue;
    wired.push({
      groupKey: rendered.groupKey,
      issueNumber,
      body: rendered.body,
      blockerKeys,
    });
  }
  return wired;
}

/**
 * Mirror the declared edges as native GitHub `blocked_by` relations.
 *
 * Two shape hazards this crossing inherits from `plan-persist`, both silent if
 * missed: `applyBlockedByDependencies` indexes `slugToIssueNumber` with plain
 * property access (so it must be a plain object, never a `Map` — a `Map` yields
 * `undefined` for every lookup, skips every edge, and reports success having
 * written nothing), and it reads `dependsOn`, not `depends_on`.
 *
 * @param {object} args
 * @returns {Promise<{ edgesAdded: number, edgesSkipped: number, edgesFailed: number }|null>}
 *   `null` when there is no interface to mirror through.
 */
async function mirrorNativeEdges({ provider, wired, issueByGroupKey }) {
  if (
    typeof provider?.getDependencyWriteContext !== 'function' ||
    typeof provider?.getTicket !== 'function'
  ) {
    Logger.warn(
      '[audit-to-stories] provider exposes no getDependencyWriteContext/getTicket — ' +
        'skipping native blocked_by edges. Ordering survives in the ' +
        '`blocked by #N` body footers just written.',
    );
    return null;
  }
  try {
    const { gh, owner, repo } = provider.getDependencyWriteContext();
    const summary = await applyBlockedByDependencies({
      // The group key IS the slug here — it is the stable identifier both
      // sides of an edge are keyed by — so `issueByGroupKey` is already the
      // slug→number map the helper wants.
      stories: wired.map((s) => ({
        slug: s.groupKey,
        dependsOn: s.blockerKeys,
      })),
      slugToIssueNumber: issueByGroupKey,
      getTicket: (issueNumber) => provider.getTicket(issueNumber),
      owner,
      repo,
      gh,
    });
    if (summary.edgesFailed > 0) {
      Logger.warn(
        `[audit-to-stories] ${summary.edgesFailed} native blocked_by edge(s) could ` +
          'not be written. Ordering survives in the `blocked by #N` body footers.',
      );
    }
    return {
      edgesAdded: summary.edgesAdded,
      edgesSkipped: summary.edgesSkipped,
      edgesFailed: summary.edgesFailed,
    };
  } catch (err) {
    Logger.warn(
      `[audit-to-stories] native blocked_by mirroring failed (${err.message}) — ` +
        'ordering survives in the `blocked by #N` body footers.',
    );
    return null;
  }
}
