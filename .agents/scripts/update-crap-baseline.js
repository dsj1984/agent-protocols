import path from 'node:path';
import { resolveConfig } from './lib/config-resolver.js';
import { loadCoverage } from './lib/coverage-utils.js';
import {
  buildBaselineEnvelope,
  resolveEscomplexVersion,
  saveCrapBaseline,
  scanAndScore,
} from './lib/crap-utils.js';

/**
 * CLI: scan → score → save the CRAP baseline.
 *
 * Writes `crap-baseline.json` at the repo root (or the path supplied via
 * `--baseline <path>`) with a deterministic, kernel-stamped envelope. Files
 * without coverage entries are skipped (not scored as 0%) when
 * `requireCoverage: true` — their count and names are logged so the operator
 * can tell the difference between "unscorable" and "safe zero".
 *
 * Exits non-zero only when the scanner itself crashes. An empty result (no
 * coverage at all, no scored methods) still writes an envelope with `rows: []`
 * so downstream `check-crap` can tell "intentional empty baseline" apart from
 * "no baseline yet".
 */

function parseCliArgs(argv = process.argv.slice(2)) {
  const out = { baselinePath: undefined, coveragePath: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--baseline' && argv[i + 1]) {
      out.baselinePath = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--coverage' && argv[i + 1]) {
      out.coveragePath = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseCliArgs();
  const { settings } = resolveConfig();
  const crap = settings.maintainability?.crap ?? {};
  const targetDirs =
    Array.isArray(crap.targetDirs) && crap.targetDirs.length
      ? crap.targetDirs
      : ['.agents/scripts'];
  const requireCoverage = crap.requireCoverage !== false;
  const coveragePath =
    args.coveragePath ?? crap.coveragePath ?? 'coverage/coverage-final.json';

  console.log('[CRAP] Updating baseline...');
  console.log(`[CRAP] Target dirs: ${targetDirs.join(', ')}`);
  console.log(
    `[CRAP] Coverage source: ${coveragePath}${requireCoverage ? ' (required)' : ' (optional)'}`,
  );

  const coverage = loadCoverage(path.resolve(process.cwd(), coveragePath));
  if (!coverage && requireCoverage) {
    console.warn(
      `[CRAP] ⚠ No coverage artifact at ${coveragePath}. All files will be skipped under requireCoverage=true.`,
    );
    console.warn(
      "[CRAP] ⚠ Run 'npm run test:coverage' before 'npm run crap:update'.",
    );
  }

  const {
    rows,
    scannedFiles,
    skippedFilesNoCoverage,
    skippedMethodsNoCoverage,
  } = scanAndScore({
    targetDirs,
    coverage,
    requireCoverage,
    cwd: process.cwd(),
  });

  const escomplexVersion = resolveEscomplexVersion();
  const envelope = buildBaselineEnvelope({ rows, escomplexVersion });
  saveCrapBaseline(envelope, { baselinePath: args.baselinePath });

  console.log(
    `[CRAP] Scanned ${scannedFiles} file(s); wrote ${envelope.rows.length} row(s).`,
  );
  if (skippedFilesNoCoverage > 0) {
    console.log(
      `[CRAP] Skipped ${skippedFilesNoCoverage} file(s) without coverage entries.`,
    );
  }
  if (skippedMethodsNoCoverage > 0) {
    console.log(
      `[CRAP] Skipped ${skippedMethodsNoCoverage} method(s) whose per-method coverage was unresolved.`,
    );
  }
  console.log(
    `[CRAP] ✅ Baseline updated (kernelVersion=${envelope.kernelVersion}, escomplexVersion=${escomplexVersion}).`,
  );
}

main().catch((err) => {
  console.error(`[CRAP] ❌ Fatal error: ${err?.stack ?? err?.message ?? err}`);
  process.exit(1);
});
