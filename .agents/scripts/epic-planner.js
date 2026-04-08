#!/usr/bin/env node

/**
 * epic-planner.js
 *
 * Sprint 2A Epic Planner Orchestration Script
 * Reads an Epic body, uses the zero-dependency LLM client to generate a PRD
 * and Tech Spec, and posts them as linked GitHub issues under the Epic.
 */

import fs from 'node:fs';
import { Logger } from './lib/Logger.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './lib/config-resolver.js';
import { LLMClient } from './lib/llm-client.js';
import { createProvider } from './lib/provider-factory.js';

const PRD_SYSTEM_PROMPT = `You are an expert Technical Product Manager.
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

const TECH_SPEC_SYSTEM_PROMPT = `You are an expert Engineering Architect.
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

export async function planEpic(
  epicId,
  provider,
  llm,
  settings = {},
  { force = false } = {},
) {
  console.log(`[Epic Planner] Fetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  if (!epic) {
    throw new Error(`Epic #${epicId} not found.`);
  }

  // ── Idempotency: Discover dangling artifacts not yet in body ─────────────
  const relatedTickets = await provider.getTickets(epicId);
  const existingPrds = relatedTickets.filter(
    (t) => t.labels.includes('context::prd') && t.state === 'open',
  );
  const existingSpecs = relatedTickets.filter(
    (t) => t.labels.includes('context::tech-spec') && t.state === 'open',
  );

  // Heal linkedIssues if empty but tickets exist
  if (!epic.linkedIssues.prd && existingPrds.length > 0) {
    epic.linkedIssues.prd = existingPrds[0].id;
    console.log(
      `[Epic Planner] Healed dangling PRD reference: #${epic.linkedIssues.prd}`,
    );
  }
  if (!epic.linkedIssues.techSpec && existingSpecs.length > 0) {
    epic.linkedIssues.techSpec = existingSpecs[0].id;
    console.log(
      `[Epic Planner] Healed dangling Tech Spec reference: #${epic.linkedIssues.techSpec}`,
    );
  }

  // Cleanup duplicates (redundant open PRDs/Specs)
  const redundant = [
    ...existingPrds.slice(epic.linkedIssues.prd ? 1 : 0),
    ...existingSpecs.slice(epic.linkedIssues.techSpec ? 1 : 0),
  ];

  for (const t of redundant) {
    const successorId = t.labels.includes('context::prd')
      ? epic.linkedIssues.prd
      : epic.linkedIssues.techSpec;
    console.log(
      `[Epic Planner] Closing redundant duplicate artifact #${t.id} (superseded by #${successorId})...`,
    );
    try {
      await provider.postComment(t.id, {
        type: 'notification',
        body: `⚠️ **Audit Trace**: This planning artifact was created during an interrupted or failed orchestration run and is now **superseded by #${successorId}**. 

Closing this issue to maintain a single source of truth for Epic #${epicId}.`,
      });
    } catch (_err) {
      // Ignore comment failures
    }
    await provider.updateTicket(t.id, {
      state: 'closed',
      state_reason: 'not_planned',
    });
  }

  // Persist healed references to the body if needed.
  // Skip this when --force is active: old references are about to be replaced
  // and persisting them just to strip them is wasteful + risks a race.
  if (
    !force &&
    epic.linkedIssues.prd &&
    epic.linkedIssues.techSpec &&
    !epic.body.includes('## Planning Artifacts')
  ) {
    console.log(`[Epic Planner] Persisting healed references to Epic body...`);
    const appendBody = `\n\n## Planning Artifacts\n- [ ] PRD: #${epic.linkedIssues.prd}\n- [ ] Tech Spec: #${epic.linkedIssues.techSpec}\n`;
    await provider.updateTicket(epicId, { body: epic.body + appendBody });
    epic.body += appendBody;
  }

  // ── Force re-plan: close ALL old planning artifacts and strip body ────
  if (force) {
    // Collect all open artifacts to close — both the ones referenced in
    // linkedIssues AND any orphaned ones found via label scan.  This
    // prevents stale PRDs/Tech Specs from lingering after re-plans.
    const idsToClose = new Set(
      [epic.linkedIssues.prd, epic.linkedIssues.techSpec].filter(Boolean),
    );
    for (const t of [...existingPrds, ...existingSpecs]) {
      idsToClose.add(t.id);
    }

    if (idsToClose.size > 0) {
      console.log('[Epic Planner] --force: Closing old planning artifacts...');
      for (const oldId of idsToClose) {
        try {
          await provider.updateTicket(oldId, {
            state: 'closed',
            state_reason: 'not_planned',
          });
          console.log(`[Epic Planner]   Closed old artifact #${oldId}`);
        } catch (err) {
          // If the issue was already deleted (410) or not found (404), skip gracefully.
          if (err.message.includes('404') || err.message.includes('410')) {
            console.log(
              `[Epic Planner]   Old artifact #${oldId} was already removed or is inaccessible. Skipping.`,
            );
          } else {
            throw err;
          }
        }
      }
    }

    // Strip the ## Planning Artifacts section from the Epic body so we
    // can append a fresh one after regeneration.
    const stripped = epic.body.replace(/\n*## Planning Artifacts[\s\S]*$/, '');
    if (stripped !== epic.body) {
      await provider.updateTicket(epicId, { body: stripped });
      epic.body = stripped;
      console.log(
        '[Epic Planner]   Stripped old Planning Artifacts section from Epic body.',
      );
    }

    // Clear linkedIssues so the idempotency guard doesn't short-circuit
    epic.linkedIssues.prd = null;
    epic.linkedIssues.techSpec = null;
  }

  // M-8: Resumable planning — if PRD exists but Tech Spec doesn't, resume from PRD.
  if (!force && epic.linkedIssues?.prd && epic.linkedIssues?.techSpec) {
    console.warn(
      `[Epic Planner] Epic #${epicId} already has both PRD and Tech Spec. Aborting to prevent duplicates. Use --force to re-plan.`,
    );
    return;
  }
  const existingPrdId = force ? null : (epic.linkedIssues?.prd ?? null);

  let prdId;
  let prdContent;
  if (existingPrdId) {
    console.log(
      `[Epic Planner] Reusing existing PRD #${existingPrdId}. Skipping PRD generation.`,
    );
    prdId = existingPrdId;
    // Fetch existing PRD content for Tech Spec prompt
    const existingPrd = await provider.getTicket(existingPrdId);
    prdContent = existingPrd.body;
  } else {
    console.log(
      `[Epic Planner] Epic "${epic.title}" loaded. Generating PRD...`,
    );
    const prdUserPrompt = `Epic Title: ${epic.title}\n\nEpic Description:\n${epic.body}\n\nPlease generate the PRD based on the above epic.`;
    prdContent = await llm.generateText(PRD_SYSTEM_PROMPT, prdUserPrompt);

    console.log(`[Epic Planner] PRD generated. Creating PRD issue...`);
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
    `[Epic Planner] Generating Tech Spec linking to PRD #${prdId}...`,
  );

  let docsContext = '';
  if (settings.docsRoot && fs.existsSync(settings.docsRoot)) {
    console.log(
      `[Epic Planner] Scraping project docs from ${settings.docsRoot}...`,
    );
    try {
      // If an explicit allowlist is configured, use only those files.
      // Otherwise fall back to top-level (non-recursive) .md files to avoid
      // unbounded context inflation from nested artifacts.
      let targetFiles;
      if (
        Array.isArray(settings.docsContextFiles) &&
        settings.docsContextFiles.length > 0
      ) {
        targetFiles = settings.docsContextFiles.map((f) => ({
          name: f,
          full: path.join(settings.docsRoot, f),
        }));
      } else {
        const entries = fs.readdirSync(settings.docsRoot, {
          withFileTypes: true,
        });
        targetFiles = entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => ({
            name: e.name,
            full: path.join(settings.docsRoot, e.name),
          }));
      }

      for (const { name, full } of targetFiles) {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const content = fs.readFileSync(full, 'utf-8');
          docsContext += `\n\n--- Document: ${name} ---\n${content}`;
        }
      }
    } catch (err) {
      console.warn(
        `[Epic Planner] Warning: Failed to read docsRoot: ${err.message}`,
      );
    }
  }

  let tsUserPrompt = `Epic Title: ${epic.title}\n\nPRD Description:\n${prdContent}`;
  if (docsContext) {
    tsUserPrompt += `\n\nProject Documentation Context:\n${docsContext}`;
    tsUserPrompt += `\n\nPlease generate the Tech Spec based on the above PRD and Project Documentation.`;
  } else {
    tsUserPrompt += `\n\nPlease generate the Tech Spec based on the above PRD.`;
  }

  const techSpecContent = await llm.generateText(
    TECH_SPEC_SYSTEM_PROMPT,
    tsUserPrompt,
  );

  console.log(
    `[Epic Planner] Tech Spec generated. Creating Tech Spec issue...`,
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

async function main() {
  const { values } = parseArgs({
    options: {
      epic: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });

  if (!values.epic) {
    Logger.fatal('Usage: epic-planner.js --epic <ID> [--force]');
  }

  const epicId = parseInt(values.epic, 10);
  if (Number.isNaN(epicId)) {
    Logger.fatal(`Invalid epic ID: "${values.epic}" — must be a number.`);
  }

  const { orchestration, settings } = resolveConfig();
  const provider = createProvider(orchestration);
  const llm = new LLMClient({ orchestration });

  await planEpic(epicId, provider, llm, settings, {
    force: values.force,
  });
}

// Only execute main if run directly
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    Logger.fatal(err.message);
  });
}
