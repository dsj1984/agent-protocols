import { parseArgs } from 'node:util';

/**
 * Parse a single ticket-ID-style value. Strips an optional leading `#`,
 * coerces to a positive integer, and returns `null` for anything invalid.
 *
 * Shared by every CLI that accepts `--epic`, `--story`, `--task`, `--recut-of`,
 * or a ticket positional, so the `Number.parseInt(..., 10)` + `# ` prefix dance lives
 * in exactly one place.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function parseTicketId(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? String(value) : value.toString();
  const cleaned = raw.replace(/^#/, '').trim();
  if (cleaned === '') return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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
    epicId: parseTicketId(values.epic),
    storyId: parseTicketId(values.story),
    ticketId: null,
    dryRun: values['dry-run'] ?? false,
    skipDashboard: values['skip-dashboard'] ?? false,
    executor: values.executor ?? null,
    // Resolve worktree cwd from flag or env. Empty string/whitespace → null.
    cwd:
      (typeof values.cwd === 'string' && values.cwd.trim()) ||
      process.env.AGENT_WORKTREE_ROOT ||
      null,
    recutOf: parseTicketId(values['recut-of']),
  };

  parsed.ticketId =
    parseTicketId(positionals[0]) ?? parsed.storyId ?? parsed.epicId ?? null;

  return parsed;
}
