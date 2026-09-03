// lib/migrations/steps/2.1.0-retire-mi-drop-knobs.js
/**
 * Story #4531 — the first real step in the migration registry.
 *
 * `delivery.quality.codingGuardrails.miDropMustRefactor` and
 * `delivery.quality.autoRefresh.miDropCap` were schema-validated, defaulted,
 * and seeded by `apply-quality-bootstrap.js` into a consumer's
 * `.agentrc.json` — but never consumed by the gate they were named for
 * (`maintainability.tolerance` is the knob actually in force; see the
 * Story body for the full diagnosis). Both retired keys lived under
 * sub-schemas with `additionalProperties: false`, so a consumer whose
 * config still carries either key hits a hard AJV validation failure on
 * upgrade, not a warning. This step strips them before that check runs.
 *
 * Unlike the later retire-steps this one sweeps the committed config only:
 * the knobs were written by the bootstrap script, never hand-pinned in an
 * operator's `.agentrc.local.json`.
 */

import {
  AGENTRC_BASE_FILENAME,
  createRetireAgentrcKeyStep,
} from '../helpers/retire-agentrc-key.js';

export const retireMiDropKnobs = createRetireAgentrcKeyStep({
  version: '2.1.0',
  description:
    'strip retired delivery.quality.codingGuardrails.miDropMustRefactor ' +
    'and delivery.quality.autoRefresh.miDropCap from .agentrc.json',
  filenames: [AGENTRC_BASE_FILENAME],
  keys: [
    {
      path: ['delivery', 'quality', 'codingGuardrails', 'miDropMustRefactor'],
      pruneDepth: 1,
    },
    {
      path: ['delivery', 'quality', 'autoRefresh', 'miDropCap'],
      pruneDepth: 1,
    },
  ],
});
