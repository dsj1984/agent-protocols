/**
 * clean-temp.js
 *
 * Cross-platform utility to remove temp/ and tmp/ directories before tests.
 * This ensures that tests are running in a clean state and validates that
 * the code correctly handles directory creation (preventing ENOENT errors in CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const dirs = ['temp', 'tmp'];
const keepPatterns = [
  /^(dispatch|story)-manifest-[\w-]+\.(md|json)$/i,
  /^lint-baseline\.json$/i,
];

dirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    console.log(`[Clean] Scanning ${dir}/...`);
    try {
      const files = fs.readdirSync(dir);
      let keptCount = 0;
      for (const file of files) {
        const shouldKeep = keepPatterns.some((pattern) => pattern.test(file));
        if (!shouldKeep) {
          fs.rmSync(path.join(dir, file), { recursive: true, force: true });
        } else {
          keptCount++;
        }
      }
      
      // If we didn't keep anything, we can remove the dir itself
      if (keptCount === 0) {
        fs.rmSync(dir, { recursive: true, force: true });
      } else {
        console.log(`[Clean] Kept ${keptCount} manifest file(s) in ${dir}/`);
      }
    } catch (err) {
      console.warn(`[Clean] Warning: Could not process ${dir}: ${err.message}`);
    }
  }
});
