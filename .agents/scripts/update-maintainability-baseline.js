import {
  getBaselines,
  getQuality,
  resolveConfig,
} from './lib/config-resolver.js';
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

async function main() {
  const { settings } = resolveConfig();
  const targetDirs = getQuality({ agentSettings: settings }).maintainability
    .targetDirs;
  const baselinePath = getBaselines({ agentSettings: settings }).maintainability
    .path;
  console.log('[Maintainability] Updating baseline...');

  const files = [];
  targetDirs.forEach((dir) => {
    console.log(`[Maintainability] Scanning ${dir}...`);
    scanDirectory(dir, files);
  });

  console.log(
    `[Maintainability] Calculating scores for ${files.length} files...`,
  );
  const scores = calculateAll(files);

  saveBaseline(scores, baselinePath);

  console.log(
    `[Maintainability] ✅ Baseline updated successfully at ${baselinePath}`,
  );
}

main().catch((err) => {
  console.error(`[Maintainability] ❌ Fatal error: ${err.message}`);
  process.exit(1);
});
