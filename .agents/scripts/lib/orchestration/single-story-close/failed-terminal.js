/**
 * single-story-close/failed-terminal.js — the `failed` terminal a close
 * emits when a phase crashes, and the gate reconstruction it carries.
 *
 * Split out of `single-story-close.js` so the CLI entry stays an entry: it
 * parses args, dispatches the runner, and maps a terminal onto an exit code.
 * The reasoning about which gates had run by the time a phase died belongs
 * with the envelope it feeds, not in the file that owns process lifetime.
 *
 * The runner deliberately throws rather than returning a failure (a red gate
 * must not look like a return value), so without this the most common
 * non-happy ending — a failing close-validation gate — would emit **no
 * envelope at all**, exiting 1 with only a stderr line while the workflow
 * docs promise the agent a `failed` envelope naming the phase.
 */

import { Logger } from '../../Logger.js';
import {
  buildTerminalEnvelope,
  NEXT_COMMANDS,
} from '../story-deliver-terminal.js';

/**
 * The close pipeline's phase order, as `setPhase` walks it. Only used to
 * decide whether a gate had already run when a later phase died.
 */
const PHASE_ORDER = Object.freeze([
  'init',
  'wrong-tree-guard',
  'close-validation',
  'base-sync',
  'push',
  'pull-request',
  'code-review',
  'auto-merge',
  'confirm-merge',
  'post-land',
  'done',
]);

/** Each reported gate and the pipeline phase that decides it. */
const GATE_PHASES = Object.freeze([
  ['validation', 'close-validation'],
  ['baseSync', 'base-sync'],
  ['codeReview', 'code-review'],
]);

/**
 * Report every gate's outcome for a run that died at `phase`.
 *
 * The schema's contract: "A gate the run skipped … reports `skipped` rather
 * than being omitted, so a missing gate is never mistaken for a passing one."
 * The previous shape named only the gate that died and omitted the rest
 * entirely — exactly the ambiguity the contract forbids.
 *
 * Reconstructed from the phase order, which is sound because the pipeline is
 * strictly sequential: reaching phase N means every gate before it completed.
 * A gate whose phase the run never reached is `skipped`; one the operator
 * turned off via `--skip-validation` / `--skip-sync` is `skipped` too (it did
 * not pass — it never ran).
 *
 * @param {string} phase The phase the run died in.
 * @param {{ skipValidation?: boolean, skipSync?: boolean }} args Parsed CLI args.
 * @returns {Record<string, 'passed'|'failed'|'skipped'>}
 */
export function gatesForFailedPhase(phase, args = {}) {
  const skipped = { validation: args.skipValidation, baseSync: args.skipSync };
  const failedAt = PHASE_ORDER.indexOf(phase);
  const gates = {};
  for (const [gate, gatePhase] of GATE_PHASES) {
    const at = PHASE_ORDER.indexOf(gatePhase);
    if (gatePhase === phase) gates[gate] = 'failed';
    else if (failedAt < 0 || at > failedAt) gates[gate] = 'skipped';
    else gates[gate] = skipped[gate] ? 'skipped' : 'passed';
  }
  return gates;
}

/**
 * Build the `failed` terminal for a phase that crashed. Every close
 * invocation emits exactly one envelope; this is the path that keeps that
 * true when a phase dies.
 *
 * `err.closePhase` is tagged by the runner's phase tracker.
 *
 * **Never throws.** This runs on the path that already has one failure in
 * hand, so a second failure here must not REPLACE the first: an
 * envelope-build error surfacing as the run's cause sends the operator to
 * diagnose the wrong thing entirely — a close whose PR had already merged
 * once reported a schema `ENOENT` as its fatal error, because the worktree
 * holding the script had been reaped mid-run. On failure this returns null
 * and the caller rethrows the original.
 *
 * @param {unknown} err
 * @param {{ storyId?: string|number, skipValidation?: boolean, skipSync?: boolean }} args
 *   Parsed CLI args — the story id the envelope reports on, plus the skip
 *   flags `gatesForFailedPhase` needs.
 * @returns {object|null} A validated envelope, or null when even the story id
 *   is unknown (a usage error — there is nothing to report an envelope about)
 *   or the envelope itself could not be assembled.
 */
export function failedTerminalFor(err, args = {}) {
  const phase = err?.closePhase ?? 'init';
  const storyId = Number(args.storyId);
  if (!Number.isInteger(storyId) || storyId <= 0) return null;
  try {
    return buildTerminalEnvelope({
      storyId,
      status: 'failed',
      phase,
      gates: gatesForFailedPhase(phase, args),
      failure: { reason: String(err?.message ?? err) },
      nextCommand: NEXT_COMMANDS.recover(storyId),
      elapsedSeconds: 0,
    });
  } catch (buildErr) {
    Logger.error(
      `[single-story-close] ⚠️ Could not assemble the failed terminal envelope: ${buildErr?.message ?? buildErr}. Reporting the original failure instead.`,
    );
    return null;
  }
}
