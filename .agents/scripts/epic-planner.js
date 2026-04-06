#!/usr/bin/env node

/**
 * epic-planner.js
 *
 * Sprint 2A Epic Planner Orchestration Script
 * Reads an Epic body, uses the zero-dependency LLM client to generate a PRD
 * and Tech Spec, and posts them as linked GitHub issues under the Epic.
 */

import fs from 'node:fs';
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

  // ── Force re-plan: close old artifacts and strip body references ──────
  if (force && (epic.linkedIssues?.prd || epic.linkedIssues?.techSpec)) {
    console.log(
      '[Epic Planner] --force: Closing old planning artifacts...',
    );
    for (const oldId of [
      epic.linkedIssues.prd,
      epic.linkedIssues.techSpec,
    ]) {
      if (oldId) {
        await provider.updateTicket(oldId, {
          state: 'closed',
          state_reason: 'not_planned',
        });
        console.log(`[Epic Planner]   Closed old artifact #${oldId}`);
      }
    }

    // Strip the ## Planning Artifacts section from the Epic body so we
    // can append a fresh one after regeneration.
    const stripped = epic.body.replace(
      /\n*## Planning Artifacts[\s\S]*$/,
      '',
    );
    if (stripped !== epic.body) {
      await provider.updateTicket(epicId, { body: stripped });
      epic.body = stripped;
      console.log(
        '[Epic Planner]   Stripped old Planning Artifacts section from Epic body.',
      );
    }
  }

  // M-8: Resumable planning — if PRD exists but Tech Spec doesn't, resume from PRD.
  if (
    !force &&
    epic.linkedIssues?.prd &&
    epic.linkedIssues?.techSpec
  ) {
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
    console.error(
      'Usage: node epic-planner.js --epic <EpicId> [--force]',
    );
    process.exit(1);
  }

  const epicId = parseInt(values.epic, 10);
  if (Number.isNaN(epicId)) {
    console.error('Error: Epic ID must be a number.');
    process.exit(1);
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
    console.error('[Epic Planner] Fatal error:\n', err);
    process.exit(1);
  });
}
