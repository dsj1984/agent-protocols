import path from 'node:path';
import { resolveConfig } from './lib/config-resolver.js';
import { loadCoverage } from './lib/coverage-utils.js';
import {
  getCrapBaseline,
  KERNEL_VERSION,
  resolveEscomplexVersion,
  scanAndScore,
} from './lib/crap-utils.js';
import { createFrictionEmitter } from './lib/orchestration/friction-emitter.js';
import { createProvider } from './lib/provider-factory.js';

/**
 * CLI: verify CRAP scores against the committed baseline.
 *
 * Hybrid enforcement — tracked methods must not regress beyond `tolerance`;
 * new (untracked) methods must stay at or below `newMethodCeiling`. Removed
 * baseline rows are surfaced (not suppressed, not a failure) so a deletion is
 * visible at review time.
 *
 * Contract:
 *   - `settings.maintainability.crap.enabled === false` → skip, exit 0.
 *   - Missing baseline → bootstrap message, exit 0 (never hard-fails a
 *     consumer repo on first sync).
 *   - Baseline `kernelVersion` or `escomplexVersion` mismatch vs. the running
 *     scorer → fail closed, exit 1 with a message pointing at
 *     `npm run crap:update`.
 *   - Otherwise: exit 1 if any regression or new-method ceiling violation,
 *     else exit 0.
 *
 * `--story <id>` (or the `FRICTION_STORY_ID` env) mirrors
 * `check-maintainability.js` — on failure we upsert a rate-limited friction
 * structured comment on the named Story naming every violating method.
 */

function parseCliArgs(argv = process.argv.slice(2)) {
  const out = { storyId: null, baselinePath: undefined, coveragePath: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--story' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0) out.storyId = parsed;
      i += 1;
    } else if (argv[i] === '--baseline' && argv[i + 1]) {
      out.baselinePath = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--coverage' && argv[i + 1]) {
      out.coveragePath = argv[i + 1];
      i += 1;
    }
  }
  if (out.storyId === null) {
    const envVal = Number(process.env.FRICTION_STORY_ID);
    if (Number.isInteger(envVal) && envVal > 0) out.storyId = envVal;
  }
  return out;
}

/**
 * Pure comparator. Given scanned `currentRows` and committed `baselineRows`,
 * produce a structured verdict covering all four match paths:
 *
 *   1. **exact**     — same (file, method, startLine). Regresses if current
 *                      crap > baseline crap + tolerance.
 *   2. **drifted**   — same (file, method) but startLine shifted. Uses the
 *                      closest line-drifted baseline row; regresses under the
 *                      same no-regression rule. A drift without regression is
 *                      reported informationally in `drifted`.
 *   3. **new**       — no baseline match. Violates if crap > newMethodCeiling.
 *   4. **removed**   — baseline rows not seen in the current scan. Surfaced
 *                      only; never a failure.
 *
 * @param {{
 *   currentRows: Array<{file: string, method: string, startLine: number, cyclomatic: number, coverage: number, crap: number}>,
 *   baselineRows: Array<{file: string, method: string, startLine: number, crap: number}>,
 *   newMethodCeiling: number,
 *   tolerance: number,
 * }} params
 * @returns {{
 *   total: number,
 *   regressions: number,
 *   newViolations: number,
 *   drifted: number,
 *   removed: number,
 *   violations: Array<object>,
 *   removedRows: Array<object>,
 * }}
 */
export function compareCrap({
  currentRows,
  baselineRows,
  newMethodCeiling,
  tolerance,
}) {
  const exactIndex = new Map();
  const methodIndex = new Map();
  for (const b of baselineRows ?? []) {
    exactIndex.set(`${b.file}::${b.method}@${b.startLine}`, b);
    const mk = `${b.file}::${b.method}`;
    if (!methodIndex.has(mk)) methodIndex.set(mk, []);
    methodIndex.get(mk).push(b);
  }
  const seenBaselineKeys = new Set();

  const violations = [];
  let regressions = 0;
  let newViolations = 0;
  let drifted = 0;

  for (const row of currentRows ?? []) {
    const exactKey = `${row.file}::${row.method}@${row.startLine}`;
    const methodKey = `${row.file}::${row.method}`;
    const exact = exactIndex.get(exactKey);
    if (exact) {
      seenBaselineKeys.add(exactKey);
      if (row.crap > exact.crap + tolerance) {
        regressions += 1;
        violations.push({
          ...row,
          kind: 'regression',
          baseline: exact.crap,
          baselineStartLine: exact.startLine,
        });
      }
      continue;
    }

    const candidates = methodIndex.get(methodKey);
    if (Array.isArray(candidates) && candidates.length > 0) {
      // Pick the closest un-seen candidate by startLine distance; fall back to
      // the first one if all have been seen (duplicate method names).
      let pick = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const c of candidates) {
        const k = `${c.file}::${c.method}@${c.startLine}`;
        if (seenBaselineKeys.has(k)) continue;
        const d = Math.abs(c.startLine - row.startLine);
        if (d < bestDist) {
          bestDist = d;
          pick = c;
        }
      }
      if (!pick) pick = candidates[0];
      seenBaselineKeys.add(`${pick.file}::${pick.method}@${pick.startLine}`);
      drifted += 1;
      if (row.crap > pick.crap + tolerance) {
        regressions += 1;
        violations.push({
          ...row,
          kind: 'drifted-regression',
          baseline: pick.crap,
          baselineStartLine: pick.startLine,
        });
      }
      continue;
    }

    if (row.crap > newMethodCeiling + tolerance) {
      newViolations += 1;
      violations.push({
        ...row,
        kind: 'new',
        baseline: null,
        ceiling: newMethodCeiling,
      });
    }
  }

  const removedRows = [];
  for (const b of baselineRows ?? []) {
    const k = `${b.file}::${b.method}@${b.startLine}`;
    if (!seenBaselineKeys.has(k)) removedRows.push(b);
  }

  return {
    total: currentRows?.length ?? 0,
    regressions,
    newViolations,
    drifted,
    removed: removedRows.length,
    violations,
    removedRows,
  };
}

function printSummary(result, scanSummary) {
  console.log('\n--- CRAP Report ---');
  console.log(`Total methods scanned: ${result.total}`);
  console.log(`Regressions:           ${result.regressions}`);
  console.log(`New-method violations: ${result.newViolations}`);
  console.log(`Drifted (matched):     ${result.drifted}`);
  console.log(`Removed from baseline: ${result.removed}`);
  if (scanSummary?.skippedFilesNoCoverage) {
    console.log(
      `Files without coverage:${' '.repeat(1)}${scanSummary.skippedFilesNoCoverage}`,
    );
  }
  console.log('-------------------\n');

  for (const v of result.violations) {
    if (v.kind === 'new') {
      console.error(
        `[CRAP] ❌ NEW-METHOD over ceiling: ${v.file}::${v.method} (line ${v.startLine})`,
      );
      console.error(
        `       crap=${v.crap.toFixed(2)} > ceiling=${v.ceiling} (c=${v.cyclomatic}, cov=${v.coverage.toFixed(2)})`,
      );
    } else {
      console.error(
        `[CRAP] ❌ REGRESSION: ${v.file}::${v.method} (line ${v.startLine}${v.kind === 'drifted-regression' ? `, baseline line ${v.baselineStartLine}` : ''})`,
      );
      console.error(
        `       crap=${v.crap.toFixed(2)} > baseline=${v.baseline.toFixed(2)} (c=${v.cyclomatic}, cov=${v.coverage.toFixed(2)})`,
      );
    }
  }
  if (result.removed > 0) {
    console.log(
      `[CRAP] ℹ ${result.removed} baseline row(s) absent from current scan (deleted or moved):`,
    );
    for (const r of result.removedRows) {
      console.log(`       - ${r.file}::${r.method} (baseline line ${r.startLine})`);
    }
  }
}

async function emitFriction(storyId, result, orchestration) {
  if (!storyId) return;
  const offenders = result.violations;
  if (offenders.length === 0) return;
  const provider = createProvider(orchestration);
  const emitter = createFrictionEmitter({ provider });
  const body = [
    '### 🚧 Friction — CRAP baseline regression',
    '',
    `Story \`#${storyId}\` — \`check-crap\` detected ${offenders.length} violating method(s):`,
    '',
    '| File | Method | Line | CRAP | Baseline / Ceiling | Kind |',
    '|---|---|---|---|---|---|',
    ...offenders.map((v) => {
      const compare =
        v.kind === 'new' ? `ceiling ${v.ceiling}` : v.baseline.toFixed(2);
      return `| \`${v.file}\` | \`${v.method}\` | ${v.startLine} | ${v.crap.toFixed(2)} | ${compare} | ${v.kind} |`;
    }),
    '',
    "Add tests to raise coverage, reduce cyclomatic complexity, or run `npm run crap:update` with a `baseline-refresh:` commit if the drift is justified.",
  ].join('\n');
  try {
    await emitter.emit({
      ticketId: storyId,
      markerKey:
        orchestration?.agentSettings?.maintainability?.crap?.friction
          ?.markerKey ?? 'crap-baseline-regression',
      body,
    });
  } catch (err) {
    console.warn(`[CRAP] friction emit failed: ${err?.message ?? err}`);
  }
}

async function main() {
  const args = parseCliArgs();
  const { settings, ...rest } = resolveConfig();
  const crap = settings.maintainability?.crap ?? {};

  if (crap.enabled === false) {
    console.log('[CRAP] gate skipped (disabled)');
    return 0;
  }

  const baseline = getCrapBaseline({ baselinePath: args.baselinePath });
  if (baseline === null) {
    console.log(
      "[CRAP] no baseline found — run 'npm run crap:update' to bootstrap",
    );
    return 0;
  }

  const runningEscomplex = resolveEscomplexVersion();
  if (baseline.kernelVersion !== KERNEL_VERSION) {
    console.error(
      `[CRAP] scorer changed from ${baseline.kernelVersion} to ${KERNEL_VERSION} — run 'npm run crap:update'`,
    );
    return 1;
  }
  if (baseline.escomplexVersion !== runningEscomplex) {
    console.error(
      `[CRAP] scorer changed from ${baseline.escomplexVersion} to ${runningEscomplex} — run 'npm run crap:update'`,
    );
    return 1;
  }

  const targetDirs =
    Array.isArray(crap.targetDirs) && crap.targetDirs.length
      ? crap.targetDirs
      : ['.agents/scripts'];
  const requireCoverage = crap.requireCoverage !== false;
  const coveragePath =
    args.coveragePath ?? crap.coveragePath ?? 'coverage/coverage-final.json';
  const newMethodCeiling = Number.isFinite(crap.newMethodCeiling)
    ? crap.newMethodCeiling
    : 30;
  const tolerance = Number.isFinite(crap.tolerance) ? crap.tolerance : 0.001;

  const coverage = loadCoverage(path.resolve(process.cwd(), coveragePath));
  const scan = scanAndScore({
    targetDirs,
    coverage,
    requireCoverage,
    cwd: process.cwd(),
  });

  const result = compareCrap({
    currentRows: scan.rows,
    baselineRows: baseline.rows,
    newMethodCeiling,
    tolerance,
  });

  printSummary(result, scan);

  if (result.regressions > 0 || result.newViolations > 0) {
    console.error(
      '[CRAP] ❌ check failed. Reduce complexity or add coverage on the flagged methods, or run `npm run crap:update` with a `baseline-refresh:` commit if justified.',
    );
    if (args.storyId) {
      await emitFriction(args.storyId, result, {
        ...rest,
        agentSettings: settings,
      });
    }
    return 1;
  }

  console.log('[CRAP] ✅ check passed.');
  return 0;
}

// Only run main when invoked directly — keep the module importable from tests.
const isDirect = (() => {
  try {
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const self = new URL(import.meta.url).pathname;
    // Normalize: on Windows URL pathname has a leading slash before the drive.
    const normalizedSelf =
      /^\/[A-Za-z]:/.test(self) ? self.slice(1) : self;
    return path.resolve(normalizedSelf) === invoked;
  } catch {
    return false;
  }
})();

if (isDirect) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error(`[CRAP] ❌ Fatal error: ${err?.stack ?? err?.message ?? err}`);
      process.exit(1);
    });
}
