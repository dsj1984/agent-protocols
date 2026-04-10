/**
 * lib/orchestration/context-hydrator.js — Context Hydration Engine (SDK)
 *
 * Stateless, async logic for assembling the full execution prompt for an
 * agent task. Extracted from the CLI entry point to enable reuse across
 * consumers (CLI wrappers, MCP server, tests).
 *
 * This module is the SDK layer — it has no knowledge of CLI arguments,
 * file I/O decisions, or process.exit(). All I/O choices are delegated
 * to the caller.
 *
 * Consumers:
 *   - `.agents/scripts/context-hydrator.js`  — CLI thin re-export shim
 *   - `lib/orchestration/dispatcher.js`      — import hydrateContext directly
 *   - `.agents/scripts/mcp-server.js`        — MCP tool entry point (future)
 *
 * @see .agents/scripts/lib/ITicketingProvider.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from '../config-resolver.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the framework VERSION file.
 *
 * @returns {string}
 */
function getVersion() {
  try {
    return fs
      .readFileSync(path.join(PROJECT_ROOT, '.agents', 'VERSION'), 'utf8')
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Parse the work-breakdown hierarchy from a Task ticket body.
 *
 * Looks for patterns like: `Epic: #1`, `Feature: #2`, `Story: #3`,
 * `PRD: #4`, `Tech Spec: #5`.
 *
 * @param {string} body
 * @returns {Record<string, number>}
 */
export function parseHierarchy(body) {
  const result = {};
  if (!body) return result;

  const matches = [...body.matchAll(/([A-Za-z\s]+):\s*#(\d+)/gi)];
  for (const match of matches) {
    const key = match[1].trim().toLowerCase().replace(/\s+/g, '');
    const val = parseInt(match[2], 10);
    result[key] = val; // e.g. { epic: 1, feature: 2, story: 3, prd: 4, techspec: 5 }
  }
  return result;
}

/**
 * Truncate a string to fit within a rough token budget.
 * Approximation: 1 token ≈ 4 characters.
 *
 * @param {string} text
 * @param {number|undefined} tokenBudget
 * @returns {string}
 */
export function truncateToTokenBudget(text, tokenBudget) {
  if (!tokenBudget) return text;
  const maxChars = tokenBudget * 4;
  if (text.length > maxChars) {
    return (
      text.substring(0, maxChars) +
      '\n\n...[Context truncated due to token limits]...'
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// Public SDK export
// ---------------------------------------------------------------------------

/**
 * Hydrate the execution context into a self-contained prompt string.
 *
 * Assembles a prompt from:
 *   1. Version mismatch warning (if protocol version differs)
 *   2. Agent protocol template (`agent-protocol.md`)
 *   3. Persona document (from `.agents/personas/<persona>.md`)
 *   4. Activated skill documents (from `.agents/skills/`)
 *   5. Work-breakdown hierarchy (Epic, Feature, Story, PRD, Tech Spec bodies)
 *   6. Task instructions (from the ticket body)
 *   7. Token budget truncation (from `agentSettings.maxTokenBudget`)
 *
 * @param {object} task - The normalized task object from the dispatcher
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @param {string} epicBranch  - e.g. `epic/71`
 * @param {string} taskBranch  - e.g. `story/epic-71/my-story`
 * @param {number} epicId
 * @returns {Promise<string>} The fully-hydrated prompt string
 */
export async function hydrateContext(
  task,
  provider,
  epicBranch,
  taskBranch,
  epicId,
) {
  const { settings } = resolveConfig();
  const currentVersion = getVersion();
  let warnings = '';

  // 1. Version Mismatch Check
  if (task.protocolVersion && task.protocolVersion !== currentVersion) {
    warnings += `⚠️ WARNING: Protocol version mismatch. Task was planned with v${task.protocolVersion}, but is executing with v${currentVersion}.\n\n`;
    console.warn(
      `[Hydrator] Protocol version mismatch on Task #${task.id}: planned with v${task.protocolVersion}, executing with v${currentVersion}`,
    );
  }

  // 2. Load Agent Protocol Template
  let protocolTpl = '';
  try {
    const pTemplatePath = path.join(
      PROJECT_ROOT,
      '.agents/templates/agent-protocol.md',
    );
    protocolTpl = fs.readFileSync(pTemplatePath, 'utf8');
    protocolTpl = protocolTpl
      .replace(/\{\{PROTOCOL_VERSION\}\}/g, currentVersion)
      .replace(/\{\{BRANCH_NAME\}\}/g, taskBranch)
      .replace(/\{\{EPIC_BRANCH\}\}/g, epicBranch)
      .replace(/\{\{TASK_ID\}\}/g, task.id);
  } catch (err) {
    console.warn(`[Hydrator] Failed to load agent-protocol.md: ${err.message}`);
  }

  // 3. Load Persona
  let personaContext = '';
  if (task.persona) {
    try {
      const pPath = path.join(
        PROJECT_ROOT,
        '.agents/personas',
        `${task.persona}.md`,
      );
      if (fs.existsSync(pPath)) {
        personaContext = `## Persona: ${task.persona}\n\n${fs.readFileSync(pPath, 'utf8')}`;
      }
    } catch (err) {
      console.warn(
        `[Hydrator] Failed to load persona ${task.persona}: ${err.message}`,
      );
    }
  }

  // 4. Load Activated Skills
  let skillsContext = '';
  if (task.skills && task.skills.length > 0) {
    skillsContext = '## Activated Skills\n\n';
    for (const skill of task.skills) {
      try {
        // Two-tier skill layout (core/, stack/) with flat fallback.
        const candidates = [
          path.join(PROJECT_ROOT, '.agents/skills/core', skill, 'SKILL.md'),
          path.join(PROJECT_ROOT, '.agents/skills/stack', skill, 'SKILL.md'),
          path.join(PROJECT_ROOT, '.agents/skills', skill, 'SKILL.md'),
        ];
        // Also check stack subcategories (e.g., stack/javascript/eslint/)
        const stackBase = path.join(PROJECT_ROOT, '.agents/skills/stack');
        if (fs.existsSync(stackBase)) {
          try {
            for (const category of fs.readdirSync(stackBase)) {
              candidates.push(
                path.join(stackBase, category, skill, 'SKILL.md'),
              );
            }
          } catch {
            /* ignore read errors */
          }
        }

        const sPath = candidates.find((p) => fs.existsSync(p));
        if (sPath) {
          skillsContext += `### Skill: ${skill}\n${fs.readFileSync(sPath, 'utf8')}\n\n`;
        }
      } catch (err) {
        console.warn(
          `[Hydrator] Failed to load skill ${skill}: ${err.message}`,
        );
      }
    }
  }

  // 5. Hierarchy Context Assembly
  const hierarchyKeys = parseHierarchy(task.body);
  let hierarchyContext = '## Work Breakdown Hierarchy\n\n';

  const depth = settings?.contextDepth ?? 'standard';
  const idsToFetch = [];

  if (depth === 'full') {
    idsToFetch.push({ key: 'Epic', id: epicId || hierarchyKeys.epic });
    idsToFetch.push({ key: 'PRD', id: hierarchyKeys.prd });
    idsToFetch.push({ key: 'Tech Spec', id: hierarchyKeys.techspec });
    idsToFetch.push({ key: 'Feature', id: hierarchyKeys.feature });
    idsToFetch.push({ key: 'Story', id: hierarchyKeys.story });
  } else if (depth === 'standard') {
    idsToFetch.push({ key: 'Epic', id: epicId || hierarchyKeys.epic });
    idsToFetch.push({ key: 'Tech Spec', id: hierarchyKeys.techspec });
    idsToFetch.push({ key: 'Story', id: hierarchyKeys.story });
  } else if (depth === 'minimal') {
    idsToFetch.push({ key: 'Story', id: hierarchyKeys.story });
  }

  const fetchPromises = idsToFetch
    .filter((item) => item.id)
    .map((item) =>
      provider
        .getTicket(item.id)
        .then((t) => `### ${item.key}: ${t.title} (#${t.id})\n\n${t.body}\n`)
        .catch(() => ''),
    );

  const fetchedHierarchy = await Promise.all(fetchPromises);
  hierarchyContext += fetchedHierarchy.filter(Boolean).join('\n---\n\n');

  // 6. Prompt Assembly
  const fullPromptParts = [
    warnings.trim(),
    protocolTpl,
    personaContext,
    skillsContext,
    hierarchyContext,
    `## Task Instructions (Issue #${task.id}: ${task.title})\n\n${task.body}`,
  ].filter(Boolean);

  const fullPrompt = fullPromptParts.join(
    '\n\n========================================================================\n\n',
  );

  // 7. Token Budget
  const budget = settings?.maxTokenBudget;
  return truncateToTokenBudget(fullPrompt, budget);
}
