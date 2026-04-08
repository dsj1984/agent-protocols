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
| Integration   | `/sprint-integration` | `isIntegration` |
| QA            | `/sprint-testing`     | `isQA`          |
| Code Review   | `/sprint-code-review` | `isCodeReview`  |
| Retrospective | `/sprint-retro`       | `isRetro`       |
| Close-Out     | `/sprint-close-out`   | `isCloseSprint` |

On final close-out:

- A summary comment is posted on the Epic issue.
- A webhook (`INFO: epic-complete`) is fired via `notify.js`.

---

## Mode B: Story-Level Execution (`/sprint-execute #[Story ID]`)

### Step 0 — Context Gathering

1. Fetch Issue `#[Story ID]` in full (title, body, labels, assignees).
2. **Model Selection**: Check the **Story Dispatch Table** (printed at the end
   of `/sprint-plan` or `/sprint-execute [Epic ID]`) for this Story's
   `recommendedModel`. Select that model for your current session.
3. **Blocker check**: Parse `Blocked By` entries from the `## Metadata` section.
   If any referenced issue is still **open**, **STOP** and report the blocker to
   the operator.
4. **Hierarchy trace**: Read the `## Metadata` section to identify the parent
   Feature, Epic, PRD, and Tech Spec issue numbers. Fetch each and review scope,
   constraints, and acceptance criteria before writing a single line of code.
5. **Task enumeration**: Fetch all child Tasks of this Story (tickets with
   `parent: #[Story ID]` in their body). These will be implemented sequentially
   in dependency order.

### Step 1 — Branch Setup

1. Identify the Story branch from the **Story Dispatch Table** or compute it:
   - Format: `story/epic-<epicId>/<story-slug>`
2. Fetch and checkout the branch:

   ```powershell
   git fetch origin
   git checkout <storyBranch> || git checkout -b <storyBranch> origin/epic/<epicId>
   ```

3. Transition ALL child Task labels via the state writer:

   ```powershell
   node .agents/scripts/update-ticket-state.js transitionTicketState <taskId> agent::executing
   ```

### Step 2 — Implementation (Sequential Task Loop)

For **each child Task** in dependency order:

1. Read the full `## Instructions` section of the Task ticket.
2. Implement all described changes strictly within the scope of the Story
   branch.
3. Commit after completing each Task with a message referencing the Task ID:

   ```powershell
   git add .
   git commit --no-verify -m "feat(<scope>): <task title> (resolves #<taskId>)"
   ```

4. Transition the completed Task to `agent::done`:

   ```powershell
   node .agents/scripts/update-ticket-state.js transitionTicketState <taskId> agent::done
   ```

5. Proceed to the next Task in the Story.

### Step 3 — Validate

After all Tasks are implemented, run shift-left validation:

```powershell
npm run lint
npm test
```

If tests or lint fail:

- Fix the issues and commit corrections.
- If blocked (e.g., upstream dependency missing): post a friction comment and
  apply `status::blocked`.

### Step 5 — Auto-Merge into Epic Branch

After validation passes, merge the Story branch directly into the Epic base
branch. **No PR is created** — the merge commit serves as the audit trail.

1. Checkout the Epic base branch and pull latest:

   ```powershell
   git checkout epic/<epicId>
   git pull --rebase origin epic/<epicId>
   ```

2. Merge the Story branch with `--no-ff` to preserve the merge commit:

   ```powershell
   git merge --no-ff story/epic-<epicId>/<story-slug> -m "feat: <Story title> (resolves #<storyId>)"
   ```

3. Push the updated Epic branch:

   ```powershell
   git push --no-verify origin epic/<epicId>
   ```

> **If `risk::high`**: Do **not** auto-merge. Instead, create a PR against
> `epic/<epicId>` and hold at `agent::review` until the operator approves. Use:
>
> ```powershell
> gh pr create --head <storyBranch> --base epic/<epicId> --title "feat: <Story title>" --body "Closes #<storyId>"
> ```

### Step 6 — Close Tickets (Cascade Completion)

After the merge, immediately transition all child Tasks and the Story to
`agent::done`. This triggers `cascadeCompletion()` which propagates closure
up through the hierarchy (Tasks → Story → Feature → Epic).

1. Transition each child Task to `agent::done`:

   ```powershell
   node .agents/scripts/update-ticket-state.js --task <taskId> --state agent::done
   ```

2. Transition the Story to `agent::done`:

   ```powershell
   node .agents/scripts/update-ticket-state.js --task <storyId> --state agent::done
   ```

> **Why not use GitHub auto-close?** GitHub's `Closes #N` syntax only works
> when merging into the repository's **default branch** (`main`). Since Story
> branches merge into `epic/<epicId>` (not `main`), we must close tickets
> explicitly via the state writer.

---

## Constraint

- **Never** push Story branch work directly to `main`.
- **Never** merge across Story branches — each Story is self-contained.
- **Always** validate (lint + test) before merging into the Epic branch.
- **Always** select the model recommended by the Story Dispatch Table for the
  session.
- **Always** run cascadeCompletion after merging — GitHub cannot auto-close
  tickets on non-default branch merges.
