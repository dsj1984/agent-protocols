import { parseArgs } from 'node:util';

/**
 * Standardized CLI argument parser for sprint scripts.
 * Supports options like --epic, --story, --dry-run, --skip-dashboard.
 * @param {string[]} args Array of arguments (defaults to process.argv)
 * @returns {object} Parsed and typed argument values
 */
export function parseSprintArgs(args = process.argv) {
  const { values, positionals } = parseArgs({
    args: args.slice(2),
    options: {
      epic: { type: 'string', short: 'e' },
      story: { type: 'string', short: 's' },
      'dry-run': { type: 'boolean', default: false },
      'skip-dashboard': { type: 'boolean', default: false },
      executor: { type: 'string' },
      cwd: { type: 'string' },
      'recut-of': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = {
    epicId: null,
    storyId: null,
    ticketId: null,
    dryRun: values['dry-run'] ?? false,
    skipDashboard: values['skip-dashboard'] ?? false,
    executor: values.executor ?? null,
    // Resolve worktree cwd from flag or env. Empty string/whitespace → null.
    cwd:
      (typeof values.cwd === 'string' && values.cwd.trim()) ||
      process.env.AGENT_WORKTREE_ROOT ||
      null,
    recutOf: null,
  };

  const recutVal = Number.parseInt(
    (values['recut-of'] ?? '').toString().replace(/^#/, ''),
    10,
  );
  if (!Number.isNaN(recutVal) && recutVal > 0) parsed.recutOf = recutVal;

  // Convert IDs
  const epicIdVal = parseInt(values.epic ?? '', 10);
  if (!Number.isNaN(epicIdVal) && epicIdVal > 0) parsed.epicId = epicIdVal;

  const storyIdVal = parseInt(values.story ?? '', 10);
  if (!Number.isNaN(storyIdVal) && storyIdVal > 0) parsed.storyId = storyIdVal;

  // Fallback positional resolving for dispatcher wrapper
  const fromPositional = parseInt((positionals[0] ?? '').replace(/^#/, ''), 10);
  if (!Number.isNaN(fromPositional) && fromPositional > 0) {
    parsed.ticketId = fromPositional;
  } else {
    parsed.ticketId = parsed.storyId || parsed.epicId;
  }

  return parsed;
}
