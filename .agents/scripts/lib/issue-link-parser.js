/**
 * Parse PRD / Tech-Spec references from a GitHub epic body. Extracted from
 * providers/github.js so link-parsing is not mixed with HTTP transport.
 *
 * Expected markdown conventions in an epic body:
 *   - "PRD: #42"  or  "prd #42"
 *   - "Tech Spec: #43"  /  "Technical Spec: #43"  /  "tech-spec: #43"
 */

const PRD_RE = /(?:PRD|prd)[:\s]+#(\d+)/;
const TECH_SPEC_RE = /(?:Tech Spec|tech.?spec|technical.?spec)[:\s]+#(\d+)/i;

/**
 * @param {string|null|undefined} body
 * @returns {{ prd: number|null, techSpec: number|null }}
 */
export function parseLinkedIssues(body) {
  const result = { prd: null, techSpec: null };
  if (typeof body !== 'string' || body.length === 0) return result;
  const prdMatch = body.match(PRD_RE);
  if (prdMatch) result.prd = Number.parseInt(prdMatch[1], 10);
  const specMatch = body.match(TECH_SPEC_RE);
  if (specMatch) result.techSpec = Number.parseInt(specMatch[1], 10);
  return result;
}
