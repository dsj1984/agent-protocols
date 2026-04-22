#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-plan.js — Local `/sprint-plan` wrapper.
 *
 * Thin orchestrator that chains the split plan-phase CLIs for IDE-driven
 * planning:
 *
 *   1. Run the spec phase via `sprint-plan-spec.js`.
 *   2. Surface PRD / Tech Spec URLs plus the next-step prompt.
 *   3. Wait for operator confirmation (handled by the host LLM in chat —
 *      this script exits cleanly after Step 1 when `--pause-after-spec` is
 *      set, letting the wrapping skill resume after human approval).
 *   4. Run the decompose phase via `sprint-plan-decompose.js`.
 *   5. On `--auto-dispatch`, apply `agent::dispatching` so the operator
 *      doesn't need to return to GitHub to kick off execution.
 *
 * The script is intentionally small — the heavy lifting lives in each
 * sub-CLI. This wrapper primarily owns the in-chat confirmation gate and
 * the optional `--auto-dispatch` transition.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import {
  resolveConfig,
  validateOrchestrationConfig,
} from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { AGENT_LABELS } from './lib/label-constants.js';
import {
  PLAN_PHASES,
  PlanCheckpointer,
} from './lib/orchestration/plan-runner/plan-checkpointer.js';
import {
  advancePhase,
  nextPhaseForEpic,
  PLAN_PHASE_NAMES,
} from './lib/orchestration/plan-runner/plan-router.js';
import { createProvider } from './lib/provider-factory.js';
import { runDecomposePhase } from './sprint-plan-decompose.js';
import { runSpecPhase } from './sprint-plan-spec.js';

/**
 * Flip the Epic to `agent::dispatching` (removes the `agent::ready` parking
 * label). Used by `--auto-dispatch` and by downstream remote tooling.
 */
export async function applyDispatching(provider, epicId) {
  const planningLabels = [
    AGENT_LABELS.PLANNING,
    AGENT_LABELS.REVIEW_SPEC,
    AGENT_LABELS.DECOMPOSING,
    AGENT_LABELS.READY,
  ];
  await provider.updateTicket(epicId, {
    labels: {
      add: [AGENT_LABELS.DISPATCHING],
      remove: planningLabels,
    },
  });
}

/**
 * Orchestrate the full local plan. Intentionally side-effect-free on its
 * arguments — all I/O happens through `provider` and the two phase runners.
 *
 * @param {{
 *   epicId: number,
 *   provider: import('./lib/ITicketingProvider.js').ITicketingProvider,
 *   settings: object,
 *   config: object,
 *   artifacts: { prdContent: string, techSpecContent: string, tickets: Array<object> },
 *   force?: boolean,
 *   autoDispatch?: boolean,
 *   runSpec?: typeof runSpecPhase,
 *   runDecompose?: typeof runDecomposePhase,
 *   applyDispatchingFn?: typeof applyDispatching,
 * }} opts
 */
export async function runSprintPlan({
  epicId,
  provider,
  settings,
  config,
  artifacts,
  force = false,
  autoDispatch = false,
  runSpec = runSpecPhase,
  runDecompose = runDecomposePhase,
  applyDispatchingFn = applyDispatching,
}) {
  const specResult = await runSpec(
    epicId,
    provider,
    {
      prdContent: artifacts.prdContent,
      techSpecContent: artifacts.techSpecContent,
    },
    settings,
    { force },
  );

  const decomposeResult = await runDecompose(
    epicId,
    provider,
    { tickets: artifacts.tickets },
    config,
    { force },
  );

  let dispatchApplied = false;
  if (autoDispatch) {
    console.log(
      `[sprint-plan] --auto-dispatch: applying ${AGENT_LABELS.DISPATCHING} to Epic #${epicId}...`,
    );
    await applyDispatchingFn(provider, epicId);
    dispatchApplied = true;
  }

  return {
    epicId,
    spec: specResult,
    decompose: decomposeResult,
    dispatchApplied,
  };
}

/**
 * Read the `epic-plan-state` checkpoint and return the recommended next
 * phase the wrapper should invoke. Surface-only helper — used by the host
 * LLM to decide whether to resume after a paused spec phase.
 *
 * @param {{ provider: object, epicId: number }} ctx
 * @returns {Promise<{ nextPhase: string|null, checkpoint: object|null, epicLabels: string[] }>}
 */
export async function describePlanResumePoint({ provider, epicId }) {
  const checkpointer = new PlanCheckpointer({ provider, epicId });
  const checkpoint = await checkpointer.read();
  const epic = await provider.getEpic(epicId);
  const labels = epic?.labels ?? [];
  const next = nextPhaseForEpic(labels);
  return {
    nextPhase: next?.phase ?? null,
    checkpoint,
    epicLabels: labels,
  };
}

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      prd: { type: 'string' },
      techspec: { type: 'string' },
      tickets: { type: 'string' },
      force: { type: 'boolean', default: false },
      'auto-dispatch': { type: 'boolean', default: false },
      'describe-resume-point': { type: 'boolean', default: false },
    },
  });

  if (!values.epic) {
    Logger.fatal(
      'Usage: sprint-plan.js --epic <EpicId> --prd <file> --techspec <file> --tickets <file> [--force] [--auto-dispatch]',
    );
  }

  const epicId = Number.parseInt(values.epic, 10);
  if (Number.isNaN(epicId)) {
    Logger.fatal(`Invalid epic ID: "${values.epic}" — must be a number.`);
  }

  let config;
  try {
    config = resolveConfig();
    validateOrchestrationConfig(config.orchestration);
  } catch (err) {
    Logger.fatal(
      `Orchestration config schema validation failed:\n${err.message}`,
    );
  }
  const { orchestration, settings } = config;
  const provider = createProvider(orchestration);

  if (values['describe-resume-point']) {
    const info = await describePlanResumePoint({ provider, epicId });
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    return;
  }

  if (!values.prd || !values.techspec || !values.tickets) {
    Logger.fatal(
      'Missing required inputs. Need --prd, --techspec, and --tickets files.',
    );
  }

  const [prdContent, techSpecContent, ticketsRaw] = await Promise.all([
    readFile(values.prd, 'utf8'),
    readFile(values.techspec, 'utf8'),
    readFile(values.tickets, 'utf8'),
  ]);

  let tickets;
  try {
    tickets = JSON.parse(ticketsRaw);
  } catch (err) {
    Logger.fatal(
      `Failed to parse tickets file "${values.tickets}" as JSON: ${err.message}`,
    );
  }

  const result = await runSprintPlan({
    epicId,
    provider,
    settings,
    config,
    artifacts: { prdContent, techSpecContent, tickets },
    force: values.force,
    autoDispatch: values['auto-dispatch'],
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// Re-export the phase names/enums so downstream tooling can import them from
// a single entry point. `advancePhase` and `PLAN_PHASES` (phase-name enum)
// are the two most common consumers.
export { advancePhase, PLAN_PHASE_NAMES, PLAN_PHASES, PlanCheckpointer };

runAsCli(import.meta.url, main, { source: 'sprint-plan' });
