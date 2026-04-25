#!/usr/bin/env node
/* node:coverage ignore file */

/**
 * epic-planner.js
 *
 * Epic Planner Orchestration Script (v5.6+)
 *
 * As of v5.6 the host LLM authors the PRD and Tech Spec directly — this script
 * no longer calls any external LLM API. It has two modes:
 *
 *   1. --emit-context  Prints a JSON envelope (epic body, project docs,
 *                      recommended system prompts) to stdout. The host LLM
 *                      consumes this to author the PRD and Tech Spec markdown.
 *
 *   2. (default)       Given author-provided PRD/Tech Spec files, heals any
 *                      existing planning artifacts and creates the linked
 *                      GitHub issues under the Epic.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { scrapeProjectDocs } from './lib/orchestration/doc-reader.js';
import { PlanningStateManager } from './lib/orchestration/planning-state-manager.js';
import { createProvider } from './lib/provider-factory.js';

export const PRD_SYSTEM_PROMPT = `You are an expert Technical Product Manager.
Your job is to convert a high-level Epic description into a structured Product Requirements Document (PRD).

The PRD should outline:
1. Context & Goals
2. User Stories
3. Acceptance Criteria
4. Out of Scope

CRITICAL REQUIREMENTS:
- Respond ONLY with valid Markdown.
- Do not use top-level <h1> (# ) tags. Start with ## Overview.
- Format requirements clearly with bullet points and bold text where appropriate.`;

export const TECH_SPEC_SYSTEM_PROMPT = `You are an expert Engineering Architect.
Your job is to convert a PRD into a Technical Specification for implementation.

The Tech Spec should outline:
1. Architecture & Design
2. Data Models (if any)
3. API Changes (if any)
4. Core Components
5. Security & Privacy Considerations

CRITICAL REQUIREMENTS:
- Respond ONLY with valid Markdown.
- Do not use top-level <h1> (# ) tags. Start with ## Technical Overview.
- Format architectural decisions clearly with bullet points.`;

/**
 * Build the authoring context the host LLM needs to write the PRD/Tech Spec.
 * Returns a plain JSON-serialisable object; never hits the network beyond the
 * provider call needed to load the Epic.
 */
export async function buildAuthoringContext(epicId, provider, settings = {}) {
  const epic = await provider.getEpic(epicId);
  if (!epic) {
    throw new Error(`Epic #${epicId} not found.`);
  }

  const docsContext = await scrapeProjectDocs(settings);

  return {
    epic: {
      id: epic.id,
      title: epic.title,
      body: epic.body,
      linkedIssues: epic.linkedIssues ?? { prd: null, techSpec: null },
    },
    docsContext,
    systemPrompts: {
      prd: PRD_SYSTEM_PROMPT,
      techSpec: TECH_SPEC_SYSTEM_PROMPT,
    },
  };
}

export async function planEpic(
  epicId,
  provider,
  { prdContent, techSpecContent },
  _settings = {},
  { force = false } = {},
) {
  if (typeof prdContent !== 'string' || prdContent.trim() === '') {
    throw new Error(
      '[Epic Planner] prdContent is required and must be non-empty.',
    );
  }
  if (typeof techSpecContent !== 'string' || techSpecContent.trim() === '') {
    throw new Error(
      '[Epic Planner] techSpecContent is required and must be non-empty.',
    );
  }

  console.log(`[Epic Planner] Fetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  if (!epic) {
    throw new Error(`Epic #${epicId} not found.`);
  }

  const stateManager = new PlanningStateManager(provider);
  await stateManager.healAndCleanupArtifacts(epic, force);

  // M-8: Resumable planning — if PRD exists but Tech Spec doesn't, resume from PRD.
  if (!force && epic.linkedIssues?.prd && epic.linkedIssues?.techSpec) {
    console.warn(
      `[Epic Planner] Epic #${epicId} already has both PRD and Tech Spec. Aborting to prevent duplicates. Use --force to re-plan.`,
    );
    return;
  }
  const existingPrdId = force ? null : (epic.linkedIssues?.prd ?? null);

  let prdId;
  if (existingPrdId) {
    console.log(
      `[Epic Planner] Reusing existing PRD #${existingPrdId}. Skipping PRD creation.`,
    );
    prdId = existingPrdId;
  } else {
    console.log(`[Epic Planner] Creating PRD issue for "${epic.title}"...`);
    const prdTicket = await provider.createTicket(epicId, {
      title: `[PRD] ${epic.title}`,
      body: prdContent,
      labels: ['context::prd'],
      dependencies: [],
    });
    console.log(
      `[Epic Planner] Created PRD Issue #${prdTicket.id} (${prdTicket.url})`,
    );
    prdId = prdTicket.id;
  }

  console.log(
    `[Epic Planner] Creating Tech Spec issue linking to PRD #${prdId}...`,
  );
  const techSpecTicket = await provider.createTicket(epicId, {
    title: `[Tech Spec] ${epic.title}`,
    body: techSpecContent,
    labels: ['context::tech-spec'],
    dependencies: [prdId],
  });
  console.log(
    `[Epic Planner] Created Tech Spec Issue #${techSpecTicket.id} (${techSpecTicket.url})`,
  );

  console.log(
    `[Epic Planner] Updating Epic #${epicId} with linked documents...`,
  );

  // Format exactly so getEpic regex /PRD:\s*#\d+/i still catches it efficiently.
  const appendBody = `\n\n## Planning Artifacts\n- [ ] PRD: #${prdId}\n- [ ] Tech Spec: #${techSpecTicket.id}\n`;
  const newBody = epic.body + appendBody;

  await provider.updateTicket(epicId, {
    body: newBody,
  });

  console.log(`[Epic Planner] Epic #${epicId} updated successfully.`);
  console.log(`[Epic Planner] Planning pipeline complete!`);
}

/* node:coverage ignore next */
async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      force: { type: 'boolean', default: false },
      'emit-context': { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
      prd: { type: 'string' },
      techspec: { type: 'string' },
    },
  });

  if (!values.epic) {
    Logger.fatal(
      'Usage: epic-planner.js --epic <ID> (--emit-context [--pretty] | --prd <file> --techspec <file>) [--force]',
    );
  }

  const epicId = Number.parseInt(values.epic, 10);
  if (Number.isNaN(epicId)) {
    Logger.fatal(`Invalid epic ID: "${values.epic}" — must be a number.`);
  }

  const { orchestration, settings } = resolveConfig();
  const provider = createProvider(orchestration);

  if (values['emit-context']) {
    const ctx = await buildAuthoringContext(epicId, provider, settings);
    const json = values.pretty
      ? JSON.stringify(ctx, null, 2)
      : JSON.stringify(ctx);
    process.stdout.write(`${json}\n`);
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

  await planEpic(epicId, provider, { prdContent, techSpecContent }, settings, {
    force: values.force,
  });
}

runAsCli(import.meta.url, main, { source: 'EpicPlanner' });
