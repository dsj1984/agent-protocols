import path from 'node:path';
import { getChangedFiles } from './lib/changed-files.js';
import { resolveConfig } from './lib/config-resolver.js';
import {
  calculateAll,
  getBaseline,
  scanDirectory,
} from './lib/maintainability-utils.js';
import { createFrictionEmitter } from './lib/orchestration/friction-emitter.js';
import { createProvider } from './lib/provider-factory.js';

/**
 * CI script to verify that maintainability scores haven't regressed.
 * Exit code 1 if regressions are found, 0 otherwise.
 *
 * When invoked with `--story <id>` (or `FRICTION_STORY_ID` env) the script
 * also posts a rate-limited `friction` structured comment to the named Story
 * ticket naming every regressed file — turning the previously silent CI-exit
 * into an in-ticket signal the operator can see without scraping CI logs.
 */

const TARGET_DIRS = ['.agents/scripts', 'tests'];
const TOLERANCE = 0.001; // Allow for tiny floating point variances

function compareScores(scores, baseline, tolerance) {
  let regressions = 0;
  let newFiles = 0;
  let improvements = 0;
  const regressedFiles = [];

  for (const [file, score] of Object.entries(scores)) {
    const baselineScore = baseline[file];

    if (baselineScore === undefined) {
      console.log(
        `[Maintainability] 🆕 New file detected: ${file} (Score: ${score.toFixed(2)})`,
      );
      newFiles++;
      continue;
    }

    if (score < baselineScore - tolerance) {
      const diff = baselineScore - score;
      console.error(`[Maintainability] ❌ REGRESSION in ${file}`);
      console.error(`                Current: ${score.toFixed(2)}`);
      console.error(`                Baseline: ${baselineScore.toFixed(2)}`);
      console.error(`                Drop: -${diff.toFixed(2)}`);
      regressions++;
      regressedFiles.push({
        file,
        current: score,
        baseline: baselineScore,
        drop: diff,
      });
    } else if (score > baselineScore + tolerance) {
      improvements++;
    }
  }

  return { regressions, newFiles, improvements, regressedFiles };
}

function parseStoryIdArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--story' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  }
  const envVal = Number(process.env.FRICTION_STORY_ID);
  return Number.isInteger(envVal) && envVal > 0 ? envVal : null;
}

export function parseChangedSinceArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--changed-since') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) return next;
      return 'main';
    }
  }
  return null;
}

async function emitRegressionFriction(storyId, regressedFiles) {
  if (!storyId || regressedFiles.length === 0) return;
  let orchestration;
  try {
    orchestration = resolveConfig();
  } catch (err) {
    console.warn(
      `[Maintainability] friction emit skipped — config resolve failed: ${err?.message ?? err}`,
    );
    return;
  }
  const provider = createProvider(orchestration);
  const emitter = createFrictionEmitter({ provider });
  const body = [
    '### 🚧 Friction — maintainability baseline regression',
    '',
    `Story \`#${storyId}\` — \`check-maintainability\` detected ${regressedFiles.length}`,
    'file(s) below baseline:',
    '',
    '| File | Current | Baseline | Drop |',
    '|---|---|---|---|',
    ...regressedFiles.map(
      (r) =>
        `| \`${r.file}\` | ${r.current.toFixed(2)} | ${r.baseline.toFixed(2)} | -${r.drop.toFixed(2)} |`,
    ),
    '',
    'Refactor the flagged files or run `npm run maintainability:update` to',
    'refresh the baseline if the drop is justified.',
  ].join('\n');
  try {
    await emitter.emit({
      ticketId: storyId,
      markerKey: 'baseline-refresh-regression',
      body,
    });
  } catch (err) {
    console.warn(
      `[Maintainability] friction emit failed: ${err?.message ?? err}`,
    );
  }
}

function printSummaryReport(scores, stats) {
  const { regressions, improvements, newFiles } = stats;
  console.log('\n--- Maintainability Report ---');
  console.log(`Total Files Checked: ${Object.keys(scores).length}`);
  console.log(
    `Pass:                ${Object.keys(scores).length - regressions}`,
  );
  console.log(`Regressions:         ${regressions}`);
  console.log(`Improvements:        ${improvements}`);
  console.log(`New Files:           ${newFiles}`);
  console.log('------------------------------\n');
}

async function main() {
  console.log('[Maintainability] Verifying code quality against baseline...');

  const baseline = getBaseline();
  if (Object.keys(baseline).length === 0) {
    console.warn(
      "[Maintainability] ⚠️ No baseline found. Run 'npm run maintainability:update' to create one.",
    );
    process.exit(0);
  }

  const files = [];
  TARGET_DIRS.forEach((dir) => {
    scanDirectory(dir, files);
  });

  const changedSinceRef = parseChangedSinceArg();
  let scopedFiles = files;
  let scopedBaseline = baseline;
  if (changedSinceRef) {
    let changedList;
    try {
      changedList = getChangedFiles({
        ref: changedSinceRef,
        cwd: process.cwd(),
      });
    } catch (err) {
      console.error(
        `[Maintainability] ❌ ${err?.message ?? err}. Pass a resolvable ref or drop --changed-since for a full scan.`,
      );
      process.exit(1);
    }
    const scopeSet = new Set(changedList);
    console.log(
      `[Maintainability] --changed-since ${changedSinceRef}: ${scopeSet.size} changed file(s) in diff`,
    );
    scopedFiles = files.filter((abs) => {
      const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
      return scopeSet.has(rel);
    });
    scopedBaseline = Object.fromEntries(
      Object.entries(baseline).filter(([file]) => scopeSet.has(file)),
    );
  }

  const scores = calculateAll(scopedFiles);

  const stats = compareScores(scores, scopedBaseline, TOLERANCE);
  printSummaryReport(scores, stats);

  if (stats.regressions > 0) {
    console.error(
      '[Maintainability] ❌ Regression check failed. Please refactor the affected files or update the baseline if the change is justified.',
    );
    const storyId = parseStoryIdArg();
    if (storyId) {
      await emitRegressionFriction(storyId, stats.regressedFiles);
    }
    process.exit(1);
  }

  console.log('[Maintainability] ✅ Clean Code check passed.');
}

// Only run main when invoked directly — keep the module importable from tests.
const isDirect = (() => {
  try {
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const self = new URL(import.meta.url).pathname;
    const normalizedSelf =
      /^\/[A-Za-z]:/.test(self) ? self.slice(1) : self;
    return path.resolve(normalizedSelf) === invoked;
  } catch {
    return false;
  }
})();

if (isDirect) {
  main().catch((err) => {
    console.error(`[Maintainability] ❌ Fatal error: ${err.message}`);
    process.exit(1);
  });
}
