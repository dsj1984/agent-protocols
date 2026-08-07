/**
 * lib/findings/provenance-field.js — the per-Story `provenance` field.
 *
 * An audit-seeded plan carries dedup identities forward so the next sweep
 * recognises what it already planned. The optional top-level `provenance`
 * field on a `stories.json` entry says **which of them that Story owns**:
 *
 * ```jsonc
 * { "fingerprints": ["<40-char sha1>"], "semanticKeys": ["architecture␟lib/a.js"] }
 * ```
 *
 * Two callers, deliberately split from
 * [`route-finding.js`](route-finding.js): the ticket validator shape-checks
 * the authored field, and plan-persist's assembly renders the owned identities
 * into the footer source it stamps. Neither is dedup *routing*, which is what
 * `route-finding.js` is for — this module reads its identity vocabulary
 * (`SHA1_RE`, `SEMANTIC_KEY_RE`, and the two footer renderers) from there so
 * there is exactly one definition of what a fingerprint or a semantic key
 * looks like.
 *
 * @module lib/findings/provenance-field
 */

import {
  fingerprintFooter,
  SEMANTIC_KEY_RE,
  SHA1_RE,
  semanticKeyFooter,
} from './route-finding.js';

/** Human-readable rendering of the `provenance` field's two lists. */
const PROVENANCE_SHAPE = 'fingerprints[] / semanticKeys[]';

/** What each `provenance` list accepts, and how to say so when it does not. */
const PROVENANCE_FIELDS = Object.freeze({
  fingerprints: { pattern: SHA1_RE, expected: 'a 40-char sha1 hex string' },
  semanticKeys: {
    pattern: SEMANTIC_KEY_RE,
    expected: 'a non-empty key carrying no comma or ">"',
  },
});

/**
 * Validate one authored `provenance` list into its normalized form.
 *
 * @param {unknown} list
 * @param {{ where: string, field: string, pattern: RegExp, expected: string }} spec
 * @returns {string[]} Trimmed, de-duplicated, first-seen order.
 */
function normalizeList(list, { where, field, pattern, expected }) {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error(`${where}: ${field} must be an array of strings`);
  }
  const out = [];
  for (const entry of list) {
    const value = typeof entry === 'string' ? entry.trim() : '';
    if (!pattern.test(value)) {
      throw new Error(
        `${where}: ${field} entry ${JSON.stringify(entry)} is not ${expected}`,
      );
    }
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Normalize the optional per-Story `provenance` field a plan may author —
 * the identities of the findings **that Story owns**.
 *
 * Absence is meaningful and must stay cheap: `undefined` / `null` returns
 * `null`, which is the caller's signal to fall back to the whole-seed union
 * carry. That fallback is not vestigial — leaving the authoring agent to
 * hand-carry provenance out of the seed's HTML comments was measured to fail,
 * and the mechanical union is what closed it. Attribution is **additive**: a
 * plan that attributes gets exact stamping, a plan that does not keeps recall.
 *
 * An empty object is therefore *not* the same as an absent field: it means
 * "this Story owns nothing", and stamps nothing.
 *
 * Present-but-malformed is a hard error rather than a silent drop, because a
 * dropped identity is invisible until the next sweep re-files work that was
 * already planned.
 *
 * @param {unknown} raw
 * @param {string} [label] Identifier for the error message (a Story slug).
 * @returns {{ fingerprints: string[], semanticKeys: string[] }|null}
 * @throws {Error} On any shape the stamper cannot honour exactly.
 */
export function normalizeOwnedProvenance(raw, label = 'story') {
  if (raw === undefined || raw === null) return null;
  const where = `provenance on "${label}"`;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where} must be an object of ${PROVENANCE_SHAPE}`);
  }
  const out = { fingerprints: [], semanticKeys: [] };
  for (const [field, list] of Object.entries(raw)) {
    const spec = PROVENANCE_FIELDS[field];
    if (!spec) {
      throw new Error(
        `${where} carries an unknown field: ${field} — only ${PROVENANCE_SHAPE} are stamped`,
      );
    }
    out[field] = normalizeList(list, { where, field, ...spec });
  }
  return out;
}

/**
 * Render the provenance **source document** for a set of owned identities, in
 * the same footer vocabulary `carryProvenanceFooters` harvests from an audit
 * seed. That reuse is the point: attribution changes *which* identities reach
 * a Story body, never how they are stamped, so the carry stays additive,
 * union-preserving and idempotent for an attributed plan exactly as it is for
 * an un-attributed one.
 *
 * An empty (or absent) set renders the empty string, which the carry treats as
 * nothing-to-do — so a Story that owns no findings is stamped with none rather
 * than inheriting its siblings'.
 *
 * Expects the normalized shape {@link normalizeOwnedProvenance} returns; the
 * validator runs first on every production path.
 *
 * @param {{ fingerprints?: string[], semanticKeys?: string[] }|null} [provenance]
 * @returns {string}
 */
export function ownedProvenanceSource(provenance) {
  const shas = provenance?.fingerprints ?? [];
  const keys = provenance?.semanticKeys ?? [];
  const parts = [];
  if (shas.length > 0) parts.push(fingerprintFooter(shas));
  if (keys.length > 0) parts.push(semanticKeyFooter(keys));
  return parts.join('\n');
}
