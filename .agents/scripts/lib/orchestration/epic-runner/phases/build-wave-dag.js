/**
 * Build the wave DAG from the Epic's child Stories.
 *
 * `getSubTickets` returns every descendant (Features, PRDs, Tech Specs,
 * Stories, Tasks) via native sub-issues + body reverse-lookup. The
 * epic-runner only dispatches Stories, so we filter by `type::story`
 * before building the DAG. Throws if there are no Stories.
 */

import { parseBlockedBy } from '../../../dependency-parser.js';
import { computeWaves } from '../../../Graph.js';
import { TYPE_LABELS } from '../../../label-constants.js';
import { WaveScheduler } from '../wave-scheduler.js';

export async function runBuildWaveDagPhase(ctx, _collaborators, state) {
  const { epicId, provider } = ctx;
  const descendants = await provider.getSubTickets(epicId);
  const stories = (descendants ?? []).filter((t) =>
    (t.labels ?? []).includes(TYPE_LABELS.STORY),
  );
  if (!stories.length) {
    throw new Error(`Epic #${epicId} has no child stories to dispatch.`);
  }
  const { adjacency, taskMap } = buildStoryDag(stories);
  const waves = computeWaves(adjacency, taskMap);
  const scheduler = new WaveScheduler(waves);
  return { ...state, stories, waves, scheduler };
}

/**
 * Convert an ordered list of story tickets into the adjacency/taskMap shape
 * that `Graph.computeWaves()` expects.
 *
 * Dependency source order (must match manifest-builder.js so dispatch manifest
 * and runtime wave scheduling never disagree):
 *   1. Canonical: `blocked by #NNN` / `depends on #NNN` parsed from the story
 *      ticket body via `parseBlockedBy` (same parser the dispatcher uses).
 *   2. Fallback: explicit `dependencies` array on the provider-returned story
 *      object (present in fixture / test payloads; optional in live GitHub
 *      payloads).
 * Only edges to other stories in this Epic are retained — foreign IDs are
 * dropped so the DAG stays closed over the scheduled set.
 */
function buildStoryDag(stories) {
  const adjacency = new Map();
  const taskMap = new Map();
  const storyIds = new Set(stories.map((s) => Number(s.id ?? s.number)));
  for (const s of stories) {
    const id = Number(s.id ?? s.number);
    const fromBody = parseBlockedBy(s.body ?? '');
    const fromField = Array.isArray(s.dependencies)
      ? s.dependencies.map(Number)
      : [];
    const merged = [...new Set([...fromBody, ...fromField])]
      .map(Number)
      .filter((dep) => dep !== id && storyIds.has(dep));
    adjacency.set(id, merged);
    taskMap.set(id, { ...s, id });
  }
  return { adjacency, taskMap };
}
