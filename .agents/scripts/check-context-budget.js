/**
 * CLI: ratchet-down gate for the always-loaded documentation context budget
 * (Story #4438, Epic #4430 — Context Economy).
 *
 * Follows the standalone `check-arch-cycles.js` / `check-dead-exports.js`
 * precedent — a pure-Node, baseline-aware, sub-second checker wired into the
 * CI `baselines` job — rather than a `baselines/kinds/` metric. It measures the
 * live byte total of two documentation read-tiers and compares each against a
 * single committed budget in `baselines/context-budget.json`:
 *
 *   - `alwaysLoaded`  — the `CLAUDE.md` `@`-import closure re-paid on every
 *                       session and every subagent spawn (instructions.md § 4).
 *   - `mandatoryRead` — the resolved `project.docsContextFiles` set.
 *   - `workflow`      — the workflow **mandatory closure** (Story #4752): every
 *                       `.agents/workflows/**` entry point plus the transitive
 *                       closure of its `mandatoryReads:` frontmatter edges. The
 *                       companion **reachable** closure (per entry point) is
 *                       recorded under the top-level `workflowClosure` key as a
 *                       drift signal and never gates — growth there is a
 *                       reading-cost signal, not a contract violation.
 *
 * It additionally enforces a **per-file** ceiling on the role-scoped agent-boot
 * tier (`.agents/agents/*.md`, #4478): no single boot context may exceed
 * `agentBoot.ceilingBytes` (default 8192). This is a per-agent cap, not a sum
 * ratchet — each role def is a standalone system prompt a converted spawn boots
 * on, and adding another role def is legitimate.
 *
 * The recorded `agentBoot` rows are additionally held **in sync with the tree**
 * (Story #4830), because those rows are what an author sizes an edit against.
 * The two drift directions are deliberately asymmetric:
 *
 *   - **permissive** (the row understates the file, or no row exists) — the row
 *     promises headroom that does not exist, the gate stays green, and the
 *     shortfall only lands as a ceiling failure once the edit is written. This
 *     fails the gate.
 *   - **restrictive** (the row overstates the file) — an author under-spends
 *     and the ceiling is never surprised, so it is self-correcting. Reported as
 *     a `-` line; exit stays 0.
 *
 * Each row also records its `headroomBytes` under the ceiling, so the budget an
 * author reads is stated rather than re-derived.
 *
 * A read-tier that resolves **empty** is skipped silently (the `docsContextFiles`
 * half skips when unconfigured / its files are absent), so a repo with no
 * `CLAUDE.md` and no context docs is a clean no-op.
 *
 * Ratchet semantics (mirroring the sibling ratchets):
 *   - A gated tier grows beyond `baseline.tiers.<tier>.totalBytes +
 *     baseline.toleranceBytes` → exit 1, naming the tier and its delta.
 *   - A gated tier shrinks below its baseline total → printed as a `-`
 *     (removal) note, warning the baseline can be refreshed downward.
 *     Shrink-only exits 0.
 *   - Within tolerance / clean → exit 0.
 *   - Baseline file absent → warn + exit 0 (no-op; nothing to ratchet against).
 *
 * Tolerance lives in the baseline JSON (`toleranceBytes`) — there is **no**
 * `.agentrc.json` config key; this is a framework-internal dogfooding ratchet,
 * like arch-cycles.
 *
 * Flags:
 *   --baseline <path>  override the budget path (default
 *                      `baselines/context-budget.json`, resolved from cwd).
 *   --root <path>      resolve tiers against an explicit repo root (default cwd).
 *   --update           reseed the baseline from the current measurement (keeps
 *                      the existing `toleranceBytes`, or defaults it) and exit 0.
 *   --json             write the structured envelope to stdout.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runAsCli } from './lib/cli-utils.js';
import { resolveConfig } from './lib/config-resolver.js';
import { resolveDocTiers, tierTotalBytes } from './lib/doc-tiers.js';

/**
 * The tiers this ratchet gates (in report order). `digestVisible`, `onDemand`
 * and `workflowOnDemand` are resolved by the tier map for the lens, but the
 * byte budget intentionally gates only the tiers a session is *forced* to read.
 * @type {Array<'alwaysLoaded' | 'mandatoryRead' | 'workflow'>}
 */
export const GATED_TIERS = ['alwaysLoaded', 'mandatoryRead', 'workflow'];

/**
 * Default tolerance (bytes) seeded into a fresh baseline by `--update` when the
 * existing baseline carries none.
 * @type {number}
 */
export const DEFAULT_TOLERANCE_BYTES = 2048;

/**
 * Per-file ceiling (bytes) for the role-scoped agent-boot tier (#4478). Unlike
 * the read-tiers (gated by a total-byte ratchet), each `.agents/agents/*.md`
 * boot context is a **standalone** system prompt a converted spawn boots on, so
 * the meaningful budget is per-agent, not the sum: no single role def may
 * exceed this ceiling. Adding another role def is legitimate — a per-file gate
 * (rather than a sum ratchet) does not false-positive on that.
 * @type {number}
 */
export const AGENT_BOOT_CEILING_BYTES = 8192;

/**
 * Return the agent-boot files that exceed the per-file ceiling.
 *
 * @param {{ tiers: Record<string, Array<{ path: string, bytes: number }>> }} tierMap
 * @param {number} ceiling
 * @returns {Array<{ path: string, bytes: number, ceiling: number }>}
 */
export function agentBootOverflow(tierMap, ceiling = AGENT_BOOT_CEILING_BYTES) {
  const files = tierMap?.tiers?.agentBoot ?? [];
  return files
    .filter((f) => Number.isFinite(f?.bytes) && f.bytes > ceiling)
    .map((f) => ({ path: f.path, bytes: f.bytes, ceiling }));
}

/**
 * Classify one agent-boot file against its recorded baseline row (#4830).
 * Returns `null` when the row already agrees with the tree.
 *
 * `permissive` drift is the failure class this gate exists for: the row
 * understates the file (or is missing entirely), so the headroom an author
 * computes from it is larger than the headroom that exists, and the shortfall
 * only surfaces as a ceiling failure *after* the edit is written.
 * `restrictive` drift is the benign mirror — the row overstates the file, so an
 * author under-spends and the ceiling gate is never surprised.
 *
 * @param {{ path: string, bytes: number }} file live file measurement
 * @param {{ bytes?: number, headroomBytes?: number } | undefined} row recorded row
 * @param {number} ceiling
 * @returns {{ path: string, recorded: number|null, actual: number, delta: number,
 *   direction: 'permissive'|'restrictive', recordedHeadroom: number|null,
 *   headroomBytes: number } | null}
 */
function classifyBootRow(file, row, ceiling) {
  const actual = file.bytes;
  const headroomBytes = ceiling - actual;
  const recorded = Number.isFinite(row?.bytes) ? row.bytes : null;
  const recordedHeadroom = Number.isFinite(row?.headroomBytes)
    ? row.headroomBytes
    : recorded === null
      ? null
      : ceiling - recorded;
  // A row is in sync only when both the byte count and the headroom it
  // advertises match the tree — a stale headroom misleads on its own.
  if (recorded === actual && recordedHeadroom === headroomBytes) return null;
  const permissive =
    recorded === null ||
    recorded < actual ||
    (recordedHeadroom !== null && recordedHeadroom > headroomBytes);
  return {
    path: file.path,
    recorded,
    actual,
    delta: recorded === null ? actual : actual - recorded,
    direction: permissive ? 'permissive' : 'restrictive',
    recordedHeadroom,
    headroomBytes,
  };
}

/**
 * Compare every recorded `agentBoot` row against the tree it describes.
 *
 * @param {{ tiers: Record<string, Array<{ path: string, bytes: number }>> }} tierMap
 * @param {{ agentBoot?: { ceilingBytes?: number, files?: Array<{ path: string, bytes: number, headroomBytes?: number }> } } | null} baseline
 * @param {number} [ceiling]
 * @returns {Array<ReturnType<typeof classifyBootRow>>} drift rows (empty = in sync)
 */
export function agentBootDrift(tierMap, baseline, ceiling) {
  const recordedCeiling = Number.isFinite(baseline?.agentBoot?.ceilingBytes)
    ? baseline.agentBoot.ceilingBytes
    : AGENT_BOOT_CEILING_BYTES;
  const effective = Number.isFinite(ceiling) ? ceiling : recordedCeiling;
  const rows = new Map(
    (baseline?.agentBoot?.files ?? []).map((f) => [f.path, f]),
  );
  const drift = [];
  for (const file of tierMap?.tiers?.agentBoot ?? []) {
    if (!Number.isFinite(file?.bytes)) continue;
    const row = classifyBootRow(file, rows.get(file.path), effective);
    if (row) drift.push(row);
  }
  return drift;
}

/**
 * Render the agent-boot drift lines. `+` lines are permissive drift (gate
 * fail); `-` lines are restrictive drift (informational). Each line states the
 * **real** remaining headroom, so the author sizing the next edit reads the
 * true number rather than re-deriving it from a row that just proved stale.
 *
 * @param {Array<ReturnType<typeof classifyBootRow>>} drift
 * @returns {string[]}
 */
export function renderBootDrift(drift) {
  return drift.map((d) => {
    const marker = d.direction === 'permissive' ? '+' : '-';
    const recorded =
      d.recorded === null
        ? 'has no recorded row'
        : `records ${d.recorded} bytes but the file is ${d.actual}`;
    const note =
      d.direction === 'permissive'
        ? 'the row overstates the headroom an author would size an edit against'
        : 'the row is conservative — refresh at leisure';
    return `${marker} agentBoot drift: ${d.path} ${recorded} — ${note} (real headroom ${d.headroomBytes})`;
  });
}

/**
 * Parse argv for `--baseline <path>`, `--root <path>`, `--update`, `--json`.
 * Exported so unit tests can pin the parser.
 *
 * @param {string[]} argv
 * @returns {{ baselinePath: string|null, rootPath: string|null, update: boolean, json: boolean }}
 */
export function parseArgv(argv = []) {
  let baselinePath = null;
  let rootPath = null;
  let update = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--baseline') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        baselinePath = next;
        i += 1;
      }
    } else if (a === '--root') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        rootPath = next;
        i += 1;
      }
    } else if (a === '--update') {
      update = true;
    } else if (a === '--json') {
      json = true;
    }
  }
  return { baselinePath, rootPath, update, json };
}

/**
 * Read the committed budget envelope from disk. Returns the parsed object or
 * `null` when the file is missing or unparseable.
 *
 * @param {string} baselinePath
 * @returns {{ toleranceBytes?: number, tiers?: Record<string, { totalBytes: number, files?: Array<{ path: string, bytes: number }> }> } | null}
 */
export function loadBaseline(baselinePath) {
  try {
    if (!fs.existsSync(baselinePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the committed-baseline envelope from a resolved tier map. Only the
 * gated tiers are recorded (each as `{ totalBytes, files }`).
 *
 * @param {{ tiers: Record<string, Array<{ path: string, bytes: number }>> }} tierMap
 * @param {number} toleranceBytes
 * @returns {object}
 */
export function buildBaseline(tierMap, toleranceBytes) {
  const tiers = {};
  for (const name of GATED_TIERS) {
    const files = tierMap.tiers[name] ?? [];
    tiers[name] = { totalBytes: tierTotalBytes(files), files };
  }
  // The agent-boot tier is recorded top-level (not under `tiers`) because it is
  // gated by a per-file ceiling, not the total-byte ratchet the `tiers` entries
  // use — keeping it out of `tiers` keeps the ratchet diff loop unambiguous.
  // Each row carries the headroom it leaves under the ceiling, so an author
  // sizing an edit reads the remaining budget straight off the row (#4830)
  // instead of re-deriving it — and `agentBootDrift` keeps both numbers honest.
  const agentBootFiles = (tierMap.tiers.agentBoot ?? []).map((f) => ({
    path: f.path,
    bytes: f.bytes,
    headroomBytes: AGENT_BOOT_CEILING_BYTES - f.bytes,
  }));
  return {
    $schema: 'https://mandrel.dev/baselines/context-budget.schema.json',
    generatedAt: new Date().toISOString(),
    toleranceBytes,
    tiers,
    agentBoot: {
      ceilingBytes: AGENT_BOOT_CEILING_BYTES,
      files: agentBootFiles,
    },
    // Recorded, never gated (#4752): the total reachable closure per workflow
    // entry point. It is a drift signal — the gate is `tiers.workflow`.
    workflowClosure: {
      reachableTotalBytes: tierMap.workflowClosure?.reachableTotalBytes ?? 0,
      entryPoints: tierMap.workflowClosure?.entryPoints ?? [],
    },
  };
}

/**
 * Pure diff: compare the current tier map against the committed baseline. A
 * gated tier with no current files is skipped; a tier absent from the baseline
 * is skipped. `grown` entries fail the gate; `shrunk` entries are informational.
 *
 * @param {{ tiers: Record<string, Array<{ path: string, bytes: number }>> }} tierMap
 * @param {{ toleranceBytes?: number, tiers?: Record<string, { totalBytes: number }> }} baseline
 * @returns {{
 *   grown: Array<{ tier: string, current: number, baseline: number, tolerance: number, delta: number }>,
 *   shrunk: Array<{ tier: string, current: number, baseline: number }>,
 *   skipped: string[],
 * }}
 */
export function diffBudget(tierMap, baseline) {
  const tolerance = Number.isFinite(baseline?.toleranceBytes)
    ? baseline.toleranceBytes
    : 0;
  const grown = [];
  const shrunk = [];
  const skipped = [];
  for (const tier of GATED_TIERS) {
    const files = tierMap.tiers[tier] ?? [];
    const current = tierTotalBytes(files);
    const baseTier = baseline?.tiers?.[tier];
    if (
      files.length === 0 ||
      !baseTier ||
      !Number.isFinite(baseTier.totalBytes)
    ) {
      skipped.push(tier);
      continue;
    }
    const baselineBytes = baseTier.totalBytes;
    if (current > baselineBytes + tolerance) {
      grown.push({
        tier,
        current,
        baseline: baselineBytes,
        tolerance,
        delta: current - baselineBytes,
      });
    } else if (current < baselineBytes) {
      shrunk.push({ tier, current, baseline: baselineBytes });
    }
  }
  return { grown, shrunk, skipped };
}

/**
 * Render the human-readable diff. `+` lines are tiers that grew beyond
 * tolerance (gate fail); `-` lines are tiers that shrank (refreshable
 * baseline). A one-line summary always follows.
 *
 * @param {ReturnType<typeof diffBudget>} diff
 * @returns {string}
 */
export function renderDiff(diff) {
  const lines = [];
  for (const g of diff.grown) {
    lines.push(
      `+ ${g.tier}: ${g.current} bytes exceeds budget ${g.baseline} + tolerance ${g.tolerance} (delta +${g.delta})`,
    );
  }
  for (const s of diff.shrunk) {
    lines.push(
      `- ${s.tier}: ${s.current} bytes below baseline ${s.baseline} — refresh baselines/context-budget.json`,
    );
  }
  const tag = diff.grown.length > 0 ? '(gate fail)' : '(ok)';
  lines.push(
    `[context-budget] grown=${diff.grown.length} shrunk=${diff.shrunk.length} skipped=${diff.skipped.length} ${tag}`,
  );
  return lines.join('\n');
}

/**
 * Render the workflow **reachable** closure line — recorded, never gated
 * (Story #4752). Returns `''` when there is no workflow tier to report, so the
 * caller can stay a one-liner.
 *
 * @param {{ workflowClosure?: { reachableTotalBytes?: number, entryPoints?: unknown[] } }} tierMap
 * @param {{ workflowClosure?: { reachableTotalBytes?: number } } | null} [baseline]
 * @returns {string}
 */
export function renderReachable(tierMap, baseline) {
  const closure = tierMap?.workflowClosure;
  const current = closure?.reachableTotalBytes ?? 0;
  if (current <= 0) return '';
  const recorded = baseline?.workflowClosure?.reachableTotalBytes;
  const against = Number.isFinite(recorded) ? ` (recorded ${recorded})` : '';
  const entries = closure.entryPoints?.length ?? 0;
  return `  workflow reachable closure: ${current} bytes across ${entries} entry points${against} — drift signal, never gated`;
}

/**
 * Top-level CLI entry. Exported so tests can drive the full pipeline against a
 * tmpdir fixture with an injected config and sinks.
 *
 * @param {{
 *   argv?: string[],
 *   cwd?: string,
 *   config?: object,
 *   stdout?: { write: (s: string) => void },
 *   stderr?: { write: (s: string) => void },
 * }} [opts]
 * @returns {Promise<number>} 0 = clean / within tolerance / shrink-only / no-op;
 *   1 = a gated tier grew beyond tolerance
 */
export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  config,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const { baselinePath, rootPath, update, json } = parseArgv(argv);
  const root = rootPath ? path.resolve(cwd, rootPath) : path.resolve(cwd);
  const resolvedBaselinePath = path.resolve(
    cwd,
    baselinePath ?? path.join('baselines', 'context-budget.json'),
  );
  const resolvedConfig = config ?? resolveConfig();
  const tierMap = resolveDocTiers(resolvedConfig, { root });

  if (update) {
    const existing = loadBaseline(resolvedBaselinePath);
    const tolerance = Number.isFinite(existing?.toleranceBytes)
      ? existing.toleranceBytes
      : DEFAULT_TOLERANCE_BYTES;
    const envelope = buildBaseline(tierMap, tolerance);
    fs.mkdirSync(path.dirname(resolvedBaselinePath), { recursive: true });
    fs.writeFileSync(
      resolvedBaselinePath,
      `${JSON.stringify(envelope, null, 2)}\n`,
    );
    if (!json) {
      stdout.write(
        `[context-budget] wrote baseline ${resolvedBaselinePath} (tolerance ${tolerance} bytes)\n`,
      );
    } else {
      stdout.write(
        `${JSON.stringify({ kind: 'context-budget-update', baselinePath: resolvedBaselinePath, envelope }, null, 2)}\n`,
      );
    }
    return 0;
  }

  const baseline = loadBaseline(resolvedBaselinePath);
  if (!baseline) {
    if (json) {
      stdout.write(
        `${JSON.stringify({ kind: 'context-budget-report', baselinePath: resolvedBaselinePath, tiers: tierMap.tiers, grown: [], shrunk: [], skipped: GATED_TIERS, exitCode: 0, noBaseline: true }, null, 2)}\n`,
      );
    } else {
      stderr.write(
        `[context-budget] ⚠ budget not found at ${resolvedBaselinePath} — skipping (no-op)\n`,
      );
    }
    return 0;
  }

  const diff = diffBudget(tierMap, baseline);
  const ceiling = Number.isFinite(baseline?.agentBoot?.ceilingBytes)
    ? baseline.agentBoot.ceilingBytes
    : AGENT_BOOT_CEILING_BYTES;
  const bootOverflow = agentBootOverflow(tierMap, ceiling);
  const bootDrift = agentBootDrift(tierMap, baseline, ceiling);
  const permissiveDrift = bootDrift.filter((d) => d.direction === 'permissive');
  const exitCode =
    diff.grown.length > 0 ||
    bootOverflow.length > 0 ||
    permissiveDrift.length > 0
      ? 1
      : 0;

  if (json) {
    const envelope = {
      kind: 'context-budget-report',
      baselinePath: resolvedBaselinePath,
      toleranceBytes: Number.isFinite(baseline.toleranceBytes)
        ? baseline.toleranceBytes
        : 0,
      current: Object.fromEntries(
        GATED_TIERS.map((t) => [t, tierTotalBytes(tierMap.tiers[t] ?? [])]),
      ),
      grown: diff.grown,
      shrunk: diff.shrunk,
      skipped: diff.skipped,
      agentBootCeilingBytes: ceiling,
      agentBootOverflow: bootOverflow,
      agentBootDrift: bootDrift,
      workflowReachableBytes: tierMap.workflowClosure?.reachableTotalBytes ?? 0,
      exitCode,
    };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    stdout.write(`\n--- context-budget preview ---\n`);
    stdout.write(`${renderDiff(diff)}\n`);
    const reachable = renderReachable(tierMap, baseline);
    if (reachable) stdout.write(`${reachable}\n`);
    for (const o of bootOverflow) {
      stdout.write(
        `+ agentBoot: ${o.path} is ${o.bytes} bytes, over the ${o.ceiling}-byte per-agent ceiling\n`,
      );
    }
    for (const line of renderBootDrift(bootDrift)) {
      stdout.write(`${line}\n`);
    }
    if (exitCode === 1) {
      if (permissiveDrift.length > 0) {
        stderr.write(
          `[context-budget] ❌ a recorded agentBoot row understates the file it describes, so it overstates the headroom an author would size an edit against — refresh it with \`node .agents/scripts/check-context-budget.js --update\` (the ceiling is unchanged)\n`,
        );
      }
      if (bootOverflow.length > 0) {
        stderr.write(
          `[context-budget] ❌ a role-agent boot context exceeds the ${ceiling}-byte per-agent ceiling — trim the role def (the ceiling is a hard cap, not a starve target)\n`,
        );
      }
      if (diff.grown.length > 0) {
        stderr.write(
          `[context-budget] ❌ a documentation tier grew beyond tolerance — refresh the budget consciously with \`node .agents/scripts/check-context-budget.js --update\` once the growth is intentional\n`,
        );
      }
    }
  }

  return exitCode;
}

async function main() {
  return runCli();
}

runAsCli(import.meta.url, main, {
  source: 'context-budget',
  propagateExitCode: true,
  errorPrefix: '[context-budget] ❌ Fatal error',
});
