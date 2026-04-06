#!/usr/bin/env node
/**
 * epic-planner.js
 *
 * Sprint 2A Epic Planner Orchestration Script
 * Reads an Epic body, uses the zero-dependency LLM client to generate a PRD
 * and Tech Spec, and posts them as linked GitHub issues under the Epic.
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider } from './lib/provider-factory.js';
import { LLMClient } from './lib/llm-client.js';
import { resolveConfig } from './lib/config-resolver.js';

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

export async function planEpic(epicId, provider, llm, settings = {}) {
  console.log(`[Epic Planner] Fetching Epic #${epicId}...`);
  const epic = await provider.getEpic(epicId);

  if (!epic) {
    throw new Error(`Epic #${epicId} not found.`);
  }

  // M-8: Resumable planning — if PRD exists but Tech Spec doesn't, resume from PRD.
  if (epic.linkedIssues?.prd && epic.linkedIssues?.techSpec) {
    console.warn(`[Epic Planner] Epic #${epicId} already has both PRD and Tech Spec. Aborting to prevent duplicates.`);
    return;
  }
  const existingPrdId = epic.linkedIssues?.prd ?? null;

  let prdId;
  if (existingPrdId) {
    console.log(`[Epic Planner] Reusing existing PRD #${existingPrdId}. Skipping PRD generation.`);
    prdId = existingPrdId;
  } else {
    console.log(`[Epic Planner] Epic "${epic.title}" loaded. Generating PRD...`);
    const prdUserPrompt = `Epic Title: ${epic.title}\n\nEpic Description:\n${epic.body}\n\nPlease generate the PRD based on the above epic.`;
    const prdContent = await llm.generateText(PRD_SYSTEM_PROMPT, prdUserPrompt);

    console.log(`[Epic Planner] PRD generated. Creating PRD issue...`);
    const prdTicket = await provider.createTicket(epicId, {
      title: `[PRD] ${epic.title}`,
      body: prdContent,
      labels: ['context::prd'],
      dependencies: [],
    });
    console.log(`[Epic Planner] Created PRD Issue #${prdTicket.id} (${prdTicket.url})`);
    prdId = prdTicket.id;
  }

  console.log(`[Epic Planner] Generating Tech Spec linking to PRD #${prdId}...`);

  let docsContext = '';
  if (settings.docsRoot && fs.existsSync(settings.docsRoot)) {
    console.log(`[Epic Planner] Scraping project docs from ${settings.docsRoot}...`);
    try {
      const files = fs.readdirSync(settings.docsRoot, { recursive: true });
      const mdFiles = files.filter(f => typeof f === 'string' && f.endsWith('.md'));
      
      for (const file of mdFiles) {
        const filePath = path.join(settings.docsRoot, file);
        if (fs.statSync(filePath).isFile()) {
           const content = fs.readFileSync(filePath, 'utf-8');
           docsContext += `\n\n--- Document: ${file} ---\n${content}`;
        }
      }
    } catch (err) {
      console.warn(`[Epic Planner] Warning: Failed to read docsRoot: ${err.message}`);
    }
  }

  // If we reused an existing PRD, fetch its content for the Tech Spec prompt.
  let prdText;
  if (existingPrdId) {
    const existingPrd = await provider.getTicket(existingPrdId);
    prdText = existingPrd.body;
  } else {
    prdText = prdContent;
  }

  let tsUserPrompt = `Epic Title: ${epic.title}\n\nPRD Description:\n${prdText}`;
  if (docsContext) {
    tsUserPrompt += `\n\nProject Documentation Context:\n${docsContext}`;
    tsUserPrompt += `\n\nPlease generate the Tech Spec based on the above PRD and Project Documentation.`;
  } else {
    tsUserPrompt += `\n\nPlease generate the Tech Spec based on the above PRD.`;
  }

  const techSpecContent = await llm.generateText(TECH_SPEC_SYSTEM_PROMPT, tsUserPrompt);

  console.log(`[Epic Planner] Tech Spec generated. Creating Tech Spec issue...`);
  const techSpecTicket = await provider.createTicket(epicId, {
    title: `[Tech Spec] ${epic.title}`,
    body: techSpecContent,
    labels: ['context::tech-spec'],
    dependencies: [prdId],
  });
  console.log(`[Epic Planner] Created Tech Spec Issue #${techSpecTicket.id} (${techSpecTicket.url})`);

  console.log(`[Epic Planner] Updating Epic #${epicId} with linked documents...`);
  
  // Format exactly so getEpic regex /PRD:\s*#\d+/i still catches it efficiently.
  const appendBody = `\n\n## Planning Artifacts\n- [ ] PRD: #${prdTicket.id}\n- [ ] Tech Spec: #${techSpecTicket.id}\n`;
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
    },
  });

  if (!values.epic) {
    console.error('Usage: node epic-planner.js --epic <EpicId>');
    process.exit(1);
  }

  const epicId = parseInt(values.epic, 10);
  if (isNaN(epicId)) {
    console.error('Error: Epic ID must be a number.');
    process.exit(1);
  }

  const { orchestration, settings } = resolveConfig();
  const provider = createProvider(orchestration);
  const llm = new LLMClient({ orchestration });

  await planEpic(epicId, provider, llm, settings);
}

// Only execute main if run directly
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[Epic Planner] Fatal error:\n', err);
    process.exit(1);
  });
}
