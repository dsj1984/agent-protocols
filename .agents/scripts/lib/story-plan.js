/**
 * story-plan.js — helpers for `/plan`.
 *
 * Pure functions used by `.agents/scripts/story-plan.js` (the CLI).
 * Kept side-effect-free so the CLI stays a thin orchestrator and these
 * helpers are easy to unit-test.
 *
 * Surfaces:
 *   - DEFAULT_REFINE_THRESHOLD     — seed length below which refinement
 *                                    is auto-suggested.
 *   - REQUIRED_SECTIONS            — canonical section headings the body
 *                                    must carry itself. Story #4874: the
 *                                    `## Acceptance` / `## Verify` sections
 *                                    are deliberately NOT among them —
 *                                    those lists are the ticket's top-level
 *                                    machine contract and persist
 *                                    synthesizes their sections, exactly as
 *                                    the story-author prompt instructs.
 *   - rankDuplicateCandidates({ seed, openStories, maxResults })
 *                                  — Jaccard-overlap ranking of open
 *                                    Stories whose titles fuzzy-match
 *                                    the seed.
 *   - validateStoryBody(body, contract)
 *                                  — schema-light shape check against the
 *                                    canonical Story-body contract: `##
 *                                    Goal` / `## Changes` present, no
 *                                    `Epic:` reference, and an
 *                                    acceptance/verify contract resolvable
 *                                    from the top-level arrays or the body.
 *   - buildContextEnvelope(opts)   — assemble the context envelope the
 *                                    host LLM consumes.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { overlapScore, tokenize } from './duplicate-search.js';
import { parse as parseStoryBody } from './story-body/story-body.js';

export const DEFAULT_REFINE_THRESHOLD = 200;
export const DEFAULT_DUPLICATE_MAX_RESULTS = 5;
export const DEFAULT_DUPLICATE_MIN_SCORE = 0.15;

/**
 * The sections the authored body must carry itself. Story #4874 reconciled
 * this list with the story-author prompt: the prompt tells the author to
 * write `acceptance[]` / `verify[]` **once** at the ticket's top level and
 * omit the matching body sections, so demanding those sections here made a
 * prompt-faithful body unpersistable and cost a re-author round.
 */
export const REQUIRED_SECTIONS = ['Goal', 'Changes'];

/** The contract lists persist synthesizes into the body from the top level. */
const CONTRACT_FIELDS = /** @type {const} */ (['acceptance', 'verify']);

const EPIC_REF_PATTERN = /^\s*Epic:\s*#\d+/m;

/**
 * Rank open Stories by title-overlap with the seed. Reuses the same
 * tokenize + Jaccard primitives that `duplicate-search.js` exposes for
 * Epic-level dedupe — Stories are a different ticket type but the
 * scoring shape is the same.
 *
 * @param {{ seed: string, openStories: Array<{ id:number, title:string, url?:string, body?:string }>, maxResults?: number, minScore?: number }} opts
 * @returns {Array<{ id:number, title:string, url?:string, score:number }>}
 */
export function rankDuplicateCandidates({
  seed,
  openStories,
  maxResults = DEFAULT_DUPLICATE_MAX_RESULTS,
  minScore = DEFAULT_DUPLICATE_MIN_SCORE,
}) {
  if (!seed || typeof seed !== 'string') {
    throw new Error('rankDuplicateCandidates: seed must be a non-empty string');
  }
  if (!Array.isArray(openStories)) {
    throw new Error('rankDuplicateCandidates: openStories must be an array');
  }
  const seedTokens = tokenize(seed);
  if (seedTokens.size === 0) return [];

  const ranked = [];
  for (const story of openStories) {
    if (!story || typeof story.title !== 'string') continue;
    const corpus = `${story.title}\n${story.body ?? ''}`;
    const candTokens = tokenize(corpus);
    const score = overlapScore(seedTokens, candTokens);
    if (score >= minScore) {
      ranked.push({
        id: story.id,
        title: story.title,
        url: story.url,
        score: Number(score.toFixed(4)),
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, maxResults);
}

/**
 * Decide whether the seed warrants a Phase-2 idea-refinement pass.
 * The default rule: refine when the seed is shorter than
 * `DEFAULT_REFINE_THRESHOLD` chars. Operator overrides via
 * `--refine` / `--no-refine` short-circuit the heuristic.
 *
 * @param {{ seed:string, override?:'on'|'off'|null, threshold?:number }} opts
 * @returns {{ refine:boolean, reason:string }}
 */
export function shouldRefine({
  seed,
  override = null,
  threshold = DEFAULT_REFINE_THRESHOLD,
}) {
  if (override === 'on') return { refine: true, reason: 'operator-forced-on' };
  if (override === 'off')
    return { refine: false, reason: 'operator-forced-off' };
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    return { refine: true, reason: 'empty-seed' };
  }
  if (seed.trim().length < threshold) {
    return {
      refine: true,
      reason: `seed-shorter-than-${threshold}-chars`,
    };
  }
  return { refine: false, reason: `seed-meets-${threshold}-char-threshold` };
}

/**
 * Collect the violations for one contract list (`acceptance` / `verify`).
 *
 * The list may be authored at the ticket's top level (the shape the
 * story-author prompt prescribes) or written into the body as a section —
 * either satisfies the contract, and the top level is preferred because
 * persist synthesizes the section from it. Only two shapes are violations:
 * the list is nowhere, or it is in both places and the two disagree (fail
 * closed rather than guess which is authoritative, mirroring
 * `plan-persist`'s `syncContractFieldFromTopLevel`).
 *
 * @param {'acceptance'|'verify'} field
 * @param {unknown} bodyList  The parsed body's section entries.
 * @param {unknown} topLevel  The ticket's top-level array.
 * @returns {string[]}
 */
function collectContractErrors(field, bodyList, topLevel) {
  const inBody = (Array.isArray(bodyList) ? bodyList : []).map(String);
  const inTicket = (Array.isArray(topLevel) ? topLevel : []).map(String);
  if (inBody.length === 0 && inTicket.length === 0) {
    return [
      `${field} must list at least one entry — author it as the ticket's top-level ${field}[] array; persist synthesizes the "## ${field[0].toUpperCase()}${field.slice(1)}" section from it`,
    ];
  }
  if (
    inBody.length > 0 &&
    inTicket.length > 0 &&
    (inBody.length !== inTicket.length ||
      inBody.some((v, i) => v !== inTicket[i]))
  ) {
    return [
      `${field} disagrees between the body section and the top-level ${field}[] array — author it once, at the top level`,
    ];
  }
  return [];
}

/**
 * Schema-light validator for a standalone-Story body, stated against the
 * same authoring shape the story-author prompt prescribes (Story #4874).
 *
 * It parses the body with the canonical Story-body parser and asserts:
 * a non-empty `## Goal`, at least one `## Changes` entry, no leaking
 * `Epic: #N` reference (the standalone contract), and an acceptance +
 * verify contract resolvable from the ticket's top-level arrays **or** the
 * body's own sections. It deliberately does not demand the `## Acceptance`
 * / `## Verify` sections of the author — persist synthesizes them.
 *
 * @param {string} body
 * @param {{ acceptance?: string[], verify?: string[] }} [contract]
 *   The ticket's top-level contract arrays, when the caller has them.
 * @returns {{ ok:boolean, errors:string[] }}
 */
export function validateStoryBody(body, contract = {}) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { ok: false, errors: ['body is empty'] };
  }

  let parsed;
  try {
    parsed = parseStoryBody(body).body;
  } catch (err) {
    return {
      ok: false,
      errors: [`body is not a parseable Story body: ${err.message}`],
    };
  }

  const errors = [];
  if (typeof parsed.goal !== 'string' || parsed.goal.trim() === '') {
    errors.push('missing required section: "## Goal"');
  }
  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) {
    errors.push('missing required section: "## Changes"');
  }
  if (EPIC_REF_PATTERN.test(body)) {
    errors.push(
      'body contains an "Epic: #N" reference — standalone Stories must not link to an Epic',
    );
  }
  for (const field of CONTRACT_FIELDS) {
    errors.push(
      ...collectContractErrors(field, parsed[field], contract?.[field]),
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Render the canonical `## Acceptance` / `## Verify` sections into a body
 * that omits them, from the ticket's top-level arrays (Story #4874).
 *
 * This is the synthesis the story-author prompt promises: the author writes
 * each list once at top level, and the persisted GitHub issue still reads as
 * a complete executable document. A body that already carries a section is
 * returned untouched — `validateStoryBody` has already refused the case
 * where the two disagree.
 *
 * @param {string} body
 * @param {{ acceptance?: string[], verify?: string[] }} [contract]
 * @returns {string}
 */
export function synthesizeContractSections(body, contract = {}) {
  let parsed;
  try {
    parsed = parseStoryBody(body).body;
  } catch {
    return body;
  }
  const blocks = [];
  if (
    (parsed.acceptance ?? []).length === 0 &&
    Array.isArray(contract.acceptance) &&
    contract.acceptance.length > 0
  ) {
    const items = contract.acceptance
      .map((a, i) => `- [ ] AC-${i + 1}: ${a}`)
      .join('\n');
    blocks.push(`## Acceptance\n${items}`);
  }
  if (
    (parsed.verify ?? []).length === 0 &&
    Array.isArray(contract.verify) &&
    contract.verify.length > 0
  ) {
    blocks.push(
      `## Verify\n${contract.verify.map((v) => `- ${v}`).join('\n')}`,
    );
  }
  if (blocks.length === 0) return body;
  return `${body.trimEnd()}\n\n${blocks.join('\n\n')}\n`;
}

/**
 * Load the body-template file from disk. Resolves relative to a project
 * root so callers (CLI, tests) can pin the lookup deterministically.
 *
 * @param {string} projectRoot
 * @returns {Promise<string>}
 */
export async function loadBodyTemplate(projectRoot) {
  const tpl = path.join(
    projectRoot,
    '.agents',
    'templates',
    'single-story-body.md',
  );
  return readFile(tpl, 'utf8');
}

/**
 * Assemble the context envelope the host LLM consumes to author a draft
 * Story body. Pure — no I/O beyond what the caller passed in.
 *
 * @param {{
 *   seed: string,
 *   refine: { refine:boolean, reason:string },
 *   persona: string,
 *   bodyTemplate: string,
 *   duplicateCandidates: Array<object>,
 *   techStack?: string|null,
 *   corpusContext?: { docsDigest: string|null, relevantSections: Array<object> }|null,
 *   maxResults?: number,
 * }} opts
 */
export function buildContextEnvelope({
  seed,
  refine,
  bodyTemplate,
  duplicateCandidates,
  techStack = null,
  corpusContext = null,
  maxResults = DEFAULT_DUPLICATE_MAX_RESULTS,
}) {
  return {
    kind: 'story-plan-context',
    version: 1,
    seed,
    refine,
    bodyTemplate,
    requiredSections: [...REQUIRED_SECTIONS],
    duplicateCandidates: {
      maxResults,
      candidates: duplicateCandidates,
    },
    techStack,
    corpusContext,
    deliverContract: {
      workflow: '.agents/workflows/helpers/deliver-story.md',
      requiredLabels: ['type::story'],
      forbidden: ['Epic: #N references in the body'],
    },
  };
}

/**
 * Extract the "Tech Stack" `##` section from a markdown document.
 *
 * Tolerates a numbered / decorated heading (`## 1. Tech Stack`,
 * `## Tech Stack`, etc.) and a section that is the final `##` in the
 * file (the terminator matches the next `##` heading **or** end-of-file).
 * Returns the matched section text (re-headed to a clean `## Tech Stack`)
 * or `null` when no Tech Stack heading is present.
 *
 * @param {string} content
 * @returns {string|null}
 */
function extractTechStackSection(content) {
  const match = content.match(
    /^##\s+(?:\d+[.)]\s+)?Tech Stack\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/m,
  );
  return match ? `## Tech Stack${match[1]}`.trim() : null;
}

/**
 * Resolve the project's Tech Stack inventory for the host LLM, in order:
 *
 *   1. A dedicated `docs/tech-stack.md` when present (the emerging
 *      single-ownership convention — WHAT in tech-stack.md, HOW in
 *      architecture.md, WHY in the ADRs). Its full body is returned.
 *   2. Otherwise, the `## Tech Stack` section of `docs/architecture.md`,
 *      tolerating a numbered/decorated heading and a final-section
 *      heading (no following `##` required).
 *
 * Returns `null` when neither source yields an inventory.
 *
 * @param {string} projectRoot
 * @returns {Promise<string|null>}
 */
export async function readTechStackSummary(projectRoot) {
  const dedicatedPath = path.join(projectRoot, 'docs', 'tech-stack.md');
  try {
    const dedicated = await readFile(dedicatedPath, 'utf8');
    const trimmed = dedicated.trim();
    if (trimmed) {
      return trimmed;
    }
  } catch {
    // No dedicated tech-stack.md — fall through to architecture.md.
  }

  const archPath = path.join(projectRoot, 'docs', 'architecture.md');
  let content;
  try {
    content = await readFile(archPath, 'utf8');
  } catch {
    return null;
  }
  return extractTechStackSection(content);
}
