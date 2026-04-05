---
description: >-
  Execute a sprint in two modes: Epic-level (output Dispatch Manifest and launch
  task waves) or Task-level (implement and finalize a single Task ticket).
---

# /sprint-execute

## Overview

This workflow operates in two modes determined by the argument provided:

- **`/sprint-execute [Epic ID]`** — Epic-level orchestration. Fetches all
  Tasks under the Epic, schedules them into dependency-ordered waves, and
  dispatches the next eligible wave. Re-run after each wave to advance progress.
  Automatically enters the **Bookend Lifecycle** once all Tasks reach
  `agent::done`.

- **`/sprint-execute #[Task ID]`** — Task-level execution. Implements a single
  Task ticket end-to-end on its feature branch, validates, creates a PR, and
  transitions the ticket to `agent::review`.

---

## Mode A: Epic-Level Dispatch (`/sprint-execute [Epic ID]`)

### Step 0 — Resolve Configuration

1. Read `.agentrc.json` and resolve `orchestration`, `agentSettings`, and
   `bookendRequirements`.
2. Instantiate the ticketing provider via:

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId> --dry-run
   ```

   Review the printed Dispatch Manifest to confirm the wave plan before live
   dispatch.

3. To run a live wave dispatch:

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId>
   ```

4. The manifest JSON is written to `temp/dispatch-manifest-<epicId>.json`.

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

| Phase        | Workflow                | Config Key        |
| ------------ | ----------------------- | ----------------- |
| Integration  | `/sprint-integration`   | `isIntegration`   |
| QA           | `/sprint-testing`       | `isQA`            |
| Code Review  | `/sprint-code-review`   | `isCodeReview`    |
| Retrospective | `/sprint-retro`        | `isRetro`         |
| Close-Out    | `/sprint-close-out`     | `isCloseSprint`   |

On final close-out:

- A summary comment is posted on the Epic issue.
- A webhook (`INFO: epic-complete`) is fired via `notify.js`.

---

## Mode B: Task-Level Execution (`/sprint-execute #[Task ID]`)

### Step 0 — Context Gathering

1. Fetch Issue `#[Task ID]` in full (title, body, labels, assignees).
2. **Blocker check**: Parse `Blocked By` entries from the `## Metadata` section.
   If any referenced issue is still **open**, **STOP** and report the blocker to
   the operator.
3. **Hierarchy trace**: Read the `## Metadata` section to identify the parent
   Story, Feature, Epic, PRD, and Tech Spec issue numbers. Fetch each and
   review scope, constraints, and acceptance criteria before writing a single
   line of code.

### Step 1 — Branch Setup

1. Determine the Epic base branch: `epic/<epicId>` (parsed from the Task's
   Metadata `Epic:` field).
2. Create (or check out) the Task feature branch:
   `task/epic-<epicId>/<taskId>`.

   ```powershell
   git checkout epic/<epicId>
   git checkout -b task/epic-<epicId>/<taskId>
   ```

3. Transition the task label via the state writer:

   ```powershell
   node .agents/scripts/update-ticket-state.js transitionTicketState <taskId> agent::executing
   ```

   > **Note:** The state writer module exports named functions; call it
   > programmatically from within the agent loop or via a thin CLI wrapper.

### Step 2 — Implementation

1. Read the full `## Instructions` section of the Task ticket.
2. Implement all described changes, strictly within the scope of the Task branch.
3. Do **not** modify files linked to other active Task branches (check
   `focus::` labels for overlap hints).

### Step 3 — Validate

Run shift-left validation per the agentrc config:

```powershell
npm run lint
npm test
```

If tests or lint fail:

- Fix the issues and commit corrections.
- If blocked (e.g., upstream dependency missing): post a friction comment and
  apply `status::blocked`.

### Step 4 — Commit & PR

1. Commit with a conventional message linked to the issue:

   ```powershell
   git add .
   git commit --no-verify -m "feat(<scope>): <task title> (resolves #<taskId>)"
   git push --force-with-lease -u origin HEAD
   ```

2. Create a PR against the Epic base branch (`epic/<epicId>`) — **not** `main`:

   The PR description **must** include: `Closes #<taskId>`.

3. Post a progress comment summarising the work:

   ```powershell
   node -e "
     import { postStructuredComment } from './.agents/scripts/update-ticket-state.js';
     postStructuredComment(<taskId>, 'progress', 'PR created: <PR_URL>. Awaiting review.');
   "
   ```

### Step 5 — Finalize State

1. Transition the Task to `agent::review`:

   ```powershell
   # Via the state writer (programmatic call)
   # transitionTicketState(<taskId>, 'agent::review')
   ```

2. Toggle the tasklist checkbox in the parent Story:

   ```powershell
   # toggleTasklistCheckbox(<storyId>, <taskId>, true)
   ```

3. **If `risk::high`**: Hold at `agent::review`; await human merge approval
   before the cascade runs.

4. **On merge**: The `cascadeCompletion(<taskId>)` function in
   `update-ticket-state.js` automatically propagates `agent::done` up the
   hierarchy (Task → Story → Feature → Epic).

---

## Constraint

- **Never** push Task branch work directly to `main` or the Epic base branch.
- **Never** merge across Task branches — the `/sprint-integration` bookend
  handles all merges.
- **Always** validate before creating a PR. A PR with failing tests is a
  blocker.
