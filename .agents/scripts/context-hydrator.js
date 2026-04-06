import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from './lib/config-resolver.js';

function getVersion() {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, '.agents', 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Parses the hierarchy from a Task body.
 * Looks for: `> Epic: #1 | Feature: #2 | Story: #3 PRD: #4 | Tech Spec: #5`
 * @param {string} body 
 * @returns {Record<string, number>}
 */
function parseHierarchy(body) {
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
 * Truncates a string to roughly fit within a token limit.
 * Simple approximation: 1 token ≈ 4 characters.
 */
function truncateToTokenBudget(text, tokenBudget) {
  if (!tokenBudget) return text;
  const maxChars = tokenBudget * 4;
  if (text.length > maxChars) {
    return text.substring(0, maxChars) + '\n\n...[Context truncated due to token limits]...';
  }
  return text;
}

/**
 * Hydrates the execution context into a self-contained prompt string.
 *
 * @param {object} task - The task object from the dispatcher
 * @param {import('./lib/ITicketingProvider.js').ITicketingProvider} provider
 * @param {string} epicBranch
 * @param {string} taskBranch
 * @param {number} epicId
 * @returns {Promise<string>} The hydrated prompt
 */
export async function hydrateContext(task, provider, epicBranch, taskBranch, epicId) {
  const { settings } = resolveConfig();
  const currentVersion = getVersion();
  let warnings = '';

  // 1. Version Mismatch Check
  if (task.protocolVersion && task.protocolVersion !== currentVersion) {
    warnings += `⚠️ WARNING: Protocol version mismatch. Task was planned with v${task.protocolVersion}, but is executing with v${currentVersion}.\n\n`;
    console.warn(`[Hydrator] Protocol version mismatch on Task #${task.id}: planned with v${task.protocolVersion}, executing with v${currentVersion}`);
  }

  // 2. Load Agent Protocol
  let protocolTpl = '';
  try {
    const pTemplatePath = path.join(PROJECT_ROOT, '.agents/templates/agent-protocol.md');
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
      const pPath = path.join(PROJECT_ROOT, '.agents/personas', `${task.persona}.md`);
      if (fs.existsSync(pPath)) {
        personaContext = `## Persona: ${task.persona}\n\n` + fs.readFileSync(pPath, 'utf8');
      }
    } catch (err) {
      console.warn(`[Hydrator] Failed to load persona ${task.persona}: ${err.message}`);
    }
  }

  // 4. Load Skills
  let skillsContext = '';
  if (task.skills && task.skills.length > 0) {
    skillsContext = '## Activated Skills\n\n';
    for (const skill of task.skills) {
      try {
        // M-4: Search two-tier layout (core/, stack/) with flat fallback.
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
              candidates.push(path.join(stackBase, category, skill, 'SKILL.md'));
            }
          } catch { /* ignore read errors */ }
        }

        const sPath = candidates.find(p => fs.existsSync(p));
        if (sPath) {
          skillsContext += `### Skill: ${skill}\n` + fs.readFileSync(sPath, 'utf8') + '\n\n';
        }
      } catch (err) {
        console.warn(`[Hydrator] Failed to load skill ${skill}: ${err.message}`);
      }
    }
  }

  // 5. Hierarchy Context Assembly
  const hierarchyKeys = parseHierarchy(task.body);
  let hierarchyContext = '## Work Breakdown Hierarchy\n\n';

  // We fetch tickets in parallel, but handle them gracefully
  const fetchPromises = [];
  const idsToFetch = [
    { key: 'Epic', id: epicId || hierarchyKeys.epic },
    { key: 'PRD', id: hierarchyKeys.prd },
    { key: 'Tech Spec', id: hierarchyKeys.techspec },
    { key: 'Feature', id: hierarchyKeys.feature },
    { key: 'Story', id: hierarchyKeys.story }
  ];

  for (const item of idsToFetch) {
    if (item.id) {
      fetchPromises.push(
        provider.getTicket(item.id)
          .then(t => `### ${item.key}: ${t.title} (#${t.id})\n\n${t.body}\n`)
          .catch(() => '') // ignore failures
      );
    }
  }

  const fetchedHierarchy = await Promise.all(fetchPromises);
  hierarchyContext += fetchedHierarchy.filter(Boolean).join('\n---\n\n');

  // 6. Assembly
  const fullPromptParts = [
    warnings.trim(),
    protocolTpl,
    personaContext,
    skillsContext,
    hierarchyContext,
    `## Task Instructions (Issue #${task.id}: ${task.title})\n\n${task.body}`
  ].filter(Boolean);

  const fullPrompt = fullPromptParts.join('\n\n========================================================================\n\n');

  // 7. Token Budget
  const budget = settings?.maxTokenBudget;
  return truncateToTokenBudget(fullPrompt, budget);
}
