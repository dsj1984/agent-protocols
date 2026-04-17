---
description: >-
  Per-story git worktree isolation model — configuration, lifecycle,
  node_modules strategies, Windows notes, fallback mode, and human-reviewer
  guidance.
---

# Worktree-per-Story Lifecycle

Parallel sprint execution can race when multiple story agents share one working
tree: rapid `git checkout` swaps cause `git add` to sweep another agent's WIP
into the wrong commit. Epic #229 moves each dispatched story into its own
`git worktree` at `.worktrees/story-<id>/` so branch swaps, staging, and reflog
activity are isolated per-story. The main checkout stays quiet.

This document is the operator and reviewer reference. See
[`sprint-execute`](sprint-execute.md) for the broader sprint flow and the
Epic-229 Tech Spec for architectural rationale.

## Configuration

All knobs live under `orchestration.worktreeIsolation` in `.agentrc.json`:

```jsonc
{
  "orchestration": {
    "worktreeIsolation": {
      "enabled": true, // master switch; false = single-tree (v5.5.1)
      "root": ".worktrees", // relative to repo root; must stay inside it
      "nodeModulesStrategy": "per-worktree", // per-worktree | symlink | pnpm-store
      "primeFromPath": null, // required when strategy = "symlink"
      "allowSymlinkOnWindows": false, // explicit opt-in for symlink on win32
      "reapOnSuccess": true, // remove worktree after successful story merge
      "reapOnCancel": true, // remove worktree when story is cancelled
      "warnOnUncommittedOnReap": true, // refuse-to-delete + warn, never force
      "windowsPathLengthWarnThreshold": 240, // pre-flight warning threshold (MAX_PATH=260)
    },
  },
}
```

The schema is validated by `config-resolver.js`. Unknown strategies, `root`
values that escape the repo root, and shell-metacharacter injection in `root`
are all rejected at config-load time.

## Lifecycle

| Phase      | When                         | What happens                                                                 |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------- |
| **Sweep**  | Start of `/sprint-execute`   | Stale `*.lock` files under `.git/` (older than 5 min) are removed before GC. |
| **GC**     | Start of `/sprint-execute`   | Orphan `.worktrees/story-*` whose stories are closed are reaped if clean.    |
| **Ensure** | Before dispatching a story   | `git worktree add .worktrees/story-<id>/` on the `story-<id>` branch.        |
| **Run**    | During story execution       | Agent runs inside the worktree; HEAD/reflog activity is isolated.            |
| **Reap**   | After successful story merge | `git worktree remove` — refuses to delete dirty trees or unmerged branches.  |

The `WorktreeManager` (`.agents/scripts/lib/worktree-manager.js`) is the single
authority for `ensure`, `reap`, `list`, `isSafeToRemove`, `gc`, and
`sweepStaleLocks`. No other script may call `git worktree` directly.

### Stale-lock sweep

Even with per-story worktree isolation, the main repo's `.git/` dir is shared
state — `git worktree add/remove/prune`, `fetch`, auto-gc, and VSCode's git
extension all touch it. A crashed orchestrator can leave an orphaned
`.git/index.lock` (or `HEAD.lock`, `packed-refs.lock`, per-worktree
`index.lock`, etc.) that blocks the next run with a "another git process seems
to be running" error.

`sweepStaleLocks({ maxAgeMs = 300_000 })` removes well-known lock files whose
mtime exceeds the age threshold. Fresh locks (belonging to a legitimate
in-flight op) are skipped. It runs automatically at the start of
`/sprint-execute`, immediately before `gc`.

## `.agents` symlink (consumer projects)

In consumer projects `.agents/` is declared as a git submodule in `.gitmodules`.
When `git worktree add` creates `.worktrees/story-<id>/`, the worktree carries
its own gitlink entry for `.agents`, and `git worktree remove` then refuses to
reap it on the grounds that "there is a submodule inside the worktree."

`WorktreeManager.ensure()` resolves this at worktree creation by replacing the
worktree's `.agents` with a symlink (junction on Windows) that points at
`<repoRoot>/.agents`. Two invariants follow:

- Worktrees never carry their own copy of `.agents`. Scripts invoked from any
  worktree execute the same code as the root checkout.
- `git worktree remove` no longer trips the submodule guard, because the
  per-worktree index has `.agents` marked `skip-worktree` and the symlink is
  removed by `reap` before `git worktree remove` runs.

The framework repo itself (where `.agents` is a regular tracked directory, not a
submodule) skips this behavior. Detection is automatic — keyed off whether
`.gitmodules` at repo root declares `.agents` as a submodule path.

> **Invariant:** `.agents` must never diverge across worktrees. The symlink
> enforces that structurally; do not work around it by copying files into a
> worktree's `.agents/`.

## node_modules strategies

| Strategy       | Behavior                                                              | When to pick it                                                        |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `per-worktree` | Each worktree runs its own `npm/pnpm install`. Default.               | Correct everywhere. Choose for small repos or when disk is cheap.      |
| `symlink`      | Symlinks `<wt>/node_modules` → `<primeFromPath>/node_modules`.        | Large monorepos where install time dominates. Requires a primed donor. |
| `pnpm-store`   | No-op at worktree level; agent runs `pnpm install` against the store. | Repos already on pnpm. Gets most of symlink's speed without fragility. |

Symlink strategy:

- `primeFromPath` (relative to repo root) must exist and contain `node_modules`.
- On Windows, `allowSymlinkOnWindows: true` is required — symlink semantics vary
  by Windows version and may demand admin rights.
- `nodeModulesStrategy: "symlink"` without `primeFromPath` is a config error.

## Windows notes

- **`core.longpaths=true`** is set on each new worktree to lift the 260-char
  MAX_PATH ceiling. Some older build tools still truncate even with this flag;
  the pre-flight warning below catches those cases before a build breaks.
- **Long-path warning**: when `worktreePath.length + 80` exceeds
  `windowsPathLengthWarnThreshold` (default 240), `WorktreeManager` emits a
  warning locally and the dispatcher posts an `⚠️` comment on the Epic issue.
  Relocate `orchestration.worktreeIsolation.root` to a shorter prefix (e.g.
  `C:\w`) if you see this.
- **`packed-refs` contention**: two worktrees fetching concurrently can collide
  on `.git/packed-refs.lock`. `gitFetchWithRetry` (`git-utils.js`) retries that
  specific failure up to 3 times with 250/500/1000 ms backoff. Unrelated fetch
  failures surface immediately — no retry.

## Fallback: single-tree mode

Set `orchestration.worktreeIsolation.enabled: false` (or omit the block) to
restore v5.5.1 single-tree behavior:

- No `git worktree add` / `remove` calls.
- `assert-branch.js` and `computeStoryWaves` focus-area serialization remain in
  place as the primary race guards.
- All existing v5.5.1 tests pass in this mode.

Pick single-tree mode when:

- The runner lacks disk/space for parallel `node_modules` trees and pnpm is
  unavailable.
- Windows path limits are unsolvable via the long-path guard.
- You need a minimal-risk environment to debug an unrelated dispatcher issue.

## Reviewer guidance

Human reviewers should **keep using the main checkout** — not a worktree:

- The Epic branch accumulates the cumulative diff for code review; that lives on
  the main checkout, not in any per-story worktree.
- Opening a worktree in an IDE can mislead: the working directory looks like the
  main repo but carries a different HEAD. The main checkout is the canonical
  place to read PRDs, Tech Specs, and run `/sprint-code-review`.
- `git worktree list --porcelain` on the main checkout enumerates any still
  in-flight story worktrees if you need to inspect one — prefer read-only
  operations (`git log`, `git show`) when you do.

## Constraint

- **Never** call `git worktree` directly — always go through `WorktreeManager`.
  It enforces `storyId`/`branch` validation and path-traversal checks.
- **Never** pass `--force` to `git worktree remove` from framework code. The
  refuse-to-delete guard on uncommitted work is deliberate; `--force` is an
  operator-only escape hatch.
- **Never** commit the `.worktrees/` directory. It must be gitignored.
- **Always** use the main checkout for code review — not a per-story worktree.
- **Always** respect `orchestration.worktreeIsolation.enabled: false` as a
  first-class fallback mode, not a degraded one. v5.5.1 single-tree guards
  (`assert-branch.js`, focus-area serialization) remain the primary defense in
  that mode.

## Operator escape hatches

- **Force-remove a worktree**: the framework **never** passes `--force` to
  `git worktree remove`. If a worktree is wedged (e.g. from a crashed agent),
  operators can manually run `git worktree remove --force <path>`. Confirm there
  is no uncommitted work first.
- **Disable temporarily**: flip `enabled: false` in `.agentrc.json`. The next
  `/sprint-execute` skips worktree creation entirely.
- **Inspect live worktrees**: `git worktree list --porcelain` on the main
  checkout. Each block shows `worktree <path>` / `branch refs/heads/story-<id>`.
