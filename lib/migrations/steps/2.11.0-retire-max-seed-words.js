// lib/migrations/steps/2.11.0-retire-max-seed-words.js
/**
 * Story #4722 follow-up — strip the retired
 * `planning.complexityGate.maxSeedWords` knob from a consumer's
 * `.agentrc.json`.
 *
 * #4722 (PR #4725) hard-cutover-removed word-count complexity routing:
 * the route derives from the authored Story's shape, never from seed word
 * count, and `maxSeedWords` was dropped from the runtime AJV schema and
 * the published mirror. The `complexityGate` block carries
 * `additionalProperties: false`, so a consumer whose config still sets
 * `maxSeedWords` hits a hard validation failure on upgrade, not a
 * warning. This step strips the key before that check runs — the same
 * contract-cutover pattern as `2.1.0-retire-mi-drop-knobs.js`.
 *
 * `planning` is an optional block, so an emptied `complexityGate` and an
 * emptied `planning` are both pruned rather than left as orphan objects.
 */

import {
  AGENTRC_BASE_FILENAME,
  createRetireAgentrcKeyStep,
} from '../helpers/retire-agentrc-key.js';

export const retireMaxSeedWords = createRetireAgentrcKeyStep({
  version: '2.11.0',
  description:
    'strip retired planning.complexityGate.maxSeedWords from .agentrc.json ' +
    '(complexity routes on Story shape, never seed word count — Story #4722)',
  filenames: [AGENTRC_BASE_FILENAME],
  keys: [
    { path: ['planning', 'complexityGate', 'maxSeedWords'], pruneDepth: 2 },
  ],
});
