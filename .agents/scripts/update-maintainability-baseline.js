import {
  calculateAll,
  saveBaseline,
  scanDirectory,
} from './lib/maintainability-utils.js';

/**
 * Script to update the maintainability baseline file.
 * Run this when you have intentionally improved code quality or
 * when adding new files that should be tracked.
 */

const TARGET_DIRS = ['.agents/scripts', 'tests'];

async function main() {
  console.log('[Maintainability] Updating baseline...');

  const files = [];
  TARGET_DIRS.forEach((dir) => {
    console.log(`[Maintainability] Scanning ${dir}...`);
    scanDirectory(dir, files);
  });

  console.log(
    `[Maintainability] Calculating scores for ${files.length} files...`,
  );
  const scores = calculateAll(files);

  saveBaseline(scores);

  console.log(
    '[Maintainability] ✅ Baseline updated successfully in maintainability-baseline.json',
  );
}

main().catch((err) => {
  console.error(`[Maintainability] ❌ Fatal error: ${err.message}`);
  process.exit(1);
});
