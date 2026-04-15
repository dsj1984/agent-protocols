---
description: >-
  Execute a single Story end-to-end — ensures a per-story worktree (if isolation
  is enabled), implements all child Tasks sequentially, validates, merges into
  the Epic branch, and reaps the worktree.
---

# /sprint-execute #[Story ID]

## Overview

`/sprint-execute` is a **single-purpose worker**. One invocation runs one Story
from init to close. The argument is always a **Story ID**.

For the Epic-level view — waves, recommended models, parallel suggestions — see
the Story Dispatch Table emitted by `/sprint-plan` (Phase 4). Run one
`/sprint-execute <Story ID>` per Claude window; the operator owns launch order
by picking stories off the Dispatch Table.

> **Epic IDs are not accepted.** If you pass an Epic ID, the underlying
> `sprint-story-init.js` will reject it with "Issue #N is not a Story". Use
> `/sprint-plan <Epic ID>` to regenerate the Dispatch Table.

<!-- -->

> **Worktree isolation.** When `orchestration.worktreeIsolation.enabled` is
> `true`, Step 0 ensures a worktree at `.worktrees/story-<id>/` and prints its
> absolute path as `workCwd`. You **must** `cd` into that path before Step 1.
> The main checkout's HEAD is never moved. When isolation is `false`, `workCwd`
> equals the main checkout and the flow is identical to v5.5.1 single-tree
> behavior. See [`worktree-lifecycle.md`](worktree-lifecycle.md) for
> node_modules strategies, Windows notes, and escape hatches.

---

## Step 0 — Initialize (`sprint-story-init.js`)

Run the initialization script from the **main checkout**. It sets up the Epic
branch, seeds the Story branch, creates the worktree (if enabled), and
transitions child Tasks to `agent::executing`.

```powershell
node .agents/scripts/sprint-story-init.js --story <storyId>
```

The script:

- Fetches the Story ticket and validates it's a `type::story`.
- Checks blockers — **exits non-zero** if any `blocked by` are open.
- Traces the hierarchy (Feature → Epic → PRD / Tech Spec).
- Enumerates child Tasks in dependency order.
- Bootstraps the Epic branch if missing (in main checkout).
- **Worktree-enabled path**: seeds the `story-<id>` branch ref from the Epic
  branch without moving main's HEAD, then `git worktree add` at
  `.worktrees/story-<id>/`.
- **Single-tree fallback**: checks out the story branch in the main checkout
  (v5.5.1 behavior).
- Batch-transitions all child Tasks to `agent::executing`.

**Output**: structured JSON. Key fields for the agent:

- `workCwd` — absolute path where you run all subsequent commands.
- `worktreeEnabled` — whether worktree isolation is active.
- `tasks[]` — dependency-ordered list of child Tasks to implement.
- `context.prdId`, `context.techSpecId` — fetch these before coding.

> **Dry-run**: Add `--dry-run` to check status without git or ticket changes. No
> worktree is created.

### Step 0.5 — `cd` into the workCwd

```powershell
cd "<workCwd from Step 0 result>"
```

All subsequent git commands, test runs, and Step 3 closure run from this
directory. In worktree-enabled mode this is `.worktrees/story-<id>/`; in
single-tree mode it is the main checkout.

> **Model Selection**: check the **Story Dispatch Table** from `/sprint-plan`
> for this Story's **Model Tier** (`high` or `low`). Pick any model whose
> reasoning strength matches the tier — the concrete choice is left to the
> operator/router.

---

## Step 1 — Implementation (Sequential Task Loop)

For **each child Task** in the order returned by `sprint-story-init.js`:

1. Read the full `## Instructions` section of the Task ticket.
2. Implement all described changes strictly within the scope of the Story
   branch.
3. Commit after each Task. Even inside an isolated worktree, keep the
   assert-branch guard — it's cheap defense-in-depth against the agent drifting
   off the story branch (e.g. from a `git checkout` buried in a tool script).

   ```powershell
   # 1. Guard: halt if HEAD drifted off story-<id>.
   node .agents/scripts/assert-branch.js --expected story-<storyId> --cwd .

   # 2. Stage: prefer explicit paths for the files you edited in this Task.
   git add <path/one> <path/two>
   # Or, for tracked edits only:
   # git add -u

   git commit --no-verify -m "feat(<scope>): <task title> (resolves #<taskId>)"
   ```

4. Proceed to the next Task in the Story.

---

## Step 2 — Validate

After all Tasks are implemented, run shift-left validation in the worktree:

```powershell
npm run lint
npm test
```

If tests or lint fail:

- Fix the issues and commit corrections.
- If blocked (e.g. upstream dependency missing): post a friction comment and
  apply `status::blocked`.

---

## Step 3 — Close (`sprint-story-close.js`)

Run closure. Pass the main-checkout path via `--cwd` so the merge and branch
deletion run against the main repo, not inside the worktree (branches checked
out in a worktree cannot be deleted from themselves). The close script will reap
the worktree after the merge succeeds.

```powershell
# From the worktree, invoke close against the main checkout.
node <main-repo>/.agents/scripts/sprint-story-close.js --story <storyId> --cwd <main-repo>
```

In single-tree mode, `--cwd` can be omitted (defaults to `PROJECT_ROOT`).

The script:

- Checks for `risk::high` — creates a PR instead of auto-merging and exits with
  code 1 (manual review required) when present.
- Merges the Story branch into `epic/<epicId>` with `--no-ff`.
- Pushes the Epic branch.
- Deletes the Story branch (local + remote).
- **Reaps the worktree** (`.worktrees/story-<id>/`) via `WorktreeManager.reap` —
  refuses if uncommitted or unmerged.
- Batch-transitions all child Tasks and the Story to `agent::done`.
- Runs `cascadeCompletion()` to propagate closure up the hierarchy.
- Runs `health-monitor.js` to update sprint metrics.
- Regenerates the Epic dispatch manifest (`temp/dispatch-manifest-<epicId>.md` /
  `.json`). Pass `--skip-dashboard` to suppress.

**Output**: structured JSON with `ticketsClosed[]`, `cascadedTo[]`, worktree
reap status.

> **Why not use GitHub auto-close?** GitHub's `Closes #N` only fires when
> merging into the repo's default branch. Story branches merge into
> `epic/<epicId>`, so we close tickets explicitly via the state writer.

---

## Parallel execution

Run two stories at once by opening two Claude windows and invoking
`/sprint-execute <id>` in each. With `worktreeIsolation.enabled: true` each
window gets its own `.worktrees/story-<id>/`; the main checkout stays quiet.
Pick the story IDs from the Dispatch Table produced by `/sprint-plan`.

Focus-area / file-overlap conflicts are the **operator's** responsibility now —
read the Dispatch Table before launching. The framework no longer serializes
waves automatically.

---

## Constraint

- **Never** push Story branch work directly to `main`.
- **Never** merge across Story branches — each Story is self-contained.
- **Always** `cd` into the `workCwd` returned by Step 0 before editing.
- **Always** verify `git branch --show-current` outputs the expected Story
  branch name before making any commits. If it does not, **STOP**.
- **Always** validate (lint + test) before running Step 3.
- **Always** pass `--cwd <main-repo>` to `sprint-story-close.js` when invoking
  from inside a worktree, so the merge runs in the main repo.
- **Always** run cascadeCompletion after merging — GitHub cannot auto-close
  tickets on non-default branch merges.
- **Always** delete the Story branch (local + remote) after merging into the
  Epic branch. `sprint-story-close.js` does this for you.
- **MCP Fallback**: If `agent-protocols` MCP tools fail due to connection
  errors, **fall back immediately** to
  `node .agents/scripts/update-ticket-state.js --task <id> --state <state>`
  (which also auto-cascades completion when `--state agent::done`). Do not leave
  tickets in stale states.
