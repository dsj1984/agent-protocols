/**
 * review-providers/degraded-gates.js — the review's "a gate did not run"
 * channel (Story #4839).
 *
 * ## The defect this closes
 *
 * Story #4699 correctly decided that a tool which **could not execute** is an
 * operational degradation, not a code finding: it is routed to friction
 * telemetry so severity tiers keep reflecting code findings only. What #4699
 * did not add was any *other* channel, so the review's own verdict became
 * unable to distinguish "lint ran and found nothing" from "lint never ran" —
 * both rendered `✅ No findings` with an all-zero severity tally, and the close
 * pipeline read the second as the first. A gate that reports success when it
 * did not run is worse than no gate, because it is trusted.
 *
 * This module is that missing channel. A degradation travels **beside** the
 * `Finding[]`, never inside it:
 *
 *   - it never becomes a `Finding`, so `countBySeverity` is untouched and no
 *     execution failure can appear as a critical / high / medium (or even a
 *     suggestion) — #4699's intent survives intact;
 *   - it is rendered as its own section in the structured comment, and it
 *     suppresses the false `✅ No findings` claim;
 *   - it is carried on the `runCodeReview` envelope as `degraded` /
 *     `degradations[]`, so the close pipeline sees it too.
 *
 * ## Report, not block — and why
 *
 * A degraded gate is reported loudly and does **not** halt the close. The close
 * pipeline already runs the canonical `npm run lint` as a hard
 * close-validation gate *before* the review phase; the review's scoped lint is
 * a second, narrower read of the same surface. Failing a merge because a
 * *secondary* read of an already-gated surface could not start would block
 * delivery on an operational condition the hard gate has already covered. What
 * was actually broken was the silence, so the fix is to make the silence
 * impossible: every surface that reads the review outcome now states the
 * degradation explicitly. Escalating to a block is a one-line change here if
 * the operator posture ever needs it.
 */

/**
 * @typedef {object} GateDegradation
 * @property {string} tool     Emitter (e.g. `native-review-lint`).
 * @property {string} gate     Gate that degraded (e.g. `scoped-lint`).
 * @property {string} surface  Sub-surface that could not run (e.g. `markdownlint`).
 * @property {string} reason   Machine-readable reason code.
 */

/**
 * Pure: keep only well-formed degradation records. A misbehaving provider must
 * not be able to corrupt the rendered comment or the envelope.
 *
 * @param {unknown} input
 * @returns {GateDegradation[]}
 */
export function normalizeDegradations(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const d of input) {
    if (!d || typeof d !== 'object') continue;
    const surface = typeof d.surface === 'string' ? d.surface : null;
    const reason = typeof d.reason === 'string' ? d.reason : null;
    if (surface === null || reason === null) continue;
    out.push({
      tool: typeof d.tool === 'string' ? d.tool : 'unknown',
      gate: typeof d.gate === 'string' ? d.gate : 'unknown',
      surface,
      reason,
    });
  }
  return out;
}

/**
 * Feature-detect a provider's degradation channel, mirroring how
 * `getPromptMessages` is feature-detected. Providers predating this contract
 * carry no `getDegradations`, so the empty array keeps their output byte-stable;
 * a throw degrades to empty (observability must never fail a review).
 *
 * MUST be called **after** `runReview` — a provider records its degradations
 * during the run.
 *
 * @param {{ getDegradations?: Function }} reviewProvider
 * @param {{ warn?: Function }} [logger]
 * @returns {Promise<GateDegradation[]>}
 */
export async function collectProviderDegradations(reviewProvider, logger) {
  if (typeof reviewProvider?.getDegradations !== 'function') return [];
  try {
    return normalizeDegradations(await reviewProvider.getDegradations());
  } catch (err) {
    logger?.warn?.(
      `[code-review] getDegradations threw; treating as none. ${
        err?.message ?? err
      }`,
    );
    return [];
  }
}

/**
 * Pure: one-line operator-facing summary of the degraded gates, for progress
 * output and comment tallies. Empty input renders `none` so the field is always
 * present — a missing degradation line must never be read as "no degradation".
 *
 * @param {ReadonlyArray<GateDegradation>} degradations
 * @returns {string}
 */
export function summarizeDegradations(degradations) {
  const rows = normalizeDegradations(degradations);
  if (rows.length === 0) return 'none';
  return rows.map((d) => `${d.gate}/${d.surface} (${d.reason})`).join(', ');
}

/**
 * Pure: the `{ degraded, degradations }` pair every outcome envelope carries, so
 * a caller adds the channel by spreading one helper rather than restating the
 * derivation (and cannot ship `degradations` without `degraded`).
 *
 * @param {unknown} degradations
 * @returns {{ degraded: boolean, degradations: GateDegradation[] }}
 */
export function degradationEnvelope(degradations) {
  const rows = normalizeDegradations(degradations);
  return { degraded: rows.length > 0, degradations: rows };
}

/**
 * Merge the degraded-gate records of every inline chain entry that carries the
 * channel. A provider predating the contract contributes nothing; a throw is
 * logged and skipped, because a chain must never lose a "this gate did not run"
 * signal *or* fail a review over reporting one.
 *
 * @param {ReadonlyArray<{ name: string, provider: { getDegradations?: Function } }>} entries
 * @param {{ warn?: Function }} [logger]
 * @returns {Promise<GateDegradation[]>}
 */
export async function mergeChainDegradations(entries, logger) {
  const merged = [];
  for (const entry of entries) {
    if (typeof entry.provider?.getDegradations !== 'function') continue;
    try {
      merged.push(
        ...normalizeDegradations(await entry.provider.getDegradations()),
      );
    } catch (err) {
      logger?.warn?.(
        `[code-review] Inline provider "${entry.name}" getDegradations threw; skipping. ${
          err?.message ?? err
        }`,
      );
    }
  }
  return merged;
}

/**
 * Pure: the header field naming how many gates did not run. Empty when the
 * review was healthy, so a healthy body stays byte-identical to pre-#4839.
 *
 * @param {ReadonlyArray<GateDegradation>} degraded  Already normalized.
 * @returns {string[]}
 */
export function renderDegradedHeaderLines(degraded) {
  if (degraded.length === 0) return [];
  return [`**Degraded gates**: ${degraded.length} (did not run)`];
}

/**
 * Pure: the "nothing surfaced" block. This is the exact sentence the defect
 * turned into a lie — with a degraded gate present, an all-zero tally is not a
 * clean verdict and must not read like one.
 *
 * @param {ReadonlyArray<GateDegradation>} degraded  Already normalized.
 * @returns {string[]}
 */
export function renderNoFindingsBlock(degraded) {
  if (degraded.length === 0) {
    return [
      '### ✅ No findings',
      '',
      'No issues surfaced by the review provider.',
    ];
  }
  return [
    `### ⚠️ No findings — ${degraded.length} gate(s) did not run`,
    '',
    'The gates that ran surfaced no issues. This review does **not** vouch ' +
      'for the degraded surface(s) listed above.',
  ];
}

/**
 * Pure: render the "Degraded Gates" section of the structured comment. Returns
 * an empty array when nothing degraded, so a healthy review's body stays
 * byte-identical to the pre-#4839 output.
 *
 * @param {ReadonlyArray<GateDegradation>} degradations
 * @returns {string[]} markdown lines
 */
export function renderDegradedGatesSection(degradations) {
  const rows = normalizeDegradations(degradations);
  if (rows.length === 0) return [];
  const lines = [
    `### ⚠️ Degraded Gates (${rows.length})`,
    '',
    'The following review gate(s) **did not run**. Their surface is',
    'unreviewed — an all-zero finding tally below does not vouch for it.',
    '',
  ];
  for (const d of rows) {
    lines.push(
      `- \`${d.gate}\` → \`${d.surface}\` could not execute — ${d.reason} (emitter: \`${d.tool}\`).`,
    );
  }
  lines.push('');
  lines.push(
    'Verify with the canonical `npm run lint` before trusting this review.',
  );
  lines.push('');
  return lines;
}
