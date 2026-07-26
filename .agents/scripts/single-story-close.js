#!/usr/bin/env node

/**
 * single-story-close.js — Close a Story against `main` (v2 `/deliver` path).
 *
 * Thin CLI entry for `/deliver` / `helpers/deliver-story`. Opens a PR from
 * `story-<id>` to `project.baseBranch`, runs Story-scope review, and arms
 * auto-merge. There is no Epic parent, epic-merge-lock, or wave merge.
 *
 * Pipeline (each step is a phase under
 * `./lib/orchestration/single-story-close/phases/`):
 *
 *   1. close-validation  — canonical gate chain against `baseBranch`
 *   2. base-sync         — `origin/<baseBranch>` → Story branch (Story #2580)
 *   3. push              — `git push -u` the Story branch
 *   4. pull-request      — `gh pr list` probe + `gh pr create`
 *   5. code-review       — Story-scope review (Epic #2815 / Story #2839)
 *   6. auto-merge        — `gh pr merge --auto --squash --delete-branch`
 *   7. label flip + notify — Story → `agent::closing` (Story #3385; the
 *                          `agent::done` flip + issue-close is deferred to
 *                          the post-merge confirmation step,
 *                          `single-story-confirm-merge.js`)
 *   8. worktree-reap     — drop the per-Story worktree
 *   9. confirm-merge      — close-and-land (Story #4428; the DEFAULT for
 *                          every run since `delivery.routing.closeAndLand`):
 *                          poll the just-armed PR to merge confirmation
 *                          (reusing `confirmStoryMerged`), capture the
 *                          Story follow-ups, or terminate `agent::blocked`
 *                          with a classified `merge.unlanded` event — or
 *                          `merge.flip-failed` when the merge landed and
 *                          only the label write failed. Skipped when the
 *                          operator owns the merge (`--no-wait-merge`,
 *                          `--no-auto-merge`, or `autoMerge: "strict"`),
 *                          which rests at `agent::closing` for the human.
 *
 * Existing tests import the re-exported helpers
 * (`runSingleStoryClose`, `ensurePullRequest`, `parsePrNumber`,
 * `enableAutoMerge`, `handleSyncFailure`, `buildSyncFailureCommentBody`,
 * `runStoryScopeReview`, `buildStoryReviewCrossRefBody`) from this file.
 *
 * Usage:
 *   node single-story-close.js --story <STORY_ID> [--cwd <main-repo>]
 *                              [--skip-validation] [--skip-sync]
 *                              [--no-auto-merge]
 *                              [--wait-merge | --no-wait-merge]
 *
 * Close-and-land is the DEFAULT for every run (Story #4428 introduced it as
 * `--wait-merge`; `delivery.routing.closeAndLand` — default `true` — made it
 * the default, and Story #4539 made that knob actually readable). Resolution
 * order, highest first: `--no-wait-merge` (explicit opt-out, always wins);
 * operator-owns-the-merge (`--no-auto-merge` or `delivery.ci.autoMerge:
 * "strict"` — the PR was deliberately left un-armed, so there is nothing to
 * land and the Story rests at `agent::closing`); explicit `--wait-merge`;
 * then the config. A genuine arm FAILURE is not an opt-out — it still waits
 * and therefore still blocks, which is what keeps the must-land contract
 * intact.
 *
 * Every invocation emits ONE schema-validated terminal envelope
 * (`.agents/schemas/story-deliver-terminal.schema.json`, Story #4543) on
 * stdout between `--- STORY DELIVER TERMINAL ---` markers. Its `status` is
 * the contract; the exit code mirrors it:
 *
 *   0 — `landed`:  the PR merged, the Story is `agent::done`, and the
 *                  post-land tail ran (follow-ups, status resync, local ref
 *                  cleanup, base fast-forward).
 *   3 — `pending`: RESUMABLE, not a failure. Either the per-invocation merge
 *                  wait (`delivery.mergeWatch.maxWaitSeconds`, default 300s
 *                  to fit a single host tool invocation) expired with the PR
 *                  still healthy and in flight, or the operator owns the
 *                  merge (`--no-wait-merge` / `--no-auto-merge` /
 *                  `autoMerge: "strict"`). NO label was mutated and no
 *                  `merge.unlanded` event was emitted. The envelope's
 *                  `nextCommand` names the single command that resumes it,
 *                  and the cumulative budget is anchored at the PR's
 *                  createdAt so the resume does not restart the clock.
 *   1 — `blocked` or `failed`: a classified hard block (the Story carries
 *                  `agent::blocked` and a friction comment) or a phase crash.
 *
 * The distinct `pending` code is the point: before it, a close-and-land whose
 * CI outlived the host's tool-invocation ceiling was killed mid-poll with no
 * terminal path taken at all, and merely shrinking the budget instead would
 * have misfiled every slow-CI run as a hard block.
 *
 * @see .agents/workflows/helpers/deliver-story.md
 * @see .agents/schemas/story-deliver-terminal.schema.json
 */

import { parseSprintArgs } from './lib/cli-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { formatCliError } from './lib/error-redactor.js';
import { Logger } from './lib/Logger.js';
import { emitTerminalFriction } from './lib/observability/runtime-friction.js';
import {
  failedTerminalFor,
  gatesForFailedPhase,
} from './lib/orchestration/single-story-close/failed-terminal.js';
import { enableAutoMergeWith } from './lib/orchestration/single-story-close/phases/auto-merge.js';
import {
  buildSyncFailureCommentBody,
  handleSyncFailure,
} from './lib/orchestration/single-story-close/phases/base-sync.js';
import {
  buildStoryReviewCrossRefBody,
  parsePrNumber,
  runStoryScopeReview,
} from './lib/orchestration/single-story-close/phases/code-review.js';
import { ensurePullRequestWith } from './lib/orchestration/single-story-close/phases/pull-request.js';
import {
  emitTerminalEnvelope,
  exitCodeForTerminal,
} from './lib/orchestration/story-deliver-terminal.js';

// Story #2990 moved the `gh`-spawn boundary into the `lib/gh-exec.js`
// facade (the same shim the `providers/github/` gateways use). The
// re-exports below preserve the SUT's public surface so tests and the
// orchestration body keep importing `ensurePullRequest` /
// `enableAutoMerge` from this file unchanged.
export const ensurePullRequest = ensurePullRequestWith;
export const enableAutoMerge = enableAutoMergeWith;

// Re-export pure helpers verbatim — they don't touch `execFileSync`
// or any URL-mocked module, so the phase exports work unmodified.
// `gatesForFailedPhase` now lives beside the envelope it feeds
// (`single-story-close/failed-terminal.js`); it is re-exported here so the
// CLI's public surface is unchanged by that move.
export {
  buildStoryReviewCrossRefBody,
  buildSyncFailureCommentBody,
  gatesForFailedPhase,
  handleSyncFailure,
  parsePrNumber,
  runStoryScopeReview,
};

export async function runSingleStoryClose(opts) {
  const { search } = new URL(import.meta.url);
  const mod = await import(
    `./lib/orchestration/single-story-close/runner.js${search}`
  );
  return mod.runSingleStoryClose(opts);
}

/**
 * CLI entry — resolves the process exit code from the terminal envelope's
 * status rather than from a thrown/not-thrown distinction, so `pending`
 * (resumable) is distinguishable from `blocked` (come look) without parsing
 * stdout.
 */
async function main() {
  try {
    const outcome = await runSingleStoryClose();
    return exitCodeForTerminal(outcome?.terminal ?? { status: 'failed' });
  } catch (err) {
    const terminal = failedTerminalFor(err, parseSprintArgs());
    if (!terminal) throw err;
    // Mirror runAsCli's default error line (which this catch pre-empts) so the
    // human-facing failure text is unchanged, then emit the envelope.
    Logger.error(`[single-story-close] Fatal error: ${formatCliError(err)}`);
    emitTerminalEnvelope(terminal);
    // Story #4578 — a close that died before the runner could report its own
    // terminal is exactly the friction the retro must see, so the crash path
    // gets the same emit the happy path does. Best-effort; cannot throw.
    await emitTerminalFriction({ envelope: terminal });
    return exitCodeForTerminal(terminal);
  }
}

runAsCli(import.meta.url, main, {
  source: 'single-story-close',
  propagateExitCode: true,
  usage: {
    invocation:
      'node .agents/scripts/single-story-close.js --story <id> [--cwd <main-repo>] [options]',
    summary:
      'Run the whole delivery tail for one Story — close gates, base sync, push, PR to the base branch, merge wait, agent::done flip — and emit the terminal envelope.',
    flags: [
      ['--story <id>', 'GitHub issue number of the Story (required).'],
      [
        '--cwd <main-repo>',
        'Main-repo checkout to run from (default: project root).',
      ],
      ['--skip-validation', 'Skip the close-validation gate chain.'],
      ['--skip-sync', 'Skip the base-branch sync phase.'],
      ['--no-auto-merge', 'Open the PR without arming native auto-merge.'],
      ['--wait-merge', 'Force the in-close merge wait.'],
      ['--no-wait-merge', 'Return as soon as the PR is open; do not wait.'],
      ['--max-wait-seconds <n>', 'Per-invocation merge-wait bound.'],
      ['--no-evidence', 'Do not reuse or write gate evidence stamps.'],
      ['--dry-run', 'Report the plan; mutate nothing.'],
    ],
    notes: [
      'Exit codes:\n  0  landed\n  1  blocked or failed\n  3  pending (resumable — run the envelope’s nextCommand)',
    ],
  },
});
