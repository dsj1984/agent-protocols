/**
 * lib/findings/severity.js — Canonical severity vocabulary for the findings core.
 *
 * Single source of truth for finding severity (Story #3816). Three modules in
 * the shared findings core previously each declared their own severity list —
 * `classify-finding.js` (`[unknown, low, medium, high, critical]`),
 * `promote-finding.js` (`SEVERITY_RANK` over `[critical … info]`), and the
 * `qa-ledger` JSON schema (`[critical, high, medium, low, info]`). Because
 * `severity` is a `fingerprintFinding` identity field
 * (`route-finding.js`), the same finding could hash to different SHAs depending
 * on which path normalised its severity, silently weakening dedup. This module
 * collapses all three onto one enum + one normaliser so the fingerprint is
 * stable regardless of the code path that produced the severity.
 *
 * The canonical order is `critical | high | medium | low | info`, highest →
 * lowest, and it MUST match the `severity` enum in
 * `.agents/schemas/qa-ledger.schema.json`. Pure module: no I/O, no
 * module-level state beyond the frozen constants.
 */

/**
 * The closed, canonical set of severity values, ordered highest → lowest.
 * This is the ONLY definition of the severity vocabulary in the findings core;
 * `classify-finding.js` and `promote-finding.js` re-export / import it rather
 * than re-declaring their own list. Mirrors the `severity` enum in
 * `qa-ledger.schema.json`.
 */
export const SEVERITIES = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

/**
 * The severity applied when a finding carries no recognisable severity. `info`
 * is the canonical floor (lowest level). The ledger/finding schemas REQUIRE a
 * severity drawn from {@link SEVERITIES}, so this fallback only fires on
 * malformed input — and because both the classify and promote paths share it,
 * malformed input still fingerprints identically across the two paths.
 */
const DEFAULT_SEVERITY = 'info';

const SEVERITY_SET = new Set(SEVERITIES);

/**
 * Non-canonical spellings that resolve onto a canonical level (Story #4877).
 *
 * The vocabulary drifted because four modules each carried their own partial
 * copy of it: `audit-to-stories/parse-audit-md.js` recognised
 * `critical|high|medium|mod|moderate|low` and nothing else, `audit-to-stories.js`
 * ranked `critical|high|medium|low`, and `audit-to-stories/seed-from-findings.js`
 * ordered the same four. None of them knew `info` — the canonical floor — so an
 * `Info` / `Informational` finding parsed to `null`, tallied as `unknown`, and
 * was dropped by EVERY severity-filtered run (including `--severity low`).
 * Folding the alias table in here makes this module the only place the
 * vocabulary is written down.
 *
 * Keys are already lower-cased and trimmed by {@link normalizeSeverity}.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SEVERITY_ALIASES = Object.freeze({
  blocker: 'critical',
  major: 'high',
  mod: 'medium',
  moderate: 'medium',
  minor: 'low',
  informational: 'info',
  nit: 'info',
  trivial: 'info',
});

/**
 * Numeric rank for "highest severity wins" comparisons, derived from the
 * canonical order so the ranking has exactly one source. `critical` is the
 * highest rank (`SEVERITIES.length - 1`); `info` is `0`.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const SEVERITY_RANK = Object.freeze(
  Object.fromEntries(
    SEVERITIES.map((severity, index) => [
      severity,
      SEVERITIES.length - 1 - index,
    ]),
  ),
);

/**
 * Normalise an arbitrary severity input to one of {@link SEVERITIES}. Case- and
 * whitespace-insensitive. A non-string, empty, or unrecognised value resolves
 * to `fallback` (default {@link DEFAULT_SEVERITY}) rather than throwing — the
 * findings pipeline treats severity as advisory signal, never a hard gate.
 *
 * @param {unknown} value — the raw severity field off a finding/ledger item.
 * @param {string} [fallback=DEFAULT_SEVERITY] — canonical value to return when
 *   `value` is absent or unrecognised.
 * @returns {string} one of {@link SEVERITIES}.
 */
export function normalizeSeverity(value, fallback = DEFAULT_SEVERITY) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (SEVERITY_SET.has(normalized)) return normalized;
  return SEVERITY_ALIASES[normalized] ?? fallback;
}

/**
 * The **identity projection** of a severity, for use inside a finding
 * fingerprint — and nowhere else (Story #4877).
 *
 * `severity` is a `fingerprintFinding` identity field
 * (`route-finding.js`), so whatever this returns is folded into the sha that
 * deduplicates findings against already-filed Issues. That makes the severity
 * pipeline and the severity *identity* two different jobs with two different
 * failure modes:
 *
 * - {@link normalizeSeverity} resolves an absent or unrecognised severity to
 *   `info` so downstream filtering and tallies have a level to work with.
 * - This function must NOT. Folding `info` in where the previous
 *   implementation folded the empty string would re-mint the fingerprint of
 *   every finding that carries no severity, silently breaking dedup for all of
 *   them. An absent severity therefore stays the empty string, exactly as the
 *   raw `String(value).toLowerCase().trim()` it replaces produced.
 *
 * What it *does* change is alias resolution: `Informational` and `info` project
 * onto the same `info`, so the fingerprint is **invariant** under the
 * normalization this Story introduces — a finding hashes the same whether it is
 * fingerprinted before or after {@link normalizeSeverity} has run over it. An
 * unrecognised non-empty value is passed through verbatim rather than collapsed,
 * again so no already-filed fingerprint moves.
 *
 * @param {unknown} value — the raw severity field off a finding.
 * @returns {string} a canonical level, the empty string when absent, or the
 *   lower-cased raw value when it is neither canonical nor a known alias.
 */
export function fingerprintSeverity(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim().toLowerCase();
  if (raw.length === 0) return '';
  return normalizeSeverity(raw, raw);
}

/**
 * The highest-ranked severity across a list of raw severity values. Returns
 * {@link DEFAULT_SEVERITY} for an empty list. Each value is normalised through
 * {@link normalizeSeverity}, so the result is always one of {@link SEVERITIES}.
 *
 * @param {Iterable<unknown>} values — raw severity strings (or anything
 *   `normalizeSeverity` accepts).
 * @returns {string} one of {@link SEVERITIES}.
 */
export function highestSeverity(values) {
  let best = DEFAULT_SEVERITY;
  let bestRank = -1;
  for (const value of values) {
    const severity = normalizeSeverity(value);
    const rank = SEVERITY_RANK[severity];
    if (rank > bestRank) {
      bestRank = rank;
      best = severity;
    }
  }
  return best;
}

/**
 * Internals reached by the unit tests only. The floor and the alias table are
 * consumed exclusively by this module's own exported functions, so they are
 * not public API — but the alias table carries a structural invariant (no
 * alias shadows a canonical level, every target IS one) that cannot be proven
 * through `normalizeSeverity` alone, since that function returns a canonical
 * value by construction.
 */
export const __testing = {
  DEFAULT_SEVERITY,
  SEVERITY_ALIASES,
};
