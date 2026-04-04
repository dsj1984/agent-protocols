/**
 * git-commit-if-changed.js
 * Cross-platform script to commit only if there are staged changes.
 * Avoids Shell '&&' and '||' issues.
 */
import { spawnSync } from 'node:child_process';

const message = process.argv[2] || 'chore: automated commit';

// 1. Check if there are staged changes
const diff = spawnSync('git', ['diff', '--staged', '--quiet']);

if (diff.status === 1) {
  // Changes exist (exit code 1 for --quiet)
  console.log(`Changes detected. Committing with message: "${message}"`);
  const commit = spawnSync('git', ['commit', '-m', message], { stdio: 'inherit' });
  process.exit(commit.status);
} else if (diff.status === 0) {
  // No changes
  console.log('No staged changes detected. Skipping commit.');
  process.exit(0);
} else {
  // Error (e.g. not a git repo)
  console.error('Error running git diff:', diff.stderr?.toString());
  process.exit(diff.status || 1);
}
