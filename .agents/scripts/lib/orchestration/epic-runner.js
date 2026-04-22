/**
 * EpicRunner — thin coordinator composing a collaborator factory and five
 * sequential phase modules.
 *
 * Public API: `runEpic({ epicId, provider, config, spawn, fetchImpl, ... })`
 * or `runEpic({ ctx })` with a pre-built `EpicRunnerContext`.
 *
 * Flow:
 *   1. smoke-test     — `claude --version` probe. Halts if the spawner is broken.
 *   2. snapshot       — fetch Epic, snapshot `epic::auto-close`.
 *   3. build-wave-dag — filter child Stories, compute waves.
 *   4. iterate-waves  — flip label, init checkpoint, run wave loop,
 *                       delegate blocker halts.
 *   5. finalize       — flip to review + run bookends (completed) or
 *                       settle blocked column sync (halted).
 */

import { EpicRunnerContext } from './context.js';
import { createEpicRunnerCollaborators } from './epic-runner/factory.js';
import { runBuildWaveDagPhase } from './epic-runner/phases/build-wave-dag.js';
import { runFinalizePhase } from './epic-runner/phases/finalize.js';
import { runIterateWavesPhase } from './epic-runner/phases/iterate-waves.js';
import { runSnapshotPhase } from './epic-runner/phases/snapshot.js';
import { runSmokeTestPhase } from './epic-runner/phases/smoke-test.js';
import { ErrorJournal } from './error-journal.js';

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
 *   smokeTest?: { verify(): Promise<{ ok: boolean, detail?: string }> },
 * }} args
 */
export async function runEpic(args = {}) {
  const ctx =
    args.ctx instanceof EpicRunnerContext
      ? args.ctx
      : new EpicRunnerContext(args);
  return runEpicWithContext(ctx, { smokeTest: args.smokeTest });
}

export async function runEpicWithContext(ctx, injected = {}) {
  const { epicId, errorJournal } = ctx;
  const journal = errorJournal ?? new ErrorJournal({ epicId });
  const collaborators = {
    ...createEpicRunnerCollaborators(ctx, { errorJournal: journal }),
    smokeTest: injected.smokeTest,
  };

  let state = {};
  state = await runSmokeTestPhase(ctx, collaborators, state);
  if (state.halted) return state.halted;

  state = await runSnapshotPhase(ctx, collaborators, state);
  state = await runBuildWaveDagPhase(ctx, collaborators, state);
  state = await runIterateWavesPhase(ctx, collaborators, state);
  return runFinalizePhase(ctx, collaborators, state);
}
