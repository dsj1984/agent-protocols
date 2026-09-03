// lib/migrations/steps/2.1.0-retire-verify-concurrency-cap.js
/**
 * Story #4531 — `delivery.deliverRunner.verifyConcurrencyCap` was retired
 * when verification stopped being separately capped, but it stayed
 * schema-validated in consumers' configs under a block carrying
 * `additionalProperties: false`, so a config still setting it fails AJV
 * validation on upgrade rather than warning. This step strips it before
 * that check runs.
 *
 * Unlike the 2.1.0 mi-drop step, this one also sweeps `.agentrc.local.json`:
 * the resolver deep-merges the local override over `.agentrc.json` and
 * validates the *merged* result, so a key left in the local file fails the
 * same way a key in the committed file does.
 */

import { createRetireAgentrcKeyStep } from '../helpers/retire-agentrc-key.js';

export const retireVerifyConcurrencyCap = createRetireAgentrcKeyStep({
  version: '2.1.0',
  description:
    'strip retired delivery.deliverRunner.verifyConcurrencyCap from ' +
    '.agentrc.json and .agentrc.local.json',
  keys: [
    {
      path: ['delivery', 'deliverRunner', 'verifyConcurrencyCap'],
      pruneDepth: 1,
    },
  ],
});
