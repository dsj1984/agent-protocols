/**
 * dependency-parser.js — Shared Dependency Parsing Utilities
 *
 * Canonical implementation of dependency-related regex parsing.
 * Eliminates duplicated implementations across dispatcher.js,
 * verify-prereqs.js, and providers/github.js.
 *
 * @see docs/v5-implementation-plan.md §Dependencies
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
  const re = /(?:blocked\s+by|depends\s+on)\s+#(\d+)/gi;
  const results = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    results.push(parseInt(match[1], 10));
  }
  return results;
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
  const results = [];
  let match;
  while ((match = re.exec(body)) !== null) {
    results.push(parseInt(match[1], 10));
  }
  return results;
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
