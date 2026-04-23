import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { PROJECT_ROOT, resolveConfig } from '../lib/config-resolver.js';
import { gitSpawn } from '../lib/git-utils.js';
import { withTimeout } from '../lib/util/with-timeout.js';

const DEFAULT_GIT_TIMEOUT_MS = 30000;

/**
 * Test a single filename against a single glob pattern using the project's
 * configured matcher semantics (`picomatch` with `dot: true`). Exported so
 * regression tests can pin engine behavior without stubbing audit-rules.
 */
export function matchesFilePattern(pattern, file) {
  return picomatch(pattern, { dot: true })(file);
}

/**
 * Return true when any of `files` matches any of `patterns`.
 * Same semantics as `matchesFilePattern`; matchers are compiled once per call.
 */
export function matchesAnyFilePattern(patterns, files) {
  if (!patterns?.length || !files?.length) return false;
  const matchers = patterns.map((p) => picomatch(p, { dot: true }));
  return files.some((file) => matchers.some((m) => m(file)));
}

/**
 * Filter audits based on logic in audit-rules.schema.json
 * @param {object} params
 * @param {number} params.ticketId
 * @param {string} params.gate
 * @param {import('../lib/ITicketingProvider.js').ITicketingProvider} params.provider
 * @param {string} [params.baseBranch]
 * @param {(cwd: string, ...args: string[]) => Promise<{status:number, stdout:string, stderr:string}>} [params.injectedGitSpawn]
 *   Test-only seam. Production callers leave unset; the real (synchronous) `gitSpawn`
 *   is wrapped in `Promise.resolve` so `withTimeout` can still race it. Tests can
 *   inject a promise that never resolves to exercise the ETIMEDOUT fallback.
 * @param {number} [params.gitTimeoutMsOverride]
 *   Test-only seam to shrink the git-spawn timeout below the configured default
 *   (which is 30_000 ms) so timeout tests don't stall the suite.
 */
export async function selectAudits({
  ticketId,
  gate,
  provider,
  baseBranch = 'main',
  injectedGitSpawn,
  gitTimeoutMsOverride,
}) {
  const { settings, audits } = resolveConfig();
  const timeoutMs =
    gitTimeoutMsOverride ??
    audits?.selectionGitTimeoutMs ??
    DEFAULT_GIT_TIMEOUT_MS;

  // 1. Read audit-rules.schema.json
  const rulesPath = path.join(
    PROJECT_ROOT,
    settings.schemasRoot,
    'audit-rules.schema.json',
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
  const runGit = injectedGitSpawn ?? (async (...args) => gitSpawn(...args));

  let changedFiles = [];
  try {
    const diff = await withTimeout(
      runGit(process.cwd(), 'diff', '--name-only', `${baseBranch}...HEAD`),
      timeoutMs,
      { label: 'select-audits git diff' },
    );
    if (diff?.status === 0) {
      changedFiles = diff.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    }
  } catch (err) {
    if (err?.code === 'ETIMEDOUT') {
      console.warn(
        `[select-audits] git-spawn timed out after ${timeoutMs} ms; falling back to keyword-only matching`,
      );
    }
    // Any other error: preserve prior behavior (swallow, leave changedFiles empty).
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
    const fileMatch = matchesAnyFilePattern(
      triggers.filePatterns || [],
      changedFiles,
    );

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
