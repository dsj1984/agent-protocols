import { parseArgs } from 'node:util';

/**
 * Standardized CLI argument parser for sprint scripts.
 * Supports options like --epic, --story, --dry-run, --refresh-dashboard.
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
      'refresh-dashboard': { type: 'boolean', default: false },
      executor: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = {
    epicId: null,
    storyId: null,
    ticketId: null,
    dryRun: values['dry-run'] ?? false,
    refreshDashboard: values['refresh-dashboard'] ?? false,
    executor: values.executor ?? null,
  };

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
