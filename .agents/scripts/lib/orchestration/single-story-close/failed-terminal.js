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
  // Story #5172 — base-sync now precedes close-validation, so the tree the
  // gates validate is the tree the push sends. The order here is not
  // decoration: it is how a failed terminal decides which gates had already
  // cleared, so it MUST track `runPrePushPhases`.
  'base-sync',
  'close-validation',
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
 * The names the split baselines gate registers under, mirrored from
 * `BASELINES_GATE_NAMES` in `lib/close-validation/gates.js` (Story #5172).
 *
 * Deliberately a local copy rather than an import: several close suites
 * replace that module wholesale via `t.mock.module`, and a named import here
 * would fail to link against a mock that does not re-export the constant —
 * turning an unrelated test's mock into a load error on the CLI's own entry
 * path. `tests/close-validation-gates-enum.test.js` pins the two lists
 * against each other so the copy cannot drift.
 */
const BASELINES_ENTRY_NAMES = Object.freeze([
  'check-baselines-independent',
  'check-baselines-coverage',
]);

/**
 * Outcome for each split baselines entry on a run that died at `phase`.
 *
 * The two entries sit in ONE pipeline phase, so the phase walk alone cannot
 * separate them — `failedGate` (tagged onto the error by the close-validation
 * phase) is what names the entry that actually broke. Rules, in the module's
 * house style of never claiming a pass it cannot prove:
 *   - validation skipped, or the run died before reaching it → both `skipped`.
 *   - the run cleared validation entirely → both `passed`.
 *   - the run died IN validation on the coverage-independent entry → that one
 *     `failed`, the coverage one `skipped` (it runs behind `coverage-capture`,
 *     which the failure pre-empted).
 *   - died on the coverage-consuming entry → that one `failed`, and the
 *     independent one `passed`: it is in the parallel partition that must go
 *     green before any serial gate starts.
 *   - died in validation on some other gate → both `skipped`; which of them
 *     had run is not knowable from the phase alone.
 *
 * @param {string} phase
 * @param {{ skipValidation?: boolean, failedGate?: string|null }} args
 * @returns {Record<string, 'passed'|'failed'|'skipped'>}
 */
function baselinesGatesForFailedPhase(phase, { skipValidation, failedGate }) {
  const [independent, coverage] = BASELINES_ENTRY_NAMES;
  const both = (outcome) => ({ [independent]: outcome, [coverage]: outcome });
  const failedAt = PHASE_ORDER.indexOf(phase);
  const validationAt = PHASE_ORDER.indexOf('close-validation');
  if (skipValidation || failedAt < 0 || failedAt < validationAt) {
    return both('skipped');
  }
  if (failedAt > validationAt) return both('passed');
  if (failedGate === independent) {
    return { [independent]: 'failed', [coverage]: 'skipped' };
  }
  if (failedGate === coverage) {
    return { [independent]: 'passed', [coverage]: 'failed' };
  }
  return both('skipped');
}

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
 * Story #5172 — the reported set also carries the two split baselines
 * entries under their own names, so a failed close says WHICH half of the
 * baselines gate breached instead of a single generic verdict.
 *
 * @param {string} phase The phase the run died in.
 * @param {{ skipValidation?: boolean, skipSync?: boolean, failedGate?: string|null }} args
 *   Parsed CLI args, plus the gate name tagged onto the error by the
 *   close-validation phase.
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
  return {
    ...gates,
    ...baselinesGatesForFailedPhase(phase, {
      skipValidation: args.skipValidation,
      failedGate: args.failedGate ?? null,
    }),
  };
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
 * `err.closeGate` — tagged by the close-validation phase — names the gate that
 * died inside that phase, which is what lets the reported gates separate the
 * two split baselines entries (Story #5172).
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
      gates: gatesForFailedPhase(phase, {
        ...args,
        failedGate: err?.closeGate ?? null,
      }),
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
