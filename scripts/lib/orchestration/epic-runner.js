/**
 * EpicRunner — thin coordinator composing the six submodules.
 *
 * Public API: `runEpic({ epicId, provider, config, spawn, fetchImpl })`.
 * Every submodule is constructed with dependency injection so the entire
 * engine is testable without real network or subprocess IO.
 *
 * Flow (happy path):
 *   1. Flip Epic to `agent::executing`, snapshot `autoClose`.
 *   2. Initialize / read checkpoint.
 *   3. For each wave N: launch stories (StoryLauncher), wait, update
 *      checkpoint, advance.
 *   4. On any `failed`/`blocked` result: delegate to BlockerHandler, which
 *      halts wave N+1 and waits for operator resume.
 *   5. After final wave: flip Epic to `agent::review`, optionally run
 *      BookendChainer.
 */

import { parseBlockedBy } from '../dependency-parser.js';
import { computeWaves } from '../Graph.js';
import { createNotifier } from '../notifications/notifier.js';
import { BlockerHandler } from './epic-runner/blocker-handler.js';
import { BookendChainer } from './epic-runner/bookend-chainer.js';
import { Checkpointer } from './epic-runner/checkpointer.js';
import { ColumnSync } from './epic-runner/column-sync.js';
import { NotificationHook } from './epic-runner/notification-hook.js';
import { StoryLauncher } from './epic-runner/story-launcher.js';
import { WaveObserver } from './epic-runner/wave-observer.js';
import { WaveScheduler } from './epic-runner/wave-scheduler.js';
import { STATE_LABELS, transitionTicketState } from './ticketing.js';

const AUTO_CLOSE_LABEL = 'epic::auto-close';

/**
 * @param {{
 *   epicId: number,
 *   provider: import('../ITicketingProvider.js').ITicketingProvider,
 *   config: object,
 *   spawn: (args: { storyId: number, worktree?: string, signal: AbortSignal }) => Promise<{ status: string, detail?: string }>,
 *   worktreeResolver?: (storyId: number) => string,
 *   fetchImpl?: typeof fetch,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} args
 */
export async function runEpic({
  epicId,
  provider,
  config,
  spawn,
  worktreeResolver,
  fetchImpl,
  runSkill,
  logger = console,
}) {
  if (!Number.isInteger(epicId)) throw new TypeError('epicId must be integer');
  if (!provider) throw new TypeError('provider is required');
  if (!config?.epicRunner?.enabled) {
    throw new Error(
      'orchestration.epicRunner.enabled is false — refusing to run.',
    );
  }
  if (typeof spawn !== 'function') throw new TypeError('spawn is required');

  const { concurrencyCap, pollIntervalSec } = config.epicRunner;

  // --- 1. Snapshot Epic state ---
  const epic = await provider.getTicket(epicId);
  const epicLabels = new Set(epic.labels ?? []);
  const autoClose = epicLabels.has(AUTO_CLOSE_LABEL);

  // --- 2. Build the wave DAG from child Stories ---
  // `getSubTickets` returns the full descendant set (Features, PRDs,
  // Tech Specs, Stories, Tasks) via native sub-issues + body reverse-lookup.
  // The epic-runner only dispatches Stories, so filter by `type::story`
  // before building the DAG — otherwise non-stories reach `sprint-story-init`
  // and fail the type guard in `resolveStoryContext`.
  const descendants = await provider.getSubTickets(epicId);
  const stories = (descendants ?? []).filter((t) =>
    (t.labels ?? []).includes('type::story'),
  );
  if (!stories.length) {
    throw new Error(`Epic #${epicId} has no child stories to dispatch.`);
  }
  const { adjacency, taskMap } = buildStoryDag(stories);
  const waves = computeWaves(adjacency, taskMap);
  const scheduler = new WaveScheduler(waves);

  // --- 3. Compose collaborators ---
  const notifier = createNotifier(config, provider, { fetchImpl, logger });
  const checkpointer = new Checkpointer({ provider, epicId });
  const notificationHook = new NotificationHook({
    fetchImpl,
    logger,
  });
  const blockerHandler = new BlockerHandler({
    provider,
    epicId,
    notificationHook,
    pollIntervalMs: pollIntervalSec * 1000,
    logger,
  });
  const launcher = new StoryLauncher({
    concurrencyCap,
    spawn,
    worktreeResolver,
    logger,
  });
  const waveObserver = new WaveObserver({ provider, epicId, logger });
  const columnSync = new ColumnSync({
    provider,
    projectNumber: config?.github?.projectNumber ?? null,
    logger,
  });
  const syncColumn = async (id, labels) => {
    try {
      await columnSync.sync(id, labels);
    } catch (err) {
      logger.warn?.(
        `[EpicRunner] column sync failed for #${id}: ${err.message}`,
      );
    }
  };

  // --- 4. Initialize checkpoint and flip label ---
  await transitionTicketState(provider, epicId, STATE_LABELS.EXECUTING, {
    notifier,
  }).catch((err) =>
    logger.warn?.(`[EpicRunner] label flip failed: ${err.message}`),
  );
  await syncColumn(epicId, [STATE_LABELS.EXECUTING]);
  const state = await checkpointer.initialize({
    totalWaves: scheduler.totalWaves,
    concurrencyCap,
    autoClose,
  });
  // Authoritative snapshot — on a resume, re-use whatever autoClose was
  // captured at dispatch time, ignoring mid-run label changes.
  const effectiveAutoClose = Boolean(state.autoClose);

  const bookends = new BookendChainer({
    autoClose: effectiveAutoClose,
    epicId,
    runSkill,
    postComment: (id, payload) => provider.postComment(id, payload),
    logger,
  });

  // --- 5. Wave loop ---
  const waveHistory = [];
  while (scheduler.hasMoreWaves()) {
    const wave = scheduler.nextWave();
    logger.info?.(
      `[EpicRunner] Wave ${wave.index + 1}/${scheduler.totalWaves} dispatching ${wave.stories.length} stor${wave.stories.length === 1 ? 'y' : 'ies'}`,
    );
    const { startedAt } = await waveObserver.waveStart({
      index: wave.index,
      totalWaves: scheduler.totalWaves,
      stories: wave.stories,
    });

    const results = await launcher.launchWave(wave.stories);
    const failures = results.filter(
      (r) => r.status === 'failed' || r.status === 'blocked',
    );

    scheduler.markWaveComplete(wave.index);
    await waveObserver.waveEnd({
      index: wave.index,
      totalWaves: scheduler.totalWaves,
      startedAt,
      stories: results,
    });

    waveHistory.push({
      index: wave.index,
      status: failures.length ? 'halted' : 'completed',
      stories: results,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    await checkpointer.write({
      ...state,
      currentWave: scheduler.currentWave,
      totalWaves: scheduler.totalWaves,
      waves: waveHistory,
      autoClose: effectiveAutoClose,
    });

    if (failures.length) {
      const firstFailure = failures[0];
      await syncColumn(epicId, ['agent::blocked']);
      const halt = await blockerHandler.halt({
        reason:
          firstFailure.status === 'blocked' ? 'story_blocked' : 'story_failed',
        storyId: firstFailure.storyId,
        detail: firstFailure.detail,
      });
      if (!halt.resumed) {
        return finalize({
          provider,
          epicId,
          state: 'halted',
          waveHistory,
          bookends,
          logger,
          syncColumn,
        });
      }
      await syncColumn(epicId, [STATE_LABELS.EXECUTING]);
    }
  }

  return finalize({
    provider,
    epicId,
    state: 'completed',
    waveHistory,
    bookends,
    logger,
    syncColumn,
    notifier,
  });
}

async function finalize({
  provider,
  epicId,
  state,
  waveHistory,
  bookends,
  logger,
  syncColumn,
  notifier,
}) {
  if (state === 'completed') {
    await transitionTicketState(provider, epicId, STATE_LABELS.REVIEW, {
      notifier,
    }).catch((err) =>
      logger.warn?.(`[EpicRunner] review flip failed: ${err.message}`),
    );
    await syncColumn?.(epicId, [STATE_LABELS.REVIEW]);
    const bookendResult = await bookends.run();
    if (bookendResult?.completed) {
      await syncColumn?.(epicId, [STATE_LABELS.DONE]);
    }
    return { epicId, state, waveHistory, bookendResult };
  }
  await syncColumn?.(epicId, ['agent::blocked']);
  return { epicId, state, waveHistory, bookendResult: null };
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
