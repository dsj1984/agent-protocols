// lib/migrations/steps/2.32.0-retire-lint-baseline-command.js
/**
 * Story #5004 — strip the retired `project.commands.lintBaseline` from a
 * consumer's config. The framework-owned lint-baseline capture CLI is gone,
 * and the `commands` block carries `additionalProperties: false`, so a
 * config still naming the command fails validation on upgrade.
 *
 * It sweeps **both** config surfaces. `config-resolver.js` deep-merges
 * `.agentrc.local.json` over `.agentrc.json` and validates the result, so a
 * key surviving in the operator's overlay fails exactly as a base one would.
 * Sweeping only the base would report "nothing to migrate" and leave that
 * consumer hard-broken with no self-service remedy — re-running
 * `mandrel update` would keep reporting clean — while this commit's
 * `BREAKING CHANGE:` footer promises the upgrade deletes the key for them.
 *
 * The `lint` baseline KIND survives for consumers whose own linter writes
 * `baselines/lint.json`; only the framework-owned capture shell is gone, so
 * nothing here touches the baseline file or the gate config.
 *
 * An emptied `commands` block is deliberately left in place (`pruneDepth: 0`):
 * unlike `planning.complexityGate`, `project` is a required block and an empty
 * `commands` object is valid against the schema, so pruning it would be a
 * cosmetic edit to a config the consumer owns.
 *
 * This step is also the carrier for the release note #5004 never emitted: its
 * commit ships the `BREAKING CHANGE:` footer that the squash subject on `main`
 * (`227e1af4`) lacks, and which release-please therefore could not surface.
 * See `single-story-close/phases/conventional-subject.js` for the close-side
 * fix that stops the next one being lost.
 */

import { createRetireAgentrcKeyStep } from '../helpers/retire-agentrc-key.js';

export const retireLintBaselineCommand = createRetireAgentrcKeyStep({
  version: '2.32.0',
  description:
    'strip retired project.commands.lintBaseline from .agentrc.json ' +
    '(the framework lint-baseline capture CLI is gone — Story #5004)',
  keys: [{ path: ['project', 'commands', 'lintBaseline'], pruneDepth: 0 }],
});
