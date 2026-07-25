#!/usr/bin/env node

/**
 * sync-agentrc.js — default-aware `.agentrc.json` reconciliation (Story #1995).
 *
 * Replaces the manual procedure formerly described in
 * `.agents/workflows/helpers/mandrel-sync-config.md`. Invoked by
 * `/mandrel-update` Step 3 after the package upgrade re-materializes `.agents/`.
 *
 * Contract:
 *   - Validates the project config against the framework schema. On
 *     failure, prints diagnostics and exits 1.
 *   - Never auto-fills optional keys from `.agents/docs/agentrc-reference.json`.
 *     The runtime layers framework defaults at read time, so an absent
 *     key resolves to the framework default without being written.
 *   - For every project leaf whose value equals the framework default,
 *     prints an informational `[REDUNDANT]` advisory. The project file
 *     is never modified.
 *
 * Exit codes:
 *   0 — Config is valid (advisories may still appear).
 *   1 — Config is missing, malformed, or fails schema validation.
 *
 * The flag contract lives in `USAGE` below — `--help` is the one home for it.
 */

import { fileURLToPath } from 'node:url';
import { respondToHelp } from './lib/cli-usage.js';
import { formatSyncReport, syncAgentrc } from './lib/config/sync-agentrc.js';
import { Logger } from './lib/Logger.js';

const USAGE = {
  invocation: 'node .agents/scripts/sync-agentrc.js [--cwd <path>] [--quiet]',
  summary:
    'Validate `.agentrc.json` against the framework schema and report every project leaf that merely restates a framework default. Never writes the config.',
  flags: [
    ['--cwd <path>', 'Project root (default: process cwd).'],
    ['--quiet', 'Suppress advisory rows; print only the status line.'],
  ],
  notes: [
    'Exit codes:\n  0  config is valid (advisories may still appear)\n  1  config is missing, malformed, or fails schema validation',
  ],
};

function parseArgs(argv) {
  const out = { cwd: null, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cwd' && i + 1 < argv.length) {
      out.cwd = argv[++i];
    } else if (a === '--quiet') {
      out.quiet = true;
    }
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const { cwd, quiet } = parseArgs(argv);
  const projectRoot = cwd || process.cwd();
  const result = syncAgentrc({ projectRoot });
  const report = quiet
    ? trimAdvisories(formatSyncReport(result))
    : formatSyncReport(result);
  Logger.info(report);
  if (result.status === 'invalid' || result.status === 'missing-config') {
    return 1;
  }
  return 0;
}

function trimAdvisories(report) {
  return report
    .split('\n')
    .filter((line) => !line.startsWith('  [REDUNDANT]'))
    .join('\n');
}

// cli-opt-out: synchronous CLI with explicit exit-code return.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(respondToHelp(process.argv.slice(2), USAGE) ? 0 : main());
}
