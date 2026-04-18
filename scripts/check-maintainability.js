import {
  calculateAll,
  getBaseline,
  scanDirectory,
} from './lib/maintainability-utils.js';

/**
 * CI script to verify that maintainability scores haven't regressed.
 * Exit code 1 if regressions are found, 0 otherwise.
 */

const TARGET_DIRS = ['.agents/scripts', 'tests'];
const TOLERANCE = 0.001; // Allow for tiny floating point variances

function compareScores(scores, baseline, tolerance) {
  let regressions = 0;
  let newFiles = 0;
  let improvements = 0;

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
    } else if (score > baselineScore + tolerance) {
      improvements++;
    }
  }

  return { regressions, newFiles, improvements };
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
  const scores = calculateAll(files);

  const stats = compareScores(scores, baseline, TOLERANCE);
  printSummaryReport(scores, stats);

  if (stats.regressions > 0) {
    console.error(
      '[Maintainability] ❌ Regression check failed. Please refactor the affected files or update the baseline if the change is justified.',
    );
    process.exit(1);
  }

  console.log('[Maintainability] ✅ Clean Code check passed.');
}

main().catch((err) => {
  console.error(`[Maintainability] ❌ Fatal error: ${err.message}`);
  process.exit(1);
});
