/**
 * EpicRunner collaborator factory.
 *
 * `createEpicRunnerCollaborators(ctx)` returns the full collaborator bag
 * consumed by the epic-runner phases. Construction order and injected
 * dependencies match the pre-split layout in `epic-runner.js` so parity
 * tests continue to pass unchanged.
 *
 * Returned object:
 *   notifier, checkpointer, notificationHook, blockerHandler, launcher,
 *   gitAdapter, commitAssertion, waveObserver, frictionEmitter,
 *   progressReporter, columnSync, syncColumn (closure wrapping columnSync.sync
 *   with error-journal logging).
 */

import { createNotifier } from '../../notifications/notifier.js';
import { createFrictionEmitter } from '../friction-emitter.js';
import { BlockerHandler } from './blocker-handler.js';
import { Checkpointer } from './checkpointer.js';
import { ColumnSync } from './column-sync.js';
import { buildDefaultGitAdapter, CommitAssertion } from './commit-assertion.js';
import { NotificationHook } from './notification-hook.js';
import { ProgressReporter } from './progress-reporter.js';
import { StoryLauncher } from './story-launcher.js';
import { WaveObserver } from './wave-observer.js';

const DEFAULT_LOGS_DIR = 'temp/epic-runner-logs';

/**
 * Resolve the absolute-ish file path the ProgressReporter should tee rendered
 * snapshots to. Returns `null` when progress reporting is disabled.
 */
export function resolveProgressLogFile(epicRunnerCfg, epicId) {
  const intervalSec = Number(epicRunnerCfg?.progressReportIntervalSec ?? 0);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  const dir = epicRunnerCfg?.logsDir || DEFAULT_LOGS_DIR;
  return `${dir.replace(/[/\\]$/, '')}/epic-${epicId}-progress.log`;
}

export function createEpicRunnerCollaborators(ctx, { errorJournal } = {}) {
  const { epicId, provider, config, logger, fetchImpl } = ctx;
  const { pollIntervalSec } = config.epicRunner;
  const journal = errorJournal ?? ctx.errorJournal;
  const journalSuffix = () => (journal?.path ? ` (see ${journal.path})` : '');

  const notifier =
    ctx.notifier ??
    createNotifier(config, provider, { fetchImpl, logger, cwd: ctx.cwd });
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
    ctx.commitAssertion ?? new CommitAssertion({ ctx, gitAdapter, logger });
  const waveObserver = new WaveObserver({ ctx, commitAssertion });
  const frictionEmitter = createFrictionEmitter({ provider, logger });
  const progressLogFile = resolveProgressLogFile(config?.epicRunner, epicId);
  const progressReporter = new ProgressReporter({
    ctx,
    intervalSec: Number(config?.epicRunner?.progressReportIntervalSec ?? 0),
    frictionEmitter,
    logFile: progressLogFile,
  });
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

  return {
    notifier,
    checkpointer,
    notificationHook,
    blockerHandler,
    launcher,
    gitAdapter,
    commitAssertion,
    waveObserver,
    frictionEmitter,
    progressReporter,
    columnSync,
    syncColumn,
    journal,
  };
}
