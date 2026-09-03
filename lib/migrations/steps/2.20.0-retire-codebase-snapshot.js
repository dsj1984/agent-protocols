// lib/migrations/steps/2.20.0-retire-codebase-snapshot.js
/**
 * Story #4811 — strip the retired `planning.codebaseSnapshot` block from a
 * consumer's `.agentrc.json` and from the `.agentrc.local.json` overlay an
 * operator pins in `.agentrc.local.json`.
 *
 * Spec authoring is grounded by targeted retrieval plus the Phase 8
 * file-assumption gate, so the snapshot block has no consumer; the block
 * carries `additionalProperties: false`, so a config still setting it fails
 * validation on upgrade rather than warning.
 *
 * `planning` is optional, so a config that carried nothing but the snapshot
 * does not keep an orphan `planning: {}`.
 */

import { createRetireAgentrcKeyStep } from '../helpers/retire-agentrc-key.js';

export const retireCodebaseSnapshot = createRetireAgentrcKeyStep({
  version: '2.20.0',
  description:
    'strip retired planning.codebaseSnapshot from .agentrc.json / ' +
    '.agentrc.local.json (spec authoring is grounded by targeted retrieval ' +
    'plus the Phase 8 file-assumption gate — Story #4811)',
  keys: [{ path: ['planning', 'codebaseSnapshot'], pruneDepth: 1 }],
});
