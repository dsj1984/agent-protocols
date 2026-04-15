---
description: >-
  Execute a sprint in two modes: Epic-level (output Dispatch Manifest and launch
  story waves) or Story-level (implement all Tasks within a single Story).
---

# /sprint-execute

## Overview

This workflow operates in two modes determined by the argument provided:

- **`/sprint-execute [Epic ID]`** — **Refresh Dashboard / Epic Dispatch**. This
  is an **optional** status and dispatch tool. Use it to:
  - View the up-to-date **Story Dispatch Table** and execution waves.
  - Release/dispatch manual tasks or those requiring HITL approval.
  - Check overall Epic progress (calculates total % complete across stories).
  - **NOTE**: The Dispatch Table should have already been generated during
    `/sprint-plan`. Use this command only to refresh the plan or for live
    dispatch.

- **`/sprint-execute #[Story ID]`** — **Story Execution (Primary)**. The core
  workflow for implementing work. It checks out the Story branch, implements ALL
  child Tasks sequentially, validates, and creates a unified PR.

> **Worktree isolation.** When `orchestration.worktreeIsolation.enabled` is
> `true`, each dispatched story runs in its own `git worktree` at
> `.worktrees/story-<id>/`. The agent `cd`s into that path; the main checkout
> stays quiet. See [`worktree-lifecycle.md`](worktree-lifecycle.md) for config,
> node_modules strategies, Windows notes, and the single-tree fallback.

---

## Mode A: Refresh & Epic Dispatch (`/sprint-execute [Epic ID]`)

### Step 0 — Purpose

Use this mode when you need an overview of the Epic or need to handle **live
dispatch** actions that cannot be automated at the Story level (e.g., releasing
`risk::high` tasks).

1. **Dry-Run Mode (Status Dashboard)**: Invoke this to see an up-to-date **Story
   Dispatch Table**. This is the natural "Status" check for the Epic.

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId> --dry-run
   ```

2. **Live-Dispatch Mode (HITL Release)**: Invoke this without flags to
   transition tickets from `agent::ready` to `agent::executing` (primarily for
   manual/legacy workflows or HITL release).

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId>
   ```

### Step 1 — Fetch & Schedule

The dispatcher automatically:

- Calls `provider.getTickets(epicId, { label: 'type::task' })` to retrieve all
  Tasks.
- Filters to Tasks **not** yet `agent::done` or `agent::executing`.
- Builds the dependency DAG from `blocked by #NNN` body references via
  `lib/Graph.js`.
- Detects cycles — aborts with an error if any are found.
- Auto-serializes Tasks sharing a `focus::` label (prevents concurrent
  overwrites).
- Groups Tasks into waves: Tasks in the same wave have no mutual dependencies
  and can run concurrently.

### Step 2 — HITL Gate (Risk::High Tasks)

For each dispatchable Task with a `risk::high` label, the dispatcher:

- Posts a HITL gate comment on the ticket requesting operator approval.
- Holds the Task and adds it to `heldForApproval` in the manifest.
- **The operator must manually remove the `risk::high` label** (or reply with
  `/approve <taskId>`) to release the Task on the next run.

### Step 3 — Dispatch Wave

For each eligible Task in the wave (those not held):

1. Context is hydrated via `context-hydrator.js` (persona, skills, hierarchy,
   protocol template).
2. The Task ticket label is transitioned: `agent::ready` → `agent::executing`.
3. The task is dispatched to the configured execution adapter
   (`orchestration.executor`).

For the **ManualDispatchAdapter** (default): a formatted Dispatch Manifest table
is printed, and a `temp/wave-N.json` file is written for the operator to hand
off to agents manually.

### Step 4 — Wave Completion & Re-evaluation

Re-run `/sprint-execute [Epic ID]` after completing a wave. The dispatcher
re-evaluates the DAG:

- Tasks marked `agent::done` are skipped.
- The next dependency-unblocked wave is identified and dispatched.

### Step 5 — Bookend Lifecycle (All Tasks Complete)

When the dispatcher detects **all Tasks under the Epic are `agent::done`**, it
automatically enters the Bookend Lifecycle. The following phases run
sequentially — each uses the persona, skills, and model from
`agentSettings.bookendRequirements`:

| Phase         | Workflow              | Config Key      |
| ------------- | --------------------- | --------------- |
| QA            | `/audit-quality`      | `isQA`          |
| Code Review   | `/sprint-code-review` | `isCodeReview`  |
| Retrospective | `/sprint-retro`       | `isRetro`       |
| Close-Out     | `/sprint-close`       | `isCloseSprint` |

> **Code Review is mandatory.** Every sprint must pass `/sprint-code-review`
> before proceeding to Close-Out. The review examines the cumulative diff of the
> Epic branch against `main` and validates all changes against the PRD and Tech
> Spec. See the [`sprint-code-review` workflow](sprint-code-review.md) for the
> full review protocol.

On final close-out:

- A summary comment is posted on the Epic issue.
- A webhook (`INFO: epic-complete`) is fired via `notify.js`.

---

## Mode B: Story-Level Execution (`/sprint-execute #[Story ID]`)

### Step 0 — Initialize (`sprint-story-init.js`)

Run the initialization script to set up the Story for implementation. This
single command replaces the manual context-gathering, blocker-checking, epic
branch bootstrap, story branch checkout, and task state transitions:

```powershell
node .agents/scripts/sprint-story-init.js --story <storyId>
```

The script:

- Fetches the Story ticket and validates it exists.
- Checks blockers — **exits non-zero** if any `blocked by` are open.
- Traces the hierarchy (Feature → Epic → PRD / Tech Spec).
- Enumerates child Tasks in dependency order.
- Bootstraps the Epic branch if it doesn't exist remotely.
- Checks out the Story branch with `-B` from `epic/<epicId>`.
- Batch transitions all child Tasks to `agent::executing`.

**Output**: Structured JSON with `tasks[]`, `context`, branch names. Use the
`tasks` array to know what to implement in Step 1. Use `context.prdId` and
`context.techSpecId` to fetch and review scope before writing code.

> **Dry-run**: Add `--dry-run` to check status without git or ticket changes.

<!-- -->

> **Model Selection**: Check the **Story Dispatch Table** for this Story's
> `recommendedModel`. Select that model for your current session.

### Step 1 — Implementation (Sequential Task Loop)

For **each child Task** in the order returned by `sprint-story-init.js`:

1. Read the full `## Instructions` section of the Task ticket.
2. Implement all described changes strictly within the scope of the Story
   branch.
3. Commit after completing each Task with a message referencing the Task ID.
   **Always assert the branch and stage explicitly** — under parallel story
   execution, another agent may have switched the working directory between your
   edits and your commit. `git add .` would then sweep their WIP into your
   commit.

   ```powershell
   # 1. Guard: halt if the working dir was switched by another agent.
   node .agents/scripts/assert-branch.js --expected story-<storyId>

   # 2. Stage: prefer explicit paths for the files you edited in this Task.
   #    Fallback: `git add -u` stages tracked edits only (never untracked —
   #    untracked files in a shared working tree almost always belong to
   #    another agent). Add new files you created by explicit path only.
   git add <path/one> <path/two>
   # or, for tracked edits only:
   # git add -u

   git commit --no-verify -m "feat(<scope>): <task title> (resolves #<taskId>)"
   ```

4. Proceed to the next Task in the Story.

### Step 2 — Validate

After all Tasks are implemented, run shift-left validation:

```powershell
npm run lint
npm test
```

If tests or lint fail:

- Fix the issues and commit corrections.
- If blocked (e.g., upstream dependency missing): post a friction comment and
  apply `status::blocked`.

### Step 3 — Close (`sprint-story-close.js`)

Run the closure script to merge, clean up branches, and close all tickets. This
single command replaces the manual merge, branch deletion, and cascade
completion:

```powershell
node .agents/scripts/sprint-story-close.js --story <storyId>
```

The script:

- Checks for `risk::high` — if set, creates a PR instead of auto-merging and
  exits with code 1 (manual review required).
- Merges the Story branch into `epic/<epicId>` with `--no-ff`.
- Pushes the Epic branch.
- Deletes the Story branch (local + remote).
- Batch transitions all child Tasks and the Story to `agent::done`.
- Runs `cascadeCompletion()` to propagate closure up the hierarchy.
- Runs `health-monitor.js` to update sprint metrics.
- Regenerates the Epic dispatch manifest (`temp/dispatch-manifest-<epicId>.md`
  and `.json`) by default. Pass `--skip-dashboard` to suppress this step.

**Output**: Structured JSON with `ticketsClosed[]`, `cascadedTo[]`, merge
status.

> **Why not use GitHub auto-close?** GitHub's `Closes #N` syntax only works when
> merging into the repository's **default branch** (`main`). Since Story
> branches merge into `epic/<epicId>` (not `main`), we must close tickets
> explicitly via the state writer.

---

## Constraint

- **Never** push Story branch work directly to `main`.
- **Never** merge across Story branches — each Story is self-contained.
- **Always** verify `git branch --show-current` outputs the expected Story
  branch name before making any commits. If it does not, **STOP**.
- **Always** use `git checkout -B` (uppercase) when creating Story branches to
  safely handle stale local branches from prior sessions.
- **Always** validate (lint + test) before merging into the Epic branch.
- **Always** select the model recommended by the Story Dispatch Table for the
  session.
- **Always** run cascadeCompletion after merging — GitHub cannot auto-close
  tickets on non-default branch merges.
- **Always** delete the Story branch (local + remote) after merging into the
  Epic branch.
- **MCP Fallback**: If `agent-protocols` MCP tools fail due to connection
  errors, **fall back immediately** to
  `node .agents/scripts/update-ticket-state.js --task <id> --state <state>`
  (which also auto-cascades completion when `--state agent::done`). Do not leave
  tickets in stale states.
