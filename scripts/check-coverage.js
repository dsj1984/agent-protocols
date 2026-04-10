/**
 * check-coverage.js
 *
 * Enforces a test coverage threshold by parsing the Node.js test runner's
 * experimental-test-coverage output.
 *
 * Usage: node --test --experimental-test-coverage tests/... | node .agents/scripts/check-coverage.js 65
 */

import { createInterface } from 'node:readline';

const threshold = Number.parseInt(process.argv[2] || '65', 10);
const rl = createInterface({ input: process.stdin });

let foundAllFiles = false;
let passes = false;
let actualCoverage = 0;

rl.on('line', (line) => {
  // Console logging from tests might happen, we just want the summary
  // Summary line format:
  // ℹ all files                    |  65.34 |    69.82 |   61.95 |
  if (line.includes('all files')) {
    foundAllFiles = true;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 2) {
      actualCoverage = Number.parseFloat(parts[1]);
      if (!Number.isNaN(actualCoverage)) {
        passes = actualCoverage >= threshold;
      }
    }
  }
  // Passthrough the output so CI logs show it
  console.log(line);
});

rl.on('close', () => {
  if (!foundAllFiles) {
    console.error('\n❌ ERROR: Coverage summary not found in input.');
    process.exit(1);
  }

  if (passes) {
    console.log(
      `\n✅ Coverage Check Passed: ${actualCoverage}% (Threshold: ${threshold}%)`,
    );
    process.exit(0);
  } else {
    console.error(
      `\n❌ Coverage Check Failed: ${actualCoverage}% is below threshold of ${threshold}%`,
    );
    process.exit(1);
  }
});
