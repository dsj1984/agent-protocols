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
import { EpicRunnerContext } from './context.js';
import { BlockerHandler } from './epic-runner/blocker-handler.js';
import { BookendChainer } from './epic-runner/bookend-chainer.js';
import { Checkpointer } from './epic-runner/checkpointer.js';
import { ColumnSync } from './epic-runner/column-sync.js';
import {
  buildDefaultGitAdapter,
  CommitAssertion,
} from './epic-runner/commit-assertion.js';
import { NotificationHook } from './epic-runner/notification-hook.js';
import { ProgressReporter } from './epic-runner/progress-reporter.js';
import { SpawnSmokeTest } from './epic-runner/spawn-smoke-test.js';
import { StoryLauncher } from './epic-runner/story-launcher.js';
import { checkVersionBumpIntent } from './epic-runner/version-bump-intent.js';
import { WaveObserver } from './epic-runner/wave-observer.js';
import { WaveScheduler } from './epic-runner/wave-scheduler.js';
import { ErrorJournal } from './error-journal.js';
import { createFrictionEmitter } from './friction-emitter.js';
import {
  STATE_LABELS,
  transitionTicketState,
  upsertStructuredComment,
} from './ticketing.js';

const AUTO_CLOSE_LABEL = 'epic::auto-close';
const DEFAULT_LOGS_DIR = 'temp/epic-runner-logs';

/**
 * Resolve the absolute-ish file path the ProgressReporter should tee rendered
 * snapshots to, so the `/sprint-execute` Epic Mode skill can `Monitor` it for
 * live chat updates even when the runner is launched in a background Bash.
 *
 * Returns `null` when progress reporting is disabled (`progressReportIntervalSec`
 * <= 0) — no file churn on dry runs or opt-out configs.
 */
function resolveProgressLogFile(epicRunnerCfg, epicId) {
  const intervalSec = Number(epicRunnerCfg?.progressReportIntervalSec ?? 0);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const dir = epicRunnerCfg?.logsDir || DEFAULT_LOGS_DIR;
  return `${dir.replace(/[/\\]$/, '')}/epic-${epicId}-progress.log`;
}

/**
 * Entry point. Accepts either a pre-built `EpicRunnerContext` on `opts.ctx`
 * (preferred) or the legacy flat opts-bag (kept as a one-patch-release compat
 * shim — it is translated to a context internally before anything runs).
 *
 * @param {{
 *   ctx?: EpicRunnerContext,
 *   epicId?: number,
 *   provider?: import('../ITicketingProvider.js').ITicketingProvider,
 *   config?: object,
 *   spawn?: (args: { storyId: number, worktree?: string, signal: AbortSignal }) => Promise<{ status: string, detail?: string }>,
 *   worktreeResolver?: (storyId: number) => string,
 *   fetchImpl?: typeof fetch,
 *   runSkill?: Function,
 *   logger?: { info: Function, warn: Function, error: Function },
 *   errorJournal?: { record: Function, finalize: Function, path: string },
 * }} args
 */
export async function runEpic(args = {}) {
  const ctx =
    args.ctx instanceof EpicRunnerContext
      ? args.ctx
      : new EpicRunnerContext(args);
  return runEpicWithContext(ctx, { smokeTest: args.smokeTest });
}

async function runEpicWithContext(ctx, collaborators = {}) {
  const { epicId, provider, config, logger, fetchImpl, errorJournal } = ctx;
  const { concurrencyCap, pollIntervalSec } = config.epicRunner;
  const journal = errorJournal ?? new ErrorJournal({ epicId });
  const journalSuffix = () => (journal?.path ? ` (see ${journal.path})` : '');

  // --- 0. Pre-wave spawn smoke-test ---
  // Runs `claude --version` through the real `buildClaudeSpawn` shape before
  // any Story dispatches. A broken spawner (the Epic #380 regression class)
  // halts the runner here instead of producing a false-positive wave.
  const smokeTest = collaborators.smokeTest ?? new SpawnSmokeTest({ ctx });
  const smoke = await smokeTest.verify();
  if (!smoke.ok) {
    const body = [
      '### 🚧 Epic blocked — pre-wave spawn smoke-test failed',
      '',
      `The \`claude --version\` probe returned: \`${smoke.detail}\`.`,
      '',
      'No wave was dispatched. Fix the spawner regression, then flip this',
      'Epic back to `agent::executing` to resume.',
    ].join('\n');
    try {
      await upsertStructuredComment(provider, epicId, 'friction', body);
    } catch (err) {
      logger.warn?.(
        `[EpicRunner] smoke-test friction comment failed: ${err.message}${journalSuffix()}`,
      );
      await journal?.record({
        module: 'EpicRunner',
        op: 'upsertStructuredComment(friction, spawn-smoke-test)',
        error: err,
        recovery: 'swallowed',
      });
    }
    try {
      await provider.updateTicket(epicId, {
        labels: {
          add: ['agent::blocked'],
          remove: [STATE_LABELS.EXECUTING],
        },
      });
    } catch (err) {
      logger.warn?.(
        `[EpicRunner] smoke-test block-flip failed: ${err.message}${journalSuffix()}`,
      );
      await journal?.record({
        module: 'EpicRunner',
        op: 'updateTicket(labels: agent::blocked) [smoke-test]',
        error: err,
        recovery: 'swallowed',
      });
    }
    await journal?.finalize?.();
    return {
      epicId,
      state: 'halted',
      waveHistory: [],
      bookendResult: null,
      aborted: 'spawn-smoke-test',
      smokeTest: smoke,
    };
  }

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
  const notifier =
    ctx.notifier ?? createNotifier(config, provider, { fetchImpl, logger });
  const checkpointer = new Checkpointer({ ctx });
  const notificationHook = new NotificationHook({ ctx });
  const blockerHandler = new BlockerHandler({
    ctx,
    notificationHook,
    pollIntervalMs: pollIntervalSec * 1000,
    errorJournal: journal,
  });
  const launcher = new StoryLauncher({ ctx });
  const gitAdapter =
    ctx.gitAdapter ?? buildDefaultGitAdapter({ cwd: ctx.cwd ?? process.cwd() });
  const commitAssertion =
    ctx.commitAssertion ?? new CommitAssertion({ gitAdapter, logger });
  const waveObserver = new WaveObserver({ ctx, commitAssertion });
  const frictionEmitter = createFrictionEmitter({ provider, logger });
  const progressLogFile = resolveProgressLogFile(config?.epicRunner, epicId);
  const progressReporter = new ProgressReporter({
    ctx,
    intervalSec: Number(config?.epicRunner?.progressReportIntervalSec ?? 0),
    frictionEmitter,
    logFile: progressLogFile,
  });
  // Seed the reporter with the full wave plan so each fire renders every
  // wave (queued / in-flight / done) instead of only the active one.
  progressReporter.setPlan({ waves });
  const columnSync = new ColumnSync({ ctx });
  const syncColumn = async (id, labels) => {
    try {
      await columnSync.sync(id, labels);
    } catch (err) {
      logger.warn?.(
        `[EpicRunner] column sync failed for #${id}: ${err.message}${journalSuffix()}`,
      );
      await journal?.record({
        module: 'EpicRunner',
        op: `columnSync.sync(#${id})`,
        error: err,
        recovery: 'swallowed',
      });
    }
  };

  // --- 4. Initialize checkpoint and flip label ---
  await transitionTicketState(provider, epicId, STATE_LABELS.EXECUTING, {
    notifier,
  }).catch(async (err) => {
    logger.warn?.(
      `[EpicRunner] label flip failed: ${err.message}${journalSuffix()}`,
    );
    await journal?.record({
      module: 'EpicRunner',
      op: `transitionTicketState(#${epicId}, EXECUTING)`,
      error: err,
      recovery: 'swallowed',
    });
  });
  await syncColumn(epicId, [STATE_LABELS.EXECUTING]);
  const state = await checkpointer.initialize({
    totalWaves: scheduler.totalWaves,
    concurrencyCap,
    autoClose,
  });

  // Phase 0.5 — version-bump-intent snapshot. Emits a `notification`
  // structured comment when the Epic body declares a release target that
  // disagrees with `release.autoVersionBump`. No-op when they agree or no
  // directive is present.
  try {
    await checkVersionBumpIntent({
      provider,
      epicId,
      epicBody: epic.body ?? '',
      autoVersionBump: Boolean(ctx.autoVersionBump),
      logger,
    });
  } catch (err) {
    logger.warn?.(
      `[EpicRunner] version-bump-intent check failed: ${err.message}${journalSuffix()}`,
    );
    await journal?.record({
      module: 'EpicRunner',
      op: 'checkVersionBumpIntent',
      error: err,
      recovery: 'swallowed',
    });
  }
  // Authoritative snapshot — on a resume, re-use whatever autoClose was
  // captured at dispatch time, ignoring mid-run label changes.
  const effectiveAutoClose = Boolean(state.autoClose);

  const bookends = new BookendChainer({
    ctx,
    autoClose: effectiveAutoClose,
    postComment: (id, payload) => provider.postComment(id, payload),
    errorJournal: journal,
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

    progressReporter.setWave({
      index: wave.index,
      totalWaves: scheduler.totalWaves,
      stories: wave.stories,
      startedAt,
    });
    progressReporter.start();

    const launchResults = await launcher.launchWave(wave.stories);
    await progressReporter.stop();

    scheduler.markWaveComplete(wave.index);
    // waveEnd consults CommitAssertion and returns the reclassified rows —
    // use those for halt detection so a zero-delta story (reported `done` by
    // the sub-agent but no commits on its story branch) correctly halts
    // the wave rather than silently passing.
    const { stories: results = launchResults } = await waveObserver.waveEnd({
      index: wave.index,
      totalWaves: scheduler.totalWaves,
      startedAt,
      stories: launchResults,
    });
    const failures = results.filter(
      (r) => r.status === 'failed' || r.status === 'blocked',
    );

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
          journal,
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
    journal,
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
  journal,
}) {
  try {
    if (state === 'completed') {
      await transitionTicketState(provider, epicId, STATE_LABELS.REVIEW, {
        notifier,
      }).catch(async (err) => {
        const suffix = journal?.path ? ` (see ${journal.path})` : '';
        logger.warn?.(
          `[EpicRunner] review flip failed: ${err.message}${suffix}`,
        );
        await journal?.record({
          module: 'EpicRunner',
          op: `transitionTicketState(#${epicId}, REVIEW)`,
          error: err,
          recovery: 'swallowed',
        });
      });
      await syncColumn?.(epicId, [STATE_LABELS.REVIEW]);
      const bookendResult = await bookends.run();
      if (bookendResult?.completed) {
        await syncColumn?.(epicId, [STATE_LABELS.DONE]);
      }
      return { epicId, state, waveHistory, bookendResult };
    }
    await syncColumn?.(epicId, ['agent::blocked']);
    return { epicId, state, waveHistory, bookendResult: null };
  } finally {
    await journal?.finalize?.();
  }
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
