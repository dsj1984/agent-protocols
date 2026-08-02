/**
 * CLI: ratchet on cyclomatic complexity against
 * `delivery.quality.codingGuardrails.cyclomaticMustFix` (Story #4923).
 *
 * The must-fix ceiling was documented as blocking (`code-quality-guardrails.md`
 * promises "the close-validation chain refuses the merge") while being read by
 * nothing. This is the consumer that makes the promise true. It joins the
 * standalone-ratchet family — `check-arch-cycles.js`, `check-dead-exports.js`,
 * `check-context-budget.js` — which the CI `baselines` job runs as a required
 * check, and it follows their contract exactly:
 *
 *   - Reads the committed breach baseline at `baselines/cyclomatic.json`
 *     (override with `--baseline <path>`).
 *   - Walks the maintainability gate's `targetDirs` / `ignoreGlobs` and scores
 *     every function with the in-repo escomplex kernel — no coverage artifact
 *     required, so the verdict is available on a cold checkout.
 *   - Exit 0 when clean, improved, or shrinking; exit 1 when a file gains an
 *     over-ceiling function or its worst function gets worse.
 *
 * `--update` rewrites the baseline from the current tree. That is the
 * sanctioned motion after a deliberate refactor lands, and the only way the
 * recorded breach count is allowed to rise.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runAsCli } from './lib/cli-utils.js';
import { getQuality, resolveConfig } from './lib/config-resolver.js';
import {
  buildCyclomaticEnvelope,
  DEFAULT_CYCLOMATIC_BASELINE,
  diffCyclomaticRows,
  renderCyclomaticDiff,
  resolveCyclomaticPolicy,
  scanCyclomatic,
} from './lib/cyclomatic-ceiling.js';

/**
 * Parse `--baseline <path>`, `--json`, and `--update`.
 *
 * @param {string[]} argv
 * @returns {{ baselinePath: string | null, json: boolean, update: boolean }}
 */
function parseArgv(argv = []) {
  let baselinePath = null;
  let json = false;
  let update = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--baseline') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        baselinePath = next;
        i += 1;
      }
    } else if (a === '--json') {
      json = true;
    } else if (a === '--update') {
      update = true;
    }
  }
  return { baselinePath, json, update };
}

/**
 * Read a breach baseline envelope from disk. Returns `null` when the file is
 * missing or unparseable — the caller treats that as an empty baseline, which
 * makes the very first run report every existing breach as `added` rather than
 * silently passing.
 *
 * @param {string} baselinePath
 * @returns {{ ceiling?: number, rows?: Array<object> } | null}
 */
function loadCyclomaticBaseline(baselinePath) {
  try {
    if (!fs.existsSync(baselinePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Top-level CLI entry. Exported so tests can drive the whole pipeline through
 * the injected seams below without spawning a process.
 *
 * @param {{
 *   argv?: string[],
 *   cwd?: string,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 *   resolveConfigImpl?: typeof resolveConfig,
 *   scanImpl?: typeof scanCyclomatic,
 *   loadBaselineImpl?: typeof loadCyclomaticBaseline,
 *   writeFileImpl?: (p: string, data: string) => void,
 * }} [opts]
 * @returns {Promise<number>} 0 = clean / improved; 1 = ratchet breached
 */
export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  resolveConfigImpl = resolveConfig,
  scanImpl = scanCyclomatic,
  loadBaselineImpl = loadCyclomaticBaseline,
  writeFileImpl = (p, data) => fs.writeFileSync(p, data),
} = {}) {
  const { baselinePath, json, update } = parseArgv(argv);
  const quality = getQuality(resolveConfigImpl({ cwd }));
  const policy = resolveCyclomaticPolicy(quality);
  const resolvedBaselinePath = path.resolve(
    cwd,
    baselinePath ?? DEFAULT_CYCLOMATIC_BASELINE,
  );

  const scan = scanImpl({
    targetDirs: policy.targetDirs,
    ignoreGlobs: policy.ignoreGlobs,
    ceiling: policy.mustFix,
    cwd,
  });

  if (update) {
    const envelope = buildCyclomaticEnvelope({
      rows: scan.rows,
      ceiling: policy.mustFix,
    });
    writeFileImpl(
      resolvedBaselinePath,
      `${JSON.stringify(envelope, null, 2)}\n`,
    );
    stdout.write(
      `[cyclomatic] wrote ${scan.rows.length} breach row(s) at ceiling c=${policy.mustFix} to ${resolvedBaselinePath}\n`,
    );
    return 0;
  }

  const baseline = loadBaselineImpl(resolvedBaselinePath);
  const baselineRows = Array.isArray(baseline?.rows) ? baseline.rows : [];
  const diff = diffCyclomaticRows(baselineRows, scan.rows);
  const exitCode = diff.added.length + diff.worsened.length > 0 ? 1 : 0;

  if (json) {
    stdout.write(
      `${JSON.stringify(
        {
          kind: 'cyclomatic-report',
          ceiling: policy.mustFix,
          flag: policy.flag,
          baselinePath: resolvedBaselinePath,
          baselineCeiling: baseline?.ceiling ?? null,
          scannedFiles: scan.scannedFiles,
          parseErrors: scan.parseErrors,
          baselineRows,
          currentRows: scan.rows,
          ...diff,
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  if (!baseline) {
    stderr.write(
      `[cyclomatic] ⚠ baseline not found at ${resolvedBaselinePath} — treating as empty\n`,
    );
  } else if (
    typeof baseline.ceiling === 'number' &&
    baseline.ceiling !== policy.mustFix
  ) {
    stderr.write(
      `[cyclomatic] ⚠ baseline was recorded at ceiling c=${baseline.ceiling} but the configured cyclomaticMustFix is c=${policy.mustFix} — re-run with --update\n`,
    );
  }
  stdout.write('\n--- cyclomatic preview ---\n');
  stdout.write(`${renderCyclomaticDiff(diff, policy.mustFix)}\n`);
  return exitCode;
}

async function main() {
  return runCli();
}

runAsCli(import.meta.url, main, {
  source: 'cyclomatic',
  propagateExitCode: true,
  errorPrefix: '[cyclomatic] ❌ Fatal error',
  usage: {
    invocation:
      'node .agents/scripts/check-cyclomatic.js [--baseline <path>] [--update] [--json]',
    summary:
      'Ratchet on cyclomatic complexity: fail when a file gains a function above `delivery.quality.codingGuardrails.cyclomaticMustFix`, or when its worst function gets worse than the recorded baseline.',
    flags: [
      [
        '--baseline <path>',
        'Baseline file (default: baselines/cyclomatic.json).',
      ],
      [
        '--update',
        'Rewrite the baseline from the current tree (the post-refactor motion).',
      ],
      ['--json', 'Emit the comparison envelope as JSON.'],
    ],
    notes: [
      'Exit codes:\n  0  clean, improved, or shrinking\n  1  a new or worsened over-ceiling function',
    ],
  },
});
