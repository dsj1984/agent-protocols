/**
 * parse-id-list — expand a Story-id list that may contain dash ranges.
 *
 * Operators name a contiguous span of Stories the way they read one — as a
 * range: `/mandrel-deliver 4922 - 4926`. Enumerating it by hand is the kind of
 * transcription step that silently drops or invents an id, so the range is a
 * first-class shape of every delivery id list rather than something the host
 * expands from prose.
 *
 * Accepted tokens, comma-separated:
 *   - a single id, with an optional `#` — `4922`, `#4922`
 *   - an inclusive range — `4922-4926`, `4922 - 4926`, `#4922-#4926`
 *     (hyphen-minus, en dash, or em dash; whitespace around it is fine)
 *
 * Everything else is a hard error, never a silent drop: a wrong id list
 * co-dispatches against the wrong graph, so it must fail where it is typed.
 * Two range-specific guards exist for the same reason — a backwards range is
 * refused rather than expanded to nothing, and a span above `MAX_RANGE_SPAN`
 * is refused rather than resolving thousands of issues off a typo.
 */

/**
 * Inclusive-span ceiling for a single range token. Generous against any real
 * plan run (a handful of Stories) and tight enough that `1-4926` is caught as
 * the typo it is rather than fanning out into a live resolution sweep.
 *
 * Deliberately module-private: the cap is a published contract
 * (`helpers/deliver-reference.md` § Ranges), so a test that imported it could
 * not notice the number silently moving out from under the doc.
 */
const MAX_RANGE_SPAN = 50;

/** Hyphen-minus, en dash, em dash — whichever the operator's keyboard emits. */
const DASH = '[-–—]';
const SINGLE_RE = /^#?(\d+)$/;
const RANGE_RE = new RegExp(`^#?(\\d+)\\s*${DASH}\\s*#?(\\d+)$`);

/**
 * Parse a comma-separated Story-id list, expanding any `A-B` range token.
 *
 * Absent or empty input is not an error here — it yields an empty list, and
 * the caller decides whether that is a usage error (`--ids`) or a legitimate
 * empty set (`--done`).
 *
 * @param {string|undefined|null} raw
 * @param {object} [options]
 * @param {string} [options.flag] Flag name, for the error message.
 * @param {string} [options.prefix] Message prefix, for the caller's log tag.
 * @param {number} [options.maxSpan] Inclusive-span ceiling per range token.
 * @returns {{ ids: number[]|null, error: string|null }}
 */
export function expandIdList(raw, options = {}) {
  const { flag = '--ids', prefix = '', maxSpan = MAX_RANGE_SPAN } = options;
  const fail = (message) => ({ ids: null, error: `${prefix}${message}` });

  const ids = [];
  const seen = new Set();
  const push = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    ids.push(n);
  };

  for (const token of String(raw ?? '').split(',')) {
    const trimmed = token.trim();
    if (trimmed === '') continue;

    const range = RANGE_RE.exec(trimmed);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start <= 0 || end <= 0) {
        return fail(
          `${flag} range "${trimmed}" must use positive issue numbers.`,
        );
      }
      if (end < start) {
        return fail(
          `${flag} range "${trimmed}" runs backwards — write it low-to-high (e.g. 4922-4926).`,
        );
      }
      const span = end - start + 1;
      if (span > maxSpan) {
        return fail(
          `${flag} range "${trimmed}" spans ${span} ids, above the ${maxSpan}-id cap. Narrow it, or list the ids.`,
        );
      }
      for (let n = start; n <= end; n++) push(n);
      continue;
    }

    const single = SINGLE_RE.exec(trimmed);
    const n = single ? Number(single[1]) : Number.NaN;
    if (!Number.isInteger(n) || n <= 0) {
      return fail(
        `${flag} must be a comma-separated list of positive issue numbers or A-B ranges (got "${trimmed}").`,
      );
    }
    push(n);
  }

  return { ids, error: null };
}
