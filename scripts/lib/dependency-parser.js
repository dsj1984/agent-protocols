/**
 * dependency-parser.js — Shared Dependency & Metadata Parsing Utilities
 *
 * Canonical implementation of dependency-related regex parsing and
 * ticket metadata extraction. Eliminates duplicated implementations
 * across dispatcher.js, verify-prereqs.js, and providers/github.js.
 */

/**
 * Parse `blocked by #NNN` and `depends on #NNN` references from text.
 * Handles case-insensitive variations.
 *
 * @param {string} body - Issue body or freeform text.
 * @returns {number[]} Array of issue numbers this text declares as blockers.
 */
export function parseBlockedBy(body) {
  if (!body) return [];
  const re = /(?:blocked\s+by|depends\s+on):?\s+#(\d+)/gi;
  const ids = [...body.matchAll(re)].map((m) => parseInt(m[1], 10));
  return [...new Set(ids)];
}

/**
 * Parse `blocks #NNN` references from text.
 *
 * @param {string} body - Issue body or freeform text.
 * @returns {number[]} Array of issue numbers this text declares as blocked.
 */
export function parseBlocks(body) {
  if (!body) return [];
  const re = /blocks\s+#(\d+)/gi;
  return [...body.matchAll(re)].map((m) => parseInt(m[1], 10));
}

/**
 * Validates that a string is safe to use as a git branch name component.
 * Rejects shell metacharacters, whitespace, and other dangerous patterns.
 *
 * @param {string} value - The value to validate.
 * @returns {boolean} True if safe for use in branch names.
 */
export function isSafeBranchComponent(value) {
  // Allow: alphanumeric, hyphens, underscores, dots, forward slashes
  // Reject: everything else (shell metacharacters, spaces, etc.)
  return /^[a-zA-Z0-9._\-/]+$/.test(value);
}

/**
 * Pre-compiled `**Key**: value` matchers for every metadata key we extract.
 * Construction cost is paid once at module load rather than per task.
 */
const METADATA_FIELD_KEYS = [
  'Persona',
  'Mode',
  'Skills',
  'Focus Areas',
  'Protocol Version',
];
const METADATA_FIELD_RES = new Map(
  METADATA_FIELD_KEYS.map((k) => [
    k,
    new RegExp(`\\*\\*${k}\\*\\*\\s*:?\\s*(.+)`, 'i'),
  ]),
);

/**
 * Parse task execution metadata from the `## Metadata` section of a ticket body.
 * Returns a plain object with `persona`, `mode`, `skills`, `focusAreas`,
 * and `protocolVersion`.
 *
 * @param {string} body - Issue body text.
 * @returns {{ persona: string, mode: string, skills: string[], focusAreas: string[], protocolVersion: string }}
 */
export function parseTaskMetadata(body) {
  const defaults = {
    persona: 'engineer',
    mode: 'fast',
    skills: [],
    focusAreas: [],
    protocolVersion: '',
  };

  if (!body) return defaults;

  const metaMatch = body.match(/##\s*Metadata\s*([\s\S]*?)(?=\n##|$)/i);
  if (!metaMatch) return defaults;

  const block = metaMatch[1];

  function extractField(key) {
    const re = METADATA_FIELD_RES.get(key);
    const m = re ? block.match(re) : null;
    return m ? m[1].trim() : null;
  }

  function extractList(key) {
    const raw = extractField(key);
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    persona: extractField('Persona') || defaults.persona,
    mode: extractField('Mode') || defaults.mode,
    skills: extractList('Skills'),
    focusAreas: extractList('Focus Areas'),
    protocolVersion:
      extractField('Protocol Version') || defaults.protocolVersion,
  };
}
