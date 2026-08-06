/**
 * phases/pull-request.js — open, reuse, or decline to open the PR for a
 * standalone Story.
 *
 * Probes for an existing PR with `head = storyBranch`; creates one if none
 * exists. Returns `{ url, alreadyMerged, created }`.
 *
 * `gh pr view --head` is not available on all `gh` versions, so we probe
 * with `gh pr list --head <branch>` and fall back to `gh pr create`.
 *
 * Story #2990 routed the underlying `gh pr list` / `gh pr create` calls
 * through the `lib/gh-exec.js` facade (the same shim the
 * `providers/github/` gateways use) so this phase inherits the typed
 * error classification, timeout handling, and JSON parsing surface
 * instead of carrying its own `execFileSync('gh', …)` plumbing.
 *
 * ## An already-merged PR is not an absent PR (Story #4873)
 *
 * The probe used to ask for `--state open` only. On the recovery path that is
 * a false negative with teeth: a resumed close pushes the branch, the push
 * turns the checks green, armed auto-merge lands the ORIGINAL PR server-side,
 * and the resumed close then sees no OPEN PR on the head — so it opened a
 * SECOND PR against a branch that is now byte-identical to base and
 * squash-merged a zero-file commit onto `main`. Both halves of that are now
 * closed:
 *
 *   1. The probe reads `--state all` and reports a MERGED PR on this head as
 *      the outcome (`alreadyMerged: true`), so the caller lands on the merge
 *      that already happened instead of manufacturing a new one. An OPEN PR
 *      still wins over a merged one — a re-opened head is a live PR.
 *   2. Creation is REFUSED outright when the head-versus-base diff contains no
 *      files. An empty diff means there is nothing to merge, so a PR opened on
 *      it can only ever produce an empty commit.
 *
 * The empty-diff guard fails **open**, not closed: `computeChangeSet` returns
 * `files: null` when it cannot enumerate the diff at all, and absence of
 * evidence must never block a legitimate PR — only a positively-observed empty
 * file list refuses.
 *
 * The function still accepts an injected `gh` facade so tests can wire
 * a fake without spawning real children.
 */

import { gh as defaultGh } from '../../../gh-exec.js';
import { Logger } from '../../../Logger.js';
import { computeChangeSet as defaultComputeChangeSet } from '../../change-set.js';
import { buildPullRequestFields } from './normalize-pr-title.js';

/**
 * Pick the PR this head branch should resolve to from a `gh pr list
 * --state all` projection. A live PR always wins; otherwise the first MERGED
 * PR is the outcome to report. A head whose only PRs were CLOSED without
 * merging resolves to nothing — there is a new PR to open.
 *
 * A row carrying a url but no recognizable `state` reads as live, not as
 * nothing: the projection this phase asks for always includes `state`, so an
 * absent one means an older/other `gh`, and the old `--state open` probe
 * treated every returned row as a reusable open PR. Guessing "no PR" there is
 * the failure mode with teeth — it opens a duplicate.
 *
 * Pure, and module-private on purpose: `ensurePullRequestWith` is the only
 * caller and the only surface worth pinning, so the precedence is asserted
 * through it rather than through a test-only export the production
 * dead-export ratchet would then flag.
 *
 * @param {Array<{url?: string, state?: string, mergedAt?: string}>} rows
 * @returns {{ url: string, state: 'OPEN'|'MERGED' }|null}
 */
function pickHeadPullRequest(rows) {
  if (!Array.isArray(rows)) return null;
  let merged = null;
  for (const row of rows) {
    const url = String(row?.url ?? '').trim();
    if (!url) continue;
    const state = String(row?.state ?? '').toUpperCase();
    if (state === 'MERGED' || (state !== 'OPEN' && row?.mergedAt)) {
      merged ??= { url, state: 'MERGED' };
      continue;
    }
    if (state === 'CLOSED') continue;
    return { url, state: 'OPEN' };
  }
  return merged;
}

/**
 * Enumerate the head-versus-base diff and report whether it is positively
 * empty. `null` (diff unenumerable) is NOT empty — see the module header.
 *
 * The diff is taken against `origin/<baseBranch>` when that ref resolves,
 * because the local base ref can trail the remote by exactly the merge that
 * makes this diff empty — the very state the guard exists to catch. It falls
 * back to the local ref, and finally to "unknown", when the remote ref cannot
 * be enumerated.
 *
 * @returns {{ empty: boolean, baseRef: string|null }}
 */
function probeEmptyDiff({ cwd, baseBranch, storyBranch, computeChangeSet }) {
  for (const baseRef of [`origin/${baseBranch}`, baseBranch]) {
    const set = computeChangeSet({ baseRef, headRef: storyBranch, cwd });
    if (!set.enumerated) continue;
    return { empty: (set.files ?? []).length === 0, baseRef };
  }
  return { empty: false, baseRef: null };
}

/**
 * Probe for an existing PR with `head = storyBranch`; create one if none
 * exists. Exported for testing.
 *
 * @param {{
 *   cwd: string,
 *   storyId: number,
 *   storyTitle: string,
 *   storyBody?: string,
 *   storyBranch: string,
 *   baseBranch: string,
 *   gh?: ReturnType<typeof import('../../../gh-exec.js').createGh>,
 *   computeChangeSetFn?: typeof defaultComputeChangeSet,
 *   progress?: (tag: string, msg: string) => void,
 * }} args
 * @returns {Promise<{ url: string, alreadyMerged: boolean, created: boolean }>}
 */
export async function ensurePullRequestWith({
  cwd: _cwd,
  storyId,
  storyTitle,
  storyBody = '',
  storyBranch,
  baseBranch,
  gh = defaultGh,
  computeChangeSetFn = defaultComputeChangeSet,
  progress = () => {},
}) {
  // `cwd` is preserved on the call signature for backwards compatibility
  // with the SUT's thin wrapper, but `gh-exec` spawns `gh` against the
  // current process cwd. `single-story-close.js` chdirs into the worktree
  // before invoking the phase, so the effective cwd matches the legacy
  // `execFileSync('gh', …, { cwd })` shape.
  try {
    // `gh pr list --head <branch> --state all --json url,state,mergedAt`
    // returns a JSON array of rows; an empty array means this head has never
    // had a PR. `--state all` (not `open`) is load-bearing — see the module
    // header's duplicate-empty-PR note.
    const rows = await gh.pr.list(
      ['--head', storyBranch, '--state', 'all'],
      ['url', 'state', 'mergedAt'],
    );
    const existing = pickHeadPullRequest(rows);
    if (existing?.state === 'OPEN') {
      progress('PR', `Reusing existing PR: ${existing.url}`);
      return { url: existing.url, alreadyMerged: false, created: false };
    }
    if (existing?.state === 'MERGED') {
      progress(
        'PR',
        `✅ PR for ${storyBranch} is already MERGED: ${existing.url} — ` +
          'reporting that outcome instead of opening a second PR.',
      );
      return { url: existing.url, alreadyMerged: true, created: false };
    }
  } catch (err) {
    // `gh pr list` failure is recoverable — fall through to create. Log
    // the error so an auth issue surfaces visibly.
    Logger.warn?.(
      `[single-story-close] ⚠️ \`gh pr list\` probe failed (continuing to create): ${err?.message ?? err}`,
    );
  }

  // Nothing to merge → nothing to open. Refused before `gh pr create` so the
  // failure names the empty diff rather than surfacing later as a zero-file
  // squash commit on the base branch.
  const emptyDiff = probeEmptyDiff({
    cwd: _cwd ?? process.cwd(),
    baseBranch,
    storyBranch,
    computeChangeSet: computeChangeSetFn,
  });
  if (emptyDiff.empty) {
    throw new Error(
      `[single-story-close] refusing to open a pull request for ${storyBranch}: ` +
        `the head-versus-base diff (${emptyDiff.baseRef}...${storyBranch}) contains no files. ` +
        'An empty diff has nothing to merge, and a PR opened on it can only squash an empty ' +
        'commit onto the base branch. If the work already landed, confirm the merge instead: ' +
        `node .agents/scripts/single-story-confirm-merge.js --story ${storyId}`,
    );
  }

  progress('PR', `Opening PR for ${storyBranch} → ${baseBranch}...`);
  // The repo squash-merges and GitHub uses the PR title as the squash subject
  // on `main`, so both fields are derived rather than typed — see
  // `normalize-pr-title.js`. `gh-exec` spawns `gh` against the current process
  // cwd (the worktree), so the branch read uses the same cwd.
  const { title, body } = buildPullRequestFields({
    storyTitle,
    storyId,
    storyBody,
    storyBranch,
    baseBranch,
    cwd: _cwd ?? process.cwd(),
    progress,
  });
  try {
    const createResult = await gh.pr.create([
      '--base',
      baseBranch,
      '--head',
      storyBranch,
      '--title',
      title,
      '--body',
      body,
    ]);
    const url = (createResult?.stdout ?? '').trim();
    progress('PR', `✅ Opened: ${url}`);
    return { url, alreadyMerged: false, created: true };
  } catch (err) {
    throw new Error(
      `[single-story-close] \`gh pr create\` failed: ${err?.message ?? err}`,
    );
  }
}
