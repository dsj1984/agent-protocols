/**
 * footer-block.js — the Story body's `---` footer grammar.
 *
 * A Story body is prose an operator edits. Its **declared dependency edges**
 * are not: they live in a footer block, in one exact line shape, and that
 * distinction is the whole safety property. An unanchored whole-body scan
 * (what `parseBlockedBy` used to be) turned any sentence that merely mentioned
 * a blocker into a real dispatch gate — an example, a changelog note, an
 * acceptance criterion quoting the phrase — and withheld the Story until an
 * unrelated issue closed.
 *
 * This module is the single home for that grammar. Both readers go through it:
 * `lib/story-body/story-body.js` (what a body round-trips as `depends_on`) and
 * `lib/dependency-parser.js` (what gates dispatch). Sharing one implementation
 * is what keeps them from drifting apart into two different answers about the
 * same body.
 *
 * @module lib/story-body/footer-block
 */

/**
 * The one line shape that declares a dependency edge: `blocked by #N` alone on
 * its own line inside the footer block. Anchored at both ends deliberately —
 * `depends on #N`, `Blocked by: #N`, and `blocked by #N once X lands` all
 * declare nothing.
 */
const FOOTER_BLOCKED_BY_LINE_RE = /^blocked by\s+(#\d+)$/i;

/** A `---` rule on its own line. */
const FOOTER_RULE_RE = /^---\s*$/;

/** Footer keys that qualify a bare `---` rule as the footer separator. */
const FOOTER_KEY_RE = /^(parent:|Epic:|blocked by)/im;

/**
 * True when line `index` opens the footer block: a `---` on its own line whose
 * remaining lines start with a recognised footer key (`parent:`, `Epic:`,
 * `blocked by`). A `---` opening a thematic break or a table mid-body is
 * therefore not mistaken for the footer.
 *
 * @param {string} line
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
export function isFooterSeparator(line, lines, index) {
  if (!FOOTER_RULE_RE.test(line)) return false;
  return FOOTER_KEY_RE.test(lines.slice(index + 1).join('\n'));
}

/**
 * Return the footer block of a body — everything after the footer separator —
 * or `''` when the body carries no footer.
 *
 * Module-private: `parseFooterBlockedByIds` is its only caller. The body
 * parser splits its own sections and reaches for `parseFooterBlockedByRefs`
 * with the footer it already has, so exporting this would ship a symbol with
 * no consumer.
 *
 * @param {string} body
 * @returns {string}
 */
function extractFooterBlock(body) {
  if (!body) return '';
  const lines = String(body).split('\n');
  const start = lines.findIndex((line, i) => isFooterSeparator(line, lines, i));
  return start === -1 ? '' : lines.slice(start + 1).join('\n');
}

/**
 * Extract the `blocked by #N` refs from an already-split footer block, as the
 * `"#N"` strings a Story body's `depends_on` field round-trips.
 *
 * @param {string} footerBlock
 * @returns {string[]}
 */
export function parseFooterBlockedByRefs(footerBlock) {
  if (!footerBlock) return [];
  return String(footerBlock)
    .split('\n')
    .map((line) => line.trim().match(FOOTER_BLOCKED_BY_LINE_RE)?.[1])
    .filter((ref) => typeof ref === 'string');
}

/**
 * Parse a body's declared blocker issue **numbers**, deduped — the
 * dispatch-edge view of the same footer the body parser reads.
 *
 * @param {string} body
 * @returns {number[]}
 */
export function parseFooterBlockedByIds(body) {
  const ids = parseFooterBlockedByRefs(extractFooterBlock(body)).map((ref) =>
    Number.parseInt(ref.slice(1), 10),
  );
  return [...new Set(ids)];
}
