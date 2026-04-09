/**
 * clean-temp.js
 *
 * Cross-platform utility to remove temp/ and tmp/ directories before tests.
 * This ensures that tests are running in a clean state and validates that
 * the code correctly handles directory creation (preventing ENOENT errors in CI).
 */

import fs from 'node:fs';

const dirs = ['temp', 'tmp'];

dirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    console.log(`[Clean] Removing ${dir}/...`);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Clean] Warning: Could not remove ${dir}: ${err.message}`);
    }
  }
});
