import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, resolveConfig } from '../lib/config-resolver.js';
import { gitSpawn } from '../lib/git-utils.js';

/**
 * Filter audits based on logic in audit-rules.json
 * @param {object} params
 * @param {number} params.ticketId
 * @param {string} params.gate
 * @param {import('../lib/ITicketingProvider.js').ITicketingProvider} params.provider
 * @param {string} params.baseBranch
 */
export async function selectAudits({
  ticketId,
  gate,
  provider,
  baseBranch = 'main',
}) {
  const { settings } = resolveConfig();

  // 1. Read audit-rules.json
  const rulesPath = path.join(
    PROJECT_ROOT,
    settings.schemasRoot,
    'audit-rules.json',
  );
  let rulesData;
  try {
    rulesData = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read audit-rules from ${rulesPath}: ${err.message}`,
    );
  }

  // 2. Fetch ticket data for keywords
  const ticket = await provider.getTicket(ticketId);
  const contentToSearch =
    `${ticket.title || ''} ${ticket.body || ''}`.toLowerCase();

  // 3. Fetch changed files for patterns
  let changedFiles = [];
  try {
    // Diff between baseBranch and HEAD
    const diff = gitSpawn(
      process.cwd(),
      'diff',
      '--name-only',
      `${baseBranch}...HEAD`,
    );
    if (diff.status === 0) {
      changedFiles = diff.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    }
  } catch (_e) {
    // Ignore error
  }

  const selectedAudits = [];

  for (const [auditName, ruleOpts] of Object.entries(rulesData.audits || {})) {
    const triggers = ruleOpts.triggers || {};

    // Check gate match
    const gateMatch = triggers.gates?.includes(gate);
    if (!gateMatch) continue;

    if (triggers.alwaysRun) {
      selectedAudits.push(auditName);
      continue;
    }

    // Check keywords
    const keywords = triggers.keywords || [];
    let keywordMatch = false;
    for (const kw of keywords) {
      if (contentToSearch.includes(kw.toLowerCase())) {
        keywordMatch = true;
        break;
      }
    }

    // Check file patterns
    const filePatterns = triggers.filePatterns || [];
    let fileMatch = false;
    for (const fp of filePatterns) {
      // Create wildcard matching regex
      const regexStr =
        '^' +
        fp
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/(?<!\.)\*/g, '[^/]*') +
        '$';
      const matchRegex = new RegExp(regexStr);

      const exactSuffix = fp.replace(/^\*\*\//, '');

      for (const file of changedFiles) {
        if (matchRegex.test(file) || file.endsWith(exactSuffix)) {
          fileMatch = true;
          break;
        }
      }
      if (fileMatch) break;
    }

    if (keywordMatch || fileMatch) {
      selectedAudits.push(auditName);
    }
  }

  return {
    selectedAudits,
    ticketId,
    gate,
    context: {
      changedFilesCount: changedFiles.length,
      ticketTitle: ticket.title,
    },
  };
}
