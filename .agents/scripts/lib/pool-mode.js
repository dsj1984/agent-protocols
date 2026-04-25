/**
 * lib/pool-mode.js — Claim-based pool mode for `/sprint-execute`.
 *
 * When `/sprint-execute` is invoked without a story id, the slash-command
 * workflow asks this module to pick the next eligible story from the Epic's
 * dispatch manifest and claim it before init runs. Eligibility = story is
 * `agent::ready`, has no `in-progress-by:*` label, and has no unmerged
 * cross-story blockers per the manifest.
 *
 * Race model: claims are best-effort. The label add + read-back here lets
 * concurrent sessions notice they collided so the loser can release; final
 * serialisation comes from origin (only one session can push the story
 * branch). See tech spec #670 § Pool-mode claim protocol.
 */

import {
  findStructuredComment,
  upsertStructuredComment,
} from './orchestration/ticketing.js';

const READY_LABEL = 'agent::ready';
const DONE_LABEL = 'agent::done';
const CLAIM_LABEL_PREFIX = 'in-progress-by:';

/**
 * Build the `in-progress-by:<sessionId>` label for a session.
 *
 * @param {string} sessionId
 * @returns {string}
 */
export function claimLabelForSession(sessionId) {
  return `${CLAIM_LABEL_PREFIX}${sessionId}`;
}

/**
 * Build the marker-key type for a story's claim comment.
 *
 * @param {number} storyId
 * @returns {string}
 */
export function claimCommentType(storyId) {
  return `claim-${storyId}`;
}

/**
 * Filter a label list down to active claim labels.
 *
 * @param {string[]} labels
 * @returns {string[]}
 */
export function findClaimLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.filter(
    (l) => typeof l === 'string' && l.startsWith(CLAIM_LABEL_PREFIX),
  );
}

/**
 * True when every task in a story manifest entry is `agent::done`.
 *
 * @param {{ tasks?: Array<{ status?: string }> }} story
 * @returns {boolean}
 */
function allTasksDone(story) {
  const tasks = story?.tasks ?? [];
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === DONE_LABEL);
}

/**
 * Returns true when every cross-story blocker for `story` is fully merged.
 * Used to skip stories whose upstream work hasn't landed yet — the same
 * gate the launch-time dependency guard enforces, but applied at claim time
 * so pool mode never picks a doomed candidate.
 *
 * @param {object} story
 * @param {Map<number, object>} storyById
 * @param {Map<number, number>} taskParent
 * @returns {boolean}
 */
function blockersMerged(story, storyById, taskParent) {
  const blockerIds = new Set();
  for (const t of story.tasks ?? []) {
    for (const depId of t.dependencies ?? []) {
      const parent = taskParent.get(Number(depId));
      if (parent && parent !== Number(story.storyId)) blockerIds.add(parent);
    }
  }
  for (const bid of blockerIds) {
    const blocker = storyById.get(bid);
    if (!blocker || !allTasksDone(blocker)) return false;
  }
  return true;
}

function indexManifest(manifest) {
  const stories = manifest?.storyManifest ?? [];
  const storyById = new Map();
  const taskParent = new Map();
  for (const s of stories) {
    if (s.storyId === '__ungrouped__') continue;
    storyById.set(Number(s.storyId), s);
    for (const t of s.tasks ?? []) {
      taskParent.set(Number(t.taskId), Number(s.storyId));
    }
  }
  return { stories, storyById, taskParent };
}

/**
 * Find the next eligible story to claim from a dispatch manifest. Eligibility:
 *   - Status: at least one task `agent::ready` and not all tasks `agent::done`.
 *   - GitHub state: no `in-progress-by:*` label currently set on the issue.
 *   - Dependencies: every cross-story blocker is fully merged in the manifest.
 *
 * Stories are scanned in `(earliestWave, storyId)` order so two sessions
 * launched against the same wave consistently agree on the priority of
 * candidates and only race on the same first choice.
 *
 * @param {number} epicId
 * @param {object} manifest
 * @param {{
 *   runtime: { sessionId: string },
 *   provider: { getTicket: Function },
 * }} ctx
 * @returns {Promise<
 *   | { storyId: number, story: object }
 *   | { reason: 'no-eligible', details: { scanned: number, skipped: object[] } }>}
 */
export async function findEligibleStory(_epicId, manifest, ctx) {
  const { provider } = ctx;
  const { stories, storyById, taskParent } = indexManifest(manifest);

  const candidates = stories
    .filter((s) => s.storyId !== '__ungrouped__')
    .filter((s) => !allTasksDone(s))
    .filter(
      (s) =>
        Array.isArray(s.tasks) &&
        s.tasks.some((t) => t.status === READY_LABEL || t.status == null),
    )
    .sort((a, b) => {
      const wa = typeof a.earliestWave === 'number' ? a.earliestWave : 999;
      const wb = typeof b.earliestWave === 'number' ? b.earliestWave : 999;
      if (wa !== wb) return wa - wb;
      return Number(a.storyId) - Number(b.storyId);
    });

  const skipped = [];
  for (const story of candidates) {
    const sid = Number(story.storyId);
    if (!blockersMerged(story, storyById, taskParent)) {
      skipped.push({ storyId: sid, reason: 'blocked' });
      continue;
    }
    const ticket = await provider.getTicket(sid);
    const labels = ticket?.labels ?? [];
    if (findClaimLabels(labels).length > 0) {
      skipped.push({ storyId: sid, reason: 'already-claimed' });
      continue;
    }
    if (!labels.includes(READY_LABEL)) {
      // Story task statuses say "ready" but the issue label has moved on
      // (e.g. operator already started it manually). Treat as claimed.
      skipped.push({ storyId: sid, reason: 'not-ready-label' });
      continue;
    }
    return { storyId: sid, story };
  }

  return {
    reason: 'no-eligible',
    details: { scanned: candidates.length, skipped },
  };
}

/**
 * Claim a story by adding `in-progress-by:<sessionId>` and posting the
 * structured `[claim]` comment. After both writes, the labels are read back;
 * if more than one session's claim label is present, this session lost the
 * race and the caller must release and try the next candidate.
 *
 * @param {number} storyId
 * @param {{ sessionId: string }} runtime
 * @param {{ provider: object, nowIso?: string }} ctx
 * @returns {Promise<{ ok: boolean, raceDetected?: boolean, winnerSessionId?: string }>}
 */
export async function claimStory(storyId, runtime, ctx) {
  const { provider } = ctx;
  const sessionId = runtime?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('claimStory: runtime.sessionId is required');
  }

  const label = claimLabelForSession(sessionId);
  await provider.updateTicket(storyId, { labels: { add: [label] } });

  const at = ctx?.nowIso ?? new Date().toISOString();
  const body = `[claim] session=${sessionId} story=${storyId} at=${at}`;
  await upsertStructuredComment(
    provider,
    storyId,
    claimCommentType(storyId),
    body,
  );

  const ticket = await provider.getTicket(storyId);
  const claimLabels = findClaimLabels(ticket?.labels ?? []);

  if (claimLabels.length <= 1) return { ok: true };

  // Race lost. Resolve the winner deterministically so every loser agrees
  // on who keeps the story: lexicographic min of the session-id suffixes.
  const sessionIds = claimLabels
    .map((l) => l.slice(CLAIM_LABEL_PREFIX.length))
    .sort();
  const winnerSessionId = sessionIds[0];
  const ok = winnerSessionId === sessionId;
  return { ok, raceDetected: true, winnerSessionId };
}

/**
 * Remove this session's `in-progress-by:<sessionId>` label from a story.
 * Used after a race-loss in `claimStory`.
 *
 * @param {number} storyId
 * @param {{ sessionId: string }} runtime
 * @param {{ provider: object }} ctx
 * @returns {Promise<{ ok: true }>}
 */
export async function releaseStory(storyId, runtime, ctx) {
  const { provider } = ctx;
  const sessionId = runtime?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('releaseStory: runtime.sessionId is required');
  }
  await provider.updateTicket(storyId, {
    labels: { remove: [claimLabelForSession(sessionId)] },
  });
  return { ok: true };
}

/**
 * Surface stale claims: `in-progress-by:*` labels whose companion `[claim]`
 * comment is older than `staleClaimMinutes`. Operator decides whether to
 * reclaim — no automated sweep (out of scope per #669).
 *
 * @param {number} epicId
 * @param {{
 *   runtime?: object,
 *   provider: { getTicket: Function, getTicketComments: Function },
 *   manifest: object,
 *   nowMs?: number,
 *   staleClaimMinutes?: number,
 * }} ctx
 * @returns {Promise<Array<{
 *   storyId: number,
 *   sessionId: string,
 *   ageMinutes: number,
 *   storyTitle?: string,
 * }>>}
 */
export async function listReclaimable(_epicId, ctx) {
  const { provider, manifest } = ctx;
  const nowMs = ctx?.nowMs ?? Date.now();
  const staleMin = ctx?.staleClaimMinutes ?? 60;

  const { stories } = indexManifest(manifest);
  const reclaimable = [];

  for (const story of stories) {
    if (story.storyId === '__ungrouped__') continue;
    const sid = Number(story.storyId);
    const ticket = await provider.getTicket(sid);
    const claimLabels = findClaimLabels(ticket?.labels ?? []);
    if (claimLabels.length === 0) continue;

    const claim = await findStructuredComment(
      provider,
      sid,
      claimCommentType(sid),
    );
    const ageMinutes = ageMinutesFromComment(claim, nowMs);
    if (ageMinutes == null || ageMinutes < staleMin) continue;

    for (const label of claimLabels) {
      reclaimable.push({
        storyId: sid,
        sessionId: label.slice(CLAIM_LABEL_PREFIX.length),
        ageMinutes,
        storyTitle: story.storyTitle,
      });
    }
  }

  return reclaimable;
}

function ageMinutesFromComment(comment, nowMs) {
  if (!comment) return null;
  const at = comment.created_at ?? comment.createdAt;
  if (!at) return null;
  const ts = Date.parse(at);
  if (!Number.isFinite(ts)) return null;
  return Math.floor((nowMs - ts) / 60000);
}
