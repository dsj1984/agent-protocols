#!/usr/bin/env node

/**
 * acceptance-eval.js — bounded per-Story acceptance self-eval gate (Story #3819).
 *
 * The Story-implementation phase runs ONE verdict-owner per acceptance
 * cluster (Story #4723) — the fresh-context critic when
 * `ceremony-routing.js` sensitivity-routes the cluster fresh, the
 * contract-identical inline self-eval otherwise — which scores the
 * caller-injected change set against each inline `acceptance[]` item and
 * emits one verdict file per round
 * (`.agents/schemas/acceptance-eval-verdict.schema.json`). This CLI is the
 * deterministic SCORER of that single authored verdict — it validates and
 * decides, it never re-scores the criteria as an independent additional
 * pass — turning the verdict into the loop's next action:
 *
 *   1. Validate the verdict file against the verdict JSON Schema (a
 *      malformed verdict is a hard error — the loop refuses to guess).
 *   2. Decide `proceed | redraft | block` from the per-criterion verdicts
 *      and the resolved, undisableable round cap
 *      (`delivery.acceptanceEval.maxRounds`, clamped to `[1, ceiling]`).
 *   3. Emit one per-criterion `acceptance-eval` signal into the retro /
 *      feedback substrate so the retro and `/mandrel-plan` Phase 0 feedback
 *      fetch can see which acceptance items needed rework and the round
 *      count.
 *   4. Print a single JSON envelope and exit:
 *        - `proceed` → exit 0; the workflow flips the Story to `closing`.
 *        - `redraft` → exit 0; the workflow reworks the flagged criteria
 *          and re-runs the critic pass for the next round.
 *        - `block`   → exit non-zero; the workflow transitions the Story
 *          to `agent::blocked`, posts a `friction` comment naming the
 *          unmet criteria, and stops. It never silently proceeds to close.
 *
 * The ticket transition / friction-comment authoring stays the workflow
 * agent's job (via `story-phase.js --phase blocked` + `diagnose-friction.js`)
 * — this CLI is the decision + signal boundary, mirroring how the existing
 * gates separate decision from ticket mutation.
 *
 * One invocation shape: per-Story. The diff is one Story's; round scoping
 * is per Story off the Story's `signals.ndjson`. (v2.0.0 removed the Epic
 * tier along with the per-AC-cluster `--epic <id> --cluster <id>` mode that
 * scored an Epic `## Acceptance Table` against a `main..epic/<id>` diff.)
 *
 * One gate call per round (Story #4951). A round may fan out into N parallel
 * maker-blind cluster critics, but their per-cluster verdicts are merged by
 * the caller into ONE verdict — `criteria[]` in acceptance-array order — and
 * scored here exactly once. Invoking the gate per cluster instead would burn
 * one Story-level round per cluster (distinct fingerprints defeat the replay
 * guard) and race the `signals.ndjson` round ledger. `--expected-criteria`
 * makes that contract enforceable: a partial (single-cluster) verdict is
 * rejected before scoring, so the mistake costs no round.
 *
 * CLI:
 *   --story <id>              Story ID (required).
 *   --verdict <path>          Path to the round's verdict JSON (required).
 *   --expected-criteria <n>   Reject a verdict not covering exactly n criteria.
 *   --no-signal               Suppress the signal emit (tests).
 *
 * Stdout: a single JSON envelope
 *   { storyId, epicId, decision, round, cap, capReached, totalCriteria,
 *     metCount, unmetCriteria[], signalEmitted, replay, verdictFingerprint }
 *   (`epicId` is retained as a always-null field for envelope stability.)
 *
 * Reading is free (Story #4874): re-invoking the gate over a verdict the
 * ledger has already scored replays that round (`replay: true`,
 * `signalEmitted: false`) instead of consuming one, so an unchanged verdict
 * can never escalate from `redraft` to `block` by being looked at twice.
 *
 * @see .agents/scripts/lib/orchestration/acceptance-eval-decision.js
 * @see .agents/schemas/acceptance-eval-verdict.schema.json
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { runAsCli } from './lib/cli-utils.js';
import { getAcceptanceEval, resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';
import { appendSignal } from './lib/observability/signals-writer.js';
import {
  buildAcceptanceEvalSignal,
  computeVerdictFingerprint,
  decideAcceptanceEval,
  resolveAcceptanceEvalRound,
} from './lib/orchestration/acceptance-eval-decision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERDICT_SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  'schemas',
  'acceptance-eval-verdict.schema.json',
);

/**
 * Compile the Ajv2020 validator for the verdict schema.
 *
 * Deliberately **not** memoised in a module-level variable: a module-level
 * cache is reset only on re-import, so it silently defeats the `io` seam below
 * (the second caller's injected reader is never consulted) and makes parallel
 * test isolation impossible — `.agents/rules/test-seams.md` rule 3. The gate
 * compiles the schema once per CLI run, so there is nothing to memoise.
 *
 * @param {string} [schemaPath]
 * @param {{ readFileSync: typeof readFileSync }} [io]
 * @returns {import('ajv').ValidateFunction}
 */
function getVerdictValidator(
  schemaPath = VERDICT_SCHEMA_PATH,
  io = { readFileSync },
) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(io.readFileSync(schemaPath, 'utf8'));
  return ajv.compile(schema);
}

/**
 * Validate a parsed verdict object against the verdict schema. Throws on
 * any violation so the loop never acts on a malformed verdict.
 *
 * Exported for tests.
 *
 * @param {unknown} verdict
 * @param {{ schemaPath?: string, io?: { readFileSync: typeof readFileSync } }} [opts]
 * @returns {object} The validated verdict (same reference).
 */
export function validateVerdict(verdict, opts = {}) {
  const validate = getVerdictValidator(
    opts.schemaPath ?? VERDICT_SCHEMA_PATH,
    opts.io ?? { readFileSync },
  );
  if (!validate(verdict)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    throw new Error(
      `acceptance-eval: verdict failed schema validation: ${detail}`,
    );
  }
  return /** @type {object} */ (verdict);
}

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      story: { type: 'string' },
      verdict: { type: 'string' },
      'expected-criteria': { type: 'string' },
      'no-signal': { type: 'boolean', default: false },
    },
    strict: false,
  });
  const storyId = Number.parseInt(values.story ?? '', 10);
  return {
    storyId: Number.isInteger(storyId) && storyId > 0 ? storyId : null,
    verdictPath: values.verdict ?? null,
    expectedCriteria: values['expected-criteria'] ?? null,
    emitSignal: values['no-signal'] !== true,
  };
}

/**
 * The merge contract, stated once so both the flag error and the coverage
 * error name the same shape the caller has to produce.
 */
const MERGE_CONTRACT =
  'One round = N parallel cluster critics -> ONE merged verdict -> ONE gate call: ' +
  "merge every cluster's records into a single criteria[] in acceptance[] order, " +
  'one per acceptance item, before scoring.';

/**
 * Resolve the optional `--expected-criteria` flag to a positive integer, or
 * `null` when the flag is absent (which preserves the pre-#4951 behaviour
 * exactly — no coverage assertion is made).
 *
 * Exported for tests.
 *
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
export function resolveExpectedCriteria(raw) {
  if (raw === null || raw === undefined) return null;
  // Digits only. `Number.parseInt` stops at the first non-digit, so `4abc`
  // resolved to 4 — a guard whose entire job is to reject a wrong-sized
  // verdict was itself accepting a malformed count, and a typo'd `--expected-
  // criteria` would then wave through a verdict of the wrong length.
  const text = String(raw).trim();
  const expected = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error(
      `acceptance-eval: --expected-criteria must be a positive integer (the Story's acceptance[] count). ${MERGE_CONTRACT}`,
    );
  }
  return expected;
}

/**
 * Reject a verdict that does not cover exactly `expectedCriteria` criteria.
 *
 * Called **before** `runAcceptanceEval`, which is where the round ledger is
 * read and appended — so a partial cluster verdict handed to the gate by
 * mistake costs no round and can never escalate a `redraft` into a `block`.
 *
 * Exported for tests.
 *
 * @param {object} verdict — schema-validated verdict.
 * @param {number|null} expectedCriteria — `null` disables the assertion.
 * @returns {void}
 */
export function assertCriteriaCoverage(verdict, expectedCriteria) {
  if (expectedCriteria === null) return;
  const actual = Array.isArray(verdict?.criteria) ? verdict.criteria.length : 0;
  if (actual === expectedCriteria) return;
  throw new Error(
    `acceptance-eval: verdict covers ${actual} criteria but --expected-criteria is ${expectedCriteria}. ` +
      `${MERGE_CONTRACT} No round was consumed.`,
  );
}

/**
 * Compose the operator-facing envelope and emit the per-criterion signal.
 *
 * Exported for tests so the decision + signal path can be exercised
 * without spawning the CLI.
 *
 * @param {object} args
 * @param {number} args.storyId
 * @param {object} args.verdict — validated verdict object.
 * @param {object} args.config — resolved `.agentrc.json`.
 * @param {boolean} args.emitSignal
 * @param {number} [args.round] — explicit round override (tests). When
 *   absent, the round is derived by counting prior `acceptance-eval`
 *   signals in the Story's `signals.ndjson` (Story #4019); the verdict's
 *   self-reported `round` is never load-bearing for the cap.
 * @param {object} [deps]
 * @param {Function} [deps.appendSignalFn]
 * @param {Function} [deps.resolveRoundFn]
 * @param {Function} [deps.fingerprintFn]
 * @returns {Promise<{ envelope: object, exitCode: number }>}
 */
export async function runAcceptanceEval(
  { storyId, verdict, config, emitSignal, round },
  deps = {},
) {
  const {
    appendSignalFn = appendSignal,
    resolveRoundFn = resolveAcceptanceEvalRound,
    fingerprintFn = computeVerdictFingerprint,
  } = deps;
  const { maxRounds } = getAcceptanceEval(config);
  const verdictFingerprint = fingerprintFn(verdict);
  // Story #4874: re-reading an already-scored verdict is a replay — it
  // reports the round that verdict was scored under and appends nothing, so
  // observation alone can never advance the counter or escalate a redraft.
  const resolved = resolveRoundFn({
    epicId: null,
    storyId,
    config,
    verdictFingerprint,
  });
  const replay = resolved.replay === true;
  const resolvedRound =
    Number.isInteger(round) && round >= 1 ? round : resolved.round;
  const outcome = decideAcceptanceEval({
    verdict,
    maxRounds,
    round: resolvedRound,
  });

  let signalEmitted = false;
  if (emitSignal && !replay) {
    const signal = {
      ...buildAcceptanceEvalSignal({
        storyId,
        epicId: null,
        outcome,
        verdictFingerprint,
      }),
      ts: new Date().toISOString(),
    };
    try {
      signalEmitted = await appendSignalFn({
        epicId: null,
        storyId,
        signal,
        config,
      });
    } catch (err) {
      // Observability is best-effort — a failed signal write must never
      // take down the gate. The decision still stands.
      Logger.warn(
        `acceptance-eval: failed to append signal: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const envelope = {
    storyId: storyId ?? null,
    epicId: null,
    decision: outcome.decision,
    round: outcome.round,
    cap: outcome.cap,
    capReached: outcome.capReached,
    totalCriteria: outcome.totalCriteria,
    metCount: outcome.metCount,
    unmetCriteria: outcome.notMet.map((c) => ({
      index: c.index,
      criterion: c.criterion,
      verdict: c.verdict,
      evidence: c.evidence,
    })),
    signalEmitted,
    // True when this invocation re-read a verdict the ledger had already
    // scored: the round was replayed, not advanced, and nothing was appended.
    replay,
    verdictFingerprint,
  };

  // `block` is the only non-zero exit: the loop has exhausted its bounded
  // budget with criteria still unmet, and the workflow must escalate to
  // `agent::blocked` rather than proceed to close.
  const exitCode = outcome.decision === 'block' ? 1 : 0;
  return { envelope, exitCode };
}

/**
 * The gate's CLI core: argv → verdict read → schema validation → decision →
 * envelope. Extracted from the `main` shell so the whole error table (missing
 * flags, unreadable verdict, non-JSON verdict, storyId mismatch, block) is
 * reachable without spawning the CLI or writing a real verdict file.
 *
 * Every seam on the optional final `deps` parameter defaults to the real
 * implementation (`.agents/rules/test-seams.md` rules 1-2, 4), so `main` and
 * every production invocation are unchanged.
 *
 * @param {string[]} [argv]
 * @param {{
 *   readFileSyncImpl?: typeof readFileSync,
 *   resolveConfigImpl?: typeof resolveConfig,
 *   validateVerdictImpl?: typeof validateVerdict,
 *   runAcceptanceEvalImpl?: typeof runAcceptanceEval,
 *   logger?: { info: Function },
 * }} [deps]
 * @returns {Promise<object>} the emitted envelope.
 */
export async function runAcceptanceEvalCli(
  argv = process.argv.slice(2),
  deps = {},
) {
  const {
    readFileSyncImpl = readFileSync,
    resolveConfigImpl = resolveConfig,
    validateVerdictImpl = validateVerdict,
    runAcceptanceEvalImpl = runAcceptanceEval,
    logger = Logger,
  } = deps;
  const { storyId, verdictPath, expectedCriteria, emitSignal } =
    parseCliArgs(argv);
  const expected = resolveExpectedCriteria(expectedCriteria);

  if (!storyId) {
    throw new Error(
      'Usage: node acceptance-eval.js --story <id> --verdict <path> [--expected-criteria <n>] [--no-signal]',
    );
  }
  if (!verdictPath) {
    throw new Error('acceptance-eval: --verdict <path> is required.');
  }

  let raw;
  try {
    raw = readFileSyncImpl(path.resolve(verdictPath), 'utf8');
  } catch (err) {
    throw new Error(
      `acceptance-eval: cannot read verdict file at ${verdictPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `acceptance-eval: verdict file is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const verdict = validateVerdictImpl(parsed);

  // Story #4951: a merged verdict must cover every acceptance[] item. This
  // runs before the round ledger is touched, so a partial cluster verdict is
  // a free mistake.
  assertCriteriaCoverage(verdict, expected);

  // A verdict whose embedded storyId disagrees with the CLI flag is a
  // wiring error worth failing on, not a silent mismatch.
  if (Number.isInteger(verdict.storyId) && verdict.storyId !== storyId) {
    throw new Error(
      `acceptance-eval: verdict storyId (${verdict.storyId}) does not match --story ${storyId}.`,
    );
  }

  const config = resolveConfigImpl();
  const { envelope, exitCode } = await runAcceptanceEvalImpl({
    storyId,
    verdict,
    config,
    emitSignal,
  });

  logger.info(JSON.stringify(envelope));

  if (exitCode !== 0) {
    const names = envelope.unmetCriteria
      .map((c) => `#${c.index} (${c.verdict})`)
      .join(', ');
    throw new Error(
      `acceptance-eval: round cap (${envelope.cap}) reached with criteria still unmet: ${names}. ` +
        'Transition the Story to agent::blocked and post a friction comment.',
    );
  }

  return envelope;
}

/**
 * @param {string[]} [argv]
 * @returns {Promise<object>}
 */
export async function main(argv = process.argv.slice(2)) {
  return runAcceptanceEvalCli(argv);
}

runAsCli(import.meta.url, main, {
  source: 'acceptance-eval',
  usage: {
    invocation:
      'node .agents/scripts/acceptance-eval.js --story <id> --verdict <path> [--expected-criteria <n>] [--no-signal]',
    summary:
      "Score an authored acceptance verdict against the Story's acceptance[] criteria and emit the bounded loop's proceed / redraft / block decision.",
    flags: [
      ['--story <id>', 'GitHub issue number of the Story (required).'],
      ['--verdict <path>', 'Path to the authored verdict JSON (required).'],
      [
        '--expected-criteria <n>',
        'Reject — before scoring, consuming no round — a verdict whose criteria[] ' +
          "length is not n. Pass the Story's acceptance[] count so a partial " +
          'cluster verdict cannot be scored as the round.',
      ],
      [
        '--no-signal',
        "Skip appending the per-criterion signal to the Story's signals ledger.",
      ],
    ],
    notes: ['Exit codes:\n  0  proceed or redraft\n  1  block'],
  },
});
