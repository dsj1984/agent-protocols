/**
 * story-follow-ups.js — capture actionable follow-ups from a landed Story.
 *
 * Replaces the unwired Epic retro as the default closeout for v2: after a
 * Story merges, read its standalone `signals.ndjson` friction stream, compose
 * routed proposals, auto-file follow-up issues (when enabled), and upsert a
 * structured `follow-ups` comment on the Story.
 *
 * @module lib/orchestration/story-follow-ups
 */

import { signalsFile } from '../config/temp-paths.js';
import { graduateRetroProposals } from '../feedback-loop/retro-proposals-graduator.js';
import { DEFAULT_FRAMEWORK_REPO } from '../github/framework-repo.js';
import { Logger } from '../Logger.js';
import { normalizeGatheredSignal } from '../observability/runtime-friction.js';
import {
  forEachLine,
  forEachSignalStreamLine,
} from '../observability/signals-writer.js';
import {
  composeRoutedProposals,
  deriveUnresolvedBlockedEvents,
} from './retro-proposals.js';
import { upsertStructuredComment } from './ticketing.js';

export const FOLLOW_UPS_COMMENT_TYPE = 'follow-ups';

/**
 * @param {object} [config]
 * @returns {{ frameworkRepo: string, consumerRepo: string, currentRepo: { owner: string, repo: string } }}
 */
export function resolveFollowUpRepos(config) {
  const owner =
    typeof config?.github?.owner === 'string' ? config.github.owner.trim() : '';
  const repo =
    typeof config?.github?.repo === 'string' ? config.github.repo.trim() : '';
  const consumerRepo =
    owner && repo ? `${owner}/${repo}` : DEFAULT_FRAMEWORK_REPO;
  const frameworkRepo =
    typeof config?.github?.frameworkRepo === 'string' &&
    config.github.frameworkRepo.trim()
      ? config.github.frameworkRepo.trim()
      : DEFAULT_FRAMEWORK_REPO;
  const [cOwner, cRepo] = consumerRepo.split('/');
  return {
    frameworkRepo,
    consumerRepo,
    currentRepo: {
      owner: cOwner || 'unknown',
      repo: cRepo || 'unknown',
    },
  };
}

/**
 * Gather the Story's friction signals for the composer.
 *
 * **`storyId` and `details` are load-bearing (Story #4649).** This function
 * used to flatten every record to `{ category, source }`, which silently
 * dropped exactly the two fields `netOutRecoveredIncidents` keys on — so the
 * Story #4622 recovery-netting could never fire on real data, and every
 * transient friction event survived to be auto-filed. The composer's unit
 * tests passed throughout, because they fed it synthetic signals carrying
 * both fields that no production path ever produced. Preserve them.
 *
 * The record's own `storyId` is preferred over the argument so a stream that
 * carries foreign rows attributes each one correctly; the argument is the
 * fallback for records written before the field existed.
 *
 * @param {number} storyId
 * @param {object} [config]
 * @returns {Promise<Array<{ category: string, source: 'framework'|'consumer', storyId: number, details: object }>>}
 */
export async function gatherStoryFrictionSignals(storyId, config) {
  const signals = [];
  await forEachLine(
    null,
    storyId,
    (parsed) => {
      const signal = normalizeGatheredSignal(parsed, storyId);
      if (signal) signals.push(signal);
    },
    config,
  );
  return signals;
}

/**
 * Identity of one physical signal row, for de-duplication.
 *
 * `eventId` is minted by every producer (`diagnose-friction.js` and
 * `runtime-friction.js` both `crypto.randomUUID()` it), so it is the primary
 * key. A row predating the field falls back to its physical `file:line`,
 * which is equally stable — the same row read through two passes over the
 * same tree yields the same coordinates.
 *
 * @param {unknown} parsed
 * @param {string} file
 * @param {number} lineNumber
 * @returns {string}
 */
function signalIdentity(parsed, file, lineNumber) {
  const eventId =
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (/** @type {Record<string, unknown>} */ (parsed).eventId) ===
      'string'
      ? /** @type {string} */ (
          /** @type {Record<string, unknown>} */ (parsed).eventId
        ).trim()
      : '';
  return eventId.length > 0 ? `event:${eventId}` : `row:${file}:${lineNumber}`;
}

/**
 * Gather friction signals for the run-scoped roll-up, over the **whole
 * surviving recurrence window** rather than the run's own Stories
 * (Story #4824).
 *
 * The recurrence threshold in `retro-proposals.js` is ≥ 2 occurrences, and
 * the window it was measured over was one run's Story ids. A defect that
 * fires exactly **once per Story** — which is what a systemic framework
 * defect looks like — therefore scored 1 on every Story and was discarded as
 * a singleton, forever. Eighteen consecutive Stories filed nothing.
 *
 * So the gather reduces over every `signals.ndjson` still present under the
 * configured temp root: `<tempRoot>/standalone/stories/story-<sid>/` and
 * `<tempRoot>/run-<eid>/stories/story-<sid>/`. Temp-tree auto-purge
 * shortening that window is acceptable — a short window under-counts, and
 * therefore fails toward *not* filing, which is the safe direction.
 *
 * The run's own Stories are still gathered explicitly first. The discovery
 * walk resolves through the identical path helpers, so it is provably a
 * superset; the explicit pass makes "never fewer signals than before" a
 * property of the code rather than of an argument about path resolution.
 * {@link signalIdentity} de-duplicates the overlap, so one event can never be
 * counted twice and inflate a singleton into a fabricated recurrence.
 *
 * Homed beside {@link gatherStoryFrictionSignals} on purpose: the two used to
 * be independent copies of the same loop in two modules, and they drifted in
 * exactly the way that made the recovery-netting unreachable (Story #4649).
 * One reader, one normalizer, no second place to forget a field.
 *
 * Unusable ids are skipped rather than throwing — a roll-up must not fail the
 * epilogue over one malformed entry.
 *
 * @param {Array<number|string>} storyIds The run's own Stories.
 * @param {object} [config]
 * @returns {Promise<Array<{ category: string, source: 'framework'|'consumer', storyId: number, details: object }>>}
 */
export async function gatherRunFrictionSignals(storyIds, config) {
  const signals = [];
  const seen = new Set();
  const take = (parsed, fallbackStoryId, identity) => {
    if (seen.has(identity)) return;
    seen.add(identity);
    const signal = normalizeGatheredSignal(parsed, fallbackStoryId);
    if (signal) signals.push(signal);
  };

  for (const raw of Array.isArray(storyIds) ? storyIds : []) {
    const sid = Number(raw);
    if (!Number.isInteger(sid) || sid <= 0) continue;
    const file = signalsFile(null, sid, config);
    await forEachLine(
      null,
      sid,
      (parsed, lineNumber) =>
        take(parsed, sid, signalIdentity(parsed, file, lineNumber)),
      config,
    );
  }

  await forEachSignalStreamLine(
    (parsed, { storyId, file, lineNumber }) =>
      take(parsed, storyId, signalIdentity(parsed, file, lineNumber)),
    config,
  );

  return signals;
}

/**
 * Render the empty-roll-up line.
 *
 * Story #4578 — an empty roll-up over a multi-Story run must NOT read as
 * success. The pre-#4578 text ("No friction signals — nothing to follow up")
 * was *truthful* about the stream and *false* about the run: a 7-Story
 * delivery containing a mid-run git outage, a parked worker, and a
 * four-round acceptance critic rendered byte-identically to a genuinely
 * clean run. An operator cannot tell "nothing went wrong" from "the
 * telemetry never fired", and the second is likeliest exactly when the run
 * went worst.
 *
 * So the line is a function of `storyCount`:
 *   - `storyCount <= 1` → the honest, quiet reading is retained. A single
 *     Story that emitted nothing plausibly *was* clean, and crying wolf on
 *     every clean Story is how a warning channel gets tuned out.
 *   - `storyCount > 1`  → zero signals across N Stories is a **claim**, and
 *     the surrounding text says so and names the two readings, rather than
 *     asserting the flattering one.
 *
 * This mirrors the sibling precedent in `run-epilogue.js`'s
 * `renderDiffLines`, which refuses to let an unresolvable base diff render
 * as "0 changed files".
 *
 * @param {number} storyCount
 * @returns {string[]}
 */
function renderEmptyRollupLines(storyCount) {
  if (storyCount <= 1) {
    return ['_No friction signals — nothing to follow up._'];
  }
  return [
    `> ⚠️ **0 friction signals across ${storyCount} Stories — this is a claim, not a clean bill of health.**`,
    '> Either the run was genuinely friction-free, or telemetry never fired.',
    '> An empty stream is indistinguishable from a clean run, and it is least',
    '> likely to fill exactly when a run is going badly and the agent is busy.',
    '> The runtime emits friction from its own observables (`agent::blocked`',
    '> transitions, failed closes, exhausted merge waits) — so zero here also',
    '> means none of those fired. If the run had friction you can name, that',
    '> gap is itself the follow-up worth filing.',
  ];
}

/**
 * Render one discarded (below-threshold) roll-up row (Story #4824).
 *
 * The pre-#4824 row was `` `category` ×N `` and nothing else. That is exactly
 * how a defect firing once per Story stayed invisible for eighteen
 * consecutive Stories: an operator reading "×1" cannot tell a one-off from a
 * systemic defect whose window was too narrow to see it recur. The row now
 * names the emitting tools, the bucket fingerprint, and the number of
 * distinct Stories it spans — the cross-run count the widened recurrence
 * window produces.
 *
 * Every added field is optional so a caller passing a hand-built proposals
 * object (or an older persisted one) still renders.
 *
 * @param {{ category: string, occurrences: number, tools?: string[], fingerprint?: string, storyCount?: number }} item
 * @returns {string}
 */
function renderDiscardedItem(item) {
  const parts = [`\`${item.category}\` ×${item.occurrences}`];
  if (Number.isInteger(item.storyCount) && item.storyCount > 0) {
    const plural = item.storyCount === 1 ? 'Story' : 'Stories';
    parts.push(`across ${item.storyCount} ${plural}`);
  }
  if (Array.isArray(item.tools) && item.tools.length > 0) {
    parts.push(`via ${item.tools.map((t) => `\`${t}\``).join(', ')}`);
  }
  if (typeof item.fingerprint === 'string' && item.fingerprint.length > 0) {
    parts.push(`fingerprint \`${item.fingerprint}\``);
  }
  return parts.join(' — ');
}

/**
 * @param {{
 *   storyId: number,
 *   proposals: object,
 *   graduated: object,
 *   storyCount?: number,
 * }} args - `storyCount` (default 1) is how many Stories the roll-up spans;
 *   it decides whether an empty result reads as quiet or as a flagged claim.
 * @returns {string}
 */
export function buildFollowUpsCommentBody({
  storyId,
  proposals,
  graduated,
  storyCount = 1,
}) {
  const filed = Array.isArray(graduated?.filed) ? graduated.filed : [];
  const framework = proposals?.framework ?? [];
  const consumer = proposals?.consumer ?? [];
  const discarded = proposals?.discarded ?? [];
  const lines = [
    '### follow-ups',
    '',
    `Actionable follow-ups captured from Story #${storyId} after merge.`,
    '',
  ];
  if (filed.length > 0) {
    lines.push('**Filed**');
    for (const item of filed) {
      lines.push(
        `- ${item.source}: ${item.title}${item.url ? ` — ${item.url}` : ''}`,
      );
    }
    lines.push('');
  }
  if (framework.length + consumer.length > 0 && filed.length === 0) {
    lines.push('**Actionable (not auto-filed)**');
    for (const item of [...framework, ...consumer]) {
      lines.push(`- ${item.source}: ${item.title}`);
      lines.push('');
      lines.push('```bash');
      lines.push(item.command);
      lines.push('```');
    }
    lines.push('');
  }
  if (discarded.length > 0) {
    lines.push('**Below threshold (not filed)**');
    for (const item of discarded) {
      lines.push(`- ${item.source}: ${renderDiscardedItem(item)}`);
    }
    lines.push('');
  }
  if (
    filed.length === 0 &&
    framework.length === 0 &&
    consumer.length === 0 &&
    discarded.length === 0
  ) {
    lines.push(...renderEmptyRollupLines(storyCount));
    lines.push('');
  }
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        storyId,
        storyCount,
        framework: framework.map((i) => i.category),
        consumer: consumer.map((i) => i.category),
        // Story #4824 — the machine-readable twin of the row above. A bare
        // category list could not distinguish a genuine one-off from a
        // recurrence the window was too narrow to see, so the count, the
        // cross-Story span, and the shape fingerprint ride along.
        discarded: discarded.map((i) => ({
          category: i.category,
          occurrences: i.occurrences,
          storyCount: i.storyCount ?? null,
          fingerprint: i.fingerprint ?? null,
        })),
        filed: filed.map((i) => ({
          category: i.category,
          url: i.url ?? null,
        })),
        // Story #4578 — an empty roll-up over N>1 Stories is a claim worth
        // flagging, not a success. Machine-readable twin of the warning
        // prose so a caller need not regex the body.
        emptyRollupSuspect:
          storyCount > 1 &&
          filed.length === 0 &&
          framework.length === 0 &&
          consumer.length === 0 &&
          discarded.length === 0,
      },
      null,
      2,
    ),
  );
  lines.push('```');
  return lines.join('\n');
}

/**
 * Capture and persist Story follow-ups. Never throws — the land must not
 * fail because follow-up filing flaked.
 *
 * Story #4543 retired the `captureFollowUpsAfterConfirm` action-gate wrapper
 * (and its `withConfirmFollowUps` sibling) that used to front this function.
 * Re-deriving "did the merge land?" from a confirmation envelope's `action`
 * field was the coupling that made close-and-land — the DEFAULT path — skip
 * capture entirely: the gate only opened on the standalone CLI's `done`, and
 * a belated manual confirm could not backfill because the Story was already
 * `agent::done` (confirm returns `noop`, the gate never opens). The shared
 * land tail (`single-story-close/phases/post-land.js`) now calls this
 * directly, after the merge is already confirmed.
 *
 * @param {object} args
 * @param {number} args.storyId
 * @param {object} args.provider
 * @param {object} [args.config]
 * @param {string} [args.cwd]
 * @param {(tag: string, msg: string) => void} [args.progress]
 * @returns {Promise<object>}
 */
export async function captureStoryFollowUps({
  storyId,
  provider,
  config,
  cwd,
  progress,
}) {
  const sid = Number(storyId);
  if (!Number.isInteger(sid) || sid <= 0) {
    return { ok: false, reason: 'invalid-story-id' };
  }
  try {
    const signals = await gatherStoryFrictionSignals(sid, config);
    const repos = resolveFollowUpRepos(config);
    const proposals = composeRoutedProposals({
      anchorId: sid,
      anchorKind: 'story',
      frameworkRepo: repos.frameworkRepo,
      consumerRepo: repos.consumerRepo,
      signals,
      // Derived, not hardcoded `[]` (Story #4649). This is the escape hatch
      // the retired story-scope threshold carve-out was standing in for: a
      // Story still parked at `agent::blocked` files at a single occurrence,
      // while one that blocked and self-resolved nets out entirely.
      unresolvedBlockedEvents: deriveUnresolvedBlockedEvents(signals),
    });
    const graduated = await graduateRetroProposals({
      epicId: sid,
      provider,
      config,
      currentRepo: repos.currentRepo,
      frameworkRepo: (() => {
        const [owner, repo] = repos.frameworkRepo.split('/');
        return { owner, repo };
      })(),
      routedProposals: proposals,
      cwd,
    });
    const body = buildFollowUpsCommentBody({
      storyId: sid,
      proposals,
      graduated,
    });
    await upsertStructuredComment(provider, sid, FOLLOW_UPS_COMMENT_TYPE, body);
    progress?.(
      'FOLLOW-UPS',
      `Captured follow-ups for Story #${sid} (filed=${graduated.filed?.length ?? 0}).`,
    );
    return {
      ok: true,
      storyId: sid,
      proposals,
      graduated,
      signalCount: signals.length,
    };
  } catch (err) {
    Logger.warn(
      `[story-follow-ups] capture failed for #${sid}: ${err?.message ?? err}`,
    );
    progress?.(
      'FOLLOW-UPS',
      `⚠️ Follow-up capture failed (close continues): ${err?.message ?? err}`,
    );
    return {
      ok: false,
      reason: 'capture-failed',
      error: String(err?.message ?? err),
    };
  }
}
