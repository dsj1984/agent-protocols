#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * sprint-plan-spec.js — Phase 1 (spec) entry point for the split planning flow.
 *
 * Wraps `epic-planner.js` behind two idempotent modes and a single-purpose
 * label lifecycle:
 *
 *   1. --emit-context   Prints the planner authoring context (Epic body,
 *                       scraped project docs, recommended system prompts) as
 *                       JSON. Host LLM consumes this to author the PRD and
 *                       Tech Spec markdown.
 *
 *   2. (default)        Given author-provided PRD and Tech Spec files, flips
 *                       the Epic to `agent::planning` (parking), persists the
 *                       two artifact issues, flips the Epic to
 *                       `agent::review-spec`, and upserts the `epic-plan-state`
 *                       structured comment.
 *
 * --force regenerates existing PRD/Tech Spec (same semantics as
 * `epic-planner.js --force`).
 *
 * Exit codes:
 *   0 — phase complete, Epic is now `agent::review-spec`.
 *   1 — fatal error (see stderr).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';
import { AGENT_LABELS, TYPE_LABELS } from './lib/label-constants.js';
import { Logger } from './lib/Logger.js';
import { buildAuthoringContext, planEpic } from './epic-planner.js';
import { PlanRunnerContext } from './lib/orchestration/context.js';
import {
  PlanCheckpointer,
  PLAN_PHASES,
} from './lib/orchestration/plan-runner/plan-checkpointer.js';
import { createProvider } from './lib/provider-factory.js';
import * as gitUtils from './lib/git-utils.js';
import {
  drainPendingCleanup,
  readManifest,
} from './lib/worktree/pending-cleanup.js';

/**
 * Drain the `.worktrees/.pending-cleanup.json` manifest left behind by Stage 1
 * reap failures. Runs at `/sprint-plan-spec` boot before any downstream work.
 *
 * Non-blocking: entries that still fail this pass stay in the manifest for the
 * next sweep; plan execution continues regardless.
 *
 * Exposed for integration tests.
 *
 * @param {{ repoRoot?: string, git?: object, logger?: object }} [opts]
 * @returns {Promise<{ drained: number[], persistent: number[], stillPending: number[], remaining: number }>}
 */
export async function drainPendingCleanupAtBoot(opts = {}) {
  const repoRoot = opts.repoRoot ?? PROJECT_ROOT;
  const worktreeRoot = path.join(repoRoot, '.worktrees');
  const git = opts.git ?? gitUtils;
  const logger = opts.logger ?? console;
  const fsRm = opts.fsRm;

  const before = readManifest(worktreeRoot).length;
  if (before === 0) {
    return { drained: [], persistent: [], stillPending: [], remaining: 0 };
  }

  const result = await drainPendingCleanup({
    repoRoot,
    worktreeRoot,
    git,
    fsRm,
    logger,
  });
  const remaining =
    (result.persistent?.length ?? 0) + (result.stillPending?.length ?? 0);
  logger.info?.(
    `[sprint-plan-spec] pending-cleanup drain: reaped=${result.drained?.length ?? 0} remaining=${remaining}`,
  );
  return { ...result, remaining };
}

async function setEpicLabel(provider, epicId, targetLabel) {
  const planningLabels = [
    AGENT_LABELS.PLANNING,
    AGENT_LABELS.REVIEW_SPEC,
    AGENT_LABELS.DECOMPOSING,
    AGENT_LABELS.READY,
  ];
  await provider.updateTicket(epicId, {
    labels: {
      add: [targetLabel],
      remove: planningLabels.filter((l) => l !== targetLabel),
    },
  });
}

/**
 * Execute the spec phase end to end.
 *
 * @param {number} epicId
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 * @param {{ prdContent: string, techSpecContent: string }} artifacts
 * @param {object} settings
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ epicId: number, prdId: number|null, techSpecId: number|null, checkpoint: object }>}
 */
export async function runSpecPhase(
  epicId,
  provider,
  { prdContent, techSpecContent },
  settings = {},
  { force = false } = {},
) {
  const epic = await provider.getEpic(epicId);
  if (!epic) {
    throw new Error(`[sprint-plan-spec] Epic #${epicId} not found.`);
  }
  if (!epic.labels?.includes(TYPE_LABELS.EPIC)) {
    throw new Error(
      `[sprint-plan-spec] Ticket #${epicId} is not a ${TYPE_LABELS.EPIC}.`,
    );
  }

  const ctx = new PlanRunnerContext({
    epicId,
    provider,
    config: settings ?? {},
    phase: PLAN_PHASES.PLANNING,
  });
  const checkpointer = new PlanCheckpointer({ ctx });
  await checkpointer.initialize();

  console.log(
    `[sprint-plan-spec] Flipping Epic #${epicId} to ${AGENT_LABELS.PLANNING}...`,
  );
  await setEpicLabel(provider, epicId, AGENT_LABELS.PLANNING);
  await checkpointer.setPhase(PLAN_PHASES.PLANNING);

  await planEpic(epicId, provider, { prdContent, techSpecContent }, settings, {
    force,
  });

  const afterPlan = await provider.getEpic(epicId);
  const prdId = afterPlan.linkedIssues?.prd ?? null;
  const techSpecId = afterPlan.linkedIssues?.techSpec ?? null;

  const checkpoint = await checkpointer.updateSpec({
    prdId,
    techSpecId,
    completedAt: new Date().toISOString(),
  });

  console.log(
    `[sprint-plan-spec] Flipping Epic #${epicId} to ${AGENT_LABELS.REVIEW_SPEC}...`,
  );
  await setEpicLabel(provider, epicId, AGENT_LABELS.REVIEW_SPEC);
  await checkpointer.setPhase(PLAN_PHASES.REVIEW_SPEC);

  console.log(
    `[sprint-plan-spec] ✅ Spec phase complete for Epic #${epicId}. PRD #${prdId}, Tech Spec #${techSpecId}.`,
  );

  return { epicId, prdId, techSpecId, checkpoint };
}

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      prd: { type: 'string' },
      techspec: { type: 'string' },
      force: { type: 'boolean', default: false },
      'emit-context': { type: 'boolean', default: false },
    },
  });

  if (!values.epic) {
    Logger.fatal(
      'Usage: sprint-plan-spec.js --epic <EpicId> (--emit-context | --prd <file> --techspec <file>) [--force]',
    );
  }

  const epicId = Number.parseInt(values.epic, 10);
  if (Number.isNaN(epicId)) {
    Logger.fatal(`Invalid epic ID: "${values.epic}" — must be a number.`);
  }

  const { orchestration, settings } = resolveConfig();
  const provider = createProvider(orchestration);

  try {
    await drainPendingCleanupAtBoot();
  } catch (err) {
    console.warn(
      `[sprint-plan-spec] pending-cleanup drain skipped: ${err.message}`,
    );
  }

  if (values['emit-context']) {
    const ctx = await buildAuthoringContext(epicId, provider, settings);
    process.stdout.write(`${JSON.stringify(ctx, null, 2)}\n`);
    return;
  }

  if (!values.prd || !values.techspec) {
    Logger.fatal(
      'Missing --prd and/or --techspec file paths. (Use --emit-context first to gather authoring context.)',
    );
  }

  const [prdContent, techSpecContent] = await Promise.all([
    readFile(values.prd, 'utf8'),
    readFile(values.techspec, 'utf8'),
  ]);

  const result = await runSpecPhase(
    epicId,
    provider,
    { prdContent, techSpecContent },
    settings,
    { force: values.force },
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

runAsCli(import.meta.url, main, { source: 'sprint-plan-spec' });
