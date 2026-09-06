/**
 * run-bdd-suite retirement guard (Epic #3214 / Story #3298).
 *
 * Acceptance: the headless `/run-bdd-suite` workflow is hard-cutover deleted
 * and every live reference is repointed to its agent-driven successor
 * `/qa-run` (authored in Story #3297).
 *
 * This spec is a structural assertion that:
 *   1. `.agents/workflows/run-bdd-suite.md` no longer exists.
 *   2. `sync-claude-commands.js` reaps `.claude/commands/run-bdd-suite.md` as
 *      an orphan — the generated command disappears once the source workflow
 *      is deleted and the sync re-runs.
 *
 *      This is asserted against a *fresh* projection into a temp tree seeded
 *      with the stale command, not against the repo's own
 *      `.claude/commands/`. That mirror is generated and gitignored, so it is
 *      empty in any freshly materialized worktree — where the old form of this
 *      assertion ("the file is not there") passed vacuously, proving nothing.
 *      See `tests/helpers/projected-commands.js`.
 *   3. No live `.agents/` or `docs/` file references `run-bdd-suite`.
 */

import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { projectCommands } from './helpers/projected-commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const RETIRED_WORKFLOW = '.agents/workflows/run-bdd-suite.md';
const RETIRED_COMMAND = 'run-bdd-suite.md';

const SCAN_ROOTS = [
  path.join(REPO_ROOT, '.agents'),
  path.join(REPO_ROOT, 'docs'),
];

// Directories that hold historical breadcrumbs, generated mirrors, or
// installed dependencies — none of which are live consumers.
const EXCLUDED_DIRS = new Set(['node_modules', '.worktrees']);

const REFERENCE = /run-bdd-suite/;

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function* walkTextFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkTextFiles(full);
      continue;
    }
    if (entry.isFile()) {
      yield full;
    }
  }
}

describe('run-bdd-suite retirement guard', () => {
  it('removes .agents/workflows/run-bdd-suite.md', async () => {
    const target = path.join(REPO_ROOT, RETIRED_WORKFLOW);
    assert.equal(
      await fileExists(target),
      false,
      `${RETIRED_WORKFLOW} must be deleted — its successor is .agents/workflows/qa-run.md`,
    );
  });

  it('reaps .claude/commands/run-bdd-suite.md as an orphan', () => {
    // Seed the destination with the pre-retirement generated command so the
    // run exercises the orphan-reap, not just its absence from a fresh tree.
    const projection = projectCommands({ seedOrphans: [RETIRED_COMMAND] });
    assert.equal(
      projection.has(RETIRED_COMMAND),
      false,
      `.claude/commands/${RETIRED_COMMAND} must be reaped as an orphan — no workflow sources it any more`,
    );
  });

  it('no live .agents/ or docs/ file references run-bdd-suite', async () => {
    const offenders = [];
    for (const root of SCAN_ROOTS) {
      for await (const file of walkTextFiles(root)) {
        let source;
        try {
          source = await readFile(file, 'utf8');
        } catch {
          continue;
        }
        if (REFERENCE.test(source)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Found live references to the retired /run-bdd-suite workflow (repoint to /qa-run):\n${offenders.join('\n')}`,
    );
  });
});
