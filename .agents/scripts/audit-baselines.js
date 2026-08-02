#!/usr/bin/env node

/**
 * CLI: baseline hotspot engine for the `/audit-baselines` lens (Story #4902).
 *
 * Turns the committed `baselines/` folder into ranked hotspot clusters,
 * gate-surface health signals, trend deltas, and floor-tightening headroom —
 * the deterministic evidence half of a baseline review, so the lens spends
 * its judgment on findings instead of re-deriving the numbers by hand.
 *
 * Read-only by contract: nothing under `baselines/` is written, and no test,
 * coverage, or mutation suite is run. The only file this process creates is
 * the envelope at `--out`.
 *
 * Exit 0 whenever evidence was assembled — findings are evidence, not a gate.
 * A missing git history, absent friction ledger, or unresolvable import graph
 * are reported as degradations and still exit 0. Only an unwritable `--out`
 * (or a missing one) is a failure.
 *
 * Usage:
 *   node .agents/scripts/audit-baselines.js --out temp/audit-baselines/envelope.json
 */

// Fail-fast if the framework's runtime deps are not installed — must be the
// first import so the check runs before any third-party-importing sibling
// module is evaluated (Story #3432).
import './lib/runtime-deps/ensure-installed.js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DEFAULT_HOTSPOT_LIMIT,
  runEngine,
  summarize,
} from './lib/audit-baselines/engine.js';
import { DEFAULT_TOP_N } from './lib/audit-baselines/outliers.js';
import { buildBaselineSchemaAjv } from './lib/baseline-schema-registry.js';
import { defineFlags } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';

const ENVELOPE_SCHEMA_FILE = 'audit-baselines-envelope.schema.json';

const FLAG_SPEC = {
  out: { type: 'string' },
  cwd: { type: 'string' },
  'top-n': { type: 'integer' },
  'hotspot-limit': { type: 'integer' },
  'trend-depth': { type: 'integer' },
};

/**
 * Validate the envelope against its shipped schema through the shared
 * baseline schema registry. Throws with the AJV error list on mismatch —
 * a malformed envelope is an engine bug, not evidence.
 *
 * @param {object} envelope
 * @returns {void}
 */
export function assertEnvelope(envelope) {
  const validate = buildBaselineSchemaAjv().getSchema(ENVELOPE_SCHEMA_FILE);
  if (!validate) {
    throw new Error(
      `[audit-baselines] ${ENVELOPE_SCHEMA_FILE} is not registered in the baseline schema registry`,
    );
  }
  if (validate(envelope)) return;
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
  throw new Error(
    `[audit-baselines] envelope failed schema validation: ${detail}`,
  );
}

/**
 * Assemble the envelope, validate it, write it, and return the stdout
 * summary. Exported so tests drive the whole pipeline without spawning.
 *
 * @param {{ argv?: string[], cwd?: string, stdout?: { write: (s: string) => void } }} [opts]
 * @returns {Promise<number>} exit code
 */
export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
} = {}) {
  const { values } = defineFlags(FLAG_SPEC, argv);
  if (!values.out) {
    throw new Error('[audit-baselines] --out <path> is required');
  }
  const repoRoot = path.resolve(values.cwd ?? cwd);
  const outPath = path.resolve(repoRoot, values.out);

  const envelope = runEngine({
    cwd: repoRoot,
    topN: values.topN ?? DEFAULT_TOP_N,
    hotspotLimit: values.hotspotLimit ?? DEFAULT_HOTSPOT_LIMIT,
    trendDepth: values.trendDepth ?? 5,
  });
  assertEnvelope(envelope);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

  stdout.write(`${JSON.stringify(summarize(envelope, outPath), null, 2)}\n`);
  return 0;
}

runAsCli(import.meta.url, async () => runCli(), {
  source: 'audit-baselines',
  propagateExitCode: true,
  errorPrefix: '[audit-baselines] ❌ Fatal error',
  usage: {
    invocation:
      'node .agents/scripts/audit-baselines.js --out <path> [--cwd <dir>] [--top-n <n>] [--hotspot-limit <n>] [--trend-depth <n>]',
    summary:
      'Read-only baseline hotspot engine: extract bounded per-gate outliers, cluster them per file, rank by severity x churn x import in-degree x friction, and report gate-surface health, trend deltas, and floor headroom.',
    flags: [
      ['--out <path>', 'Write the JSON envelope here (required).'],
      ['--cwd <dir>', 'Repository root to analyse (default: cwd).'],
      [
        '--top-n <n>',
        `Outlier rows extracted per gate (default: ${DEFAULT_TOP_N}).`,
      ],
      [
        '--hotspot-limit <n>',
        `Hotspot clusters emitted (default: ${DEFAULT_HOTSPOT_LIMIT}).`,
      ],
      ['--trend-depth <n>', 'Baseline commits sampled per kind (default: 5).'],
    ],
    notes: [
      'Never writes under baselines/ and never runs a test, coverage, or mutation suite.',
      'Exit codes:\n  0  evidence assembled (including every degraded input)\n  1  the envelope could not be built or written',
    ],
  },
});
