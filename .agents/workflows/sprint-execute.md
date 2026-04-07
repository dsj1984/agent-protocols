---
description: >-
  Execute a sprint in two modes: Epic-level (output Dispatch Manifest and launch
  story waves) or Story-level (implement all Tasks within a single Story).
---

# /sprint-execute

## Overview

This workflow operates in two modes determined by the argument provided:

- **`/sprint-execute [Epic ID]`** — Epic-level orchestration. Fetches all Tasks
  under the Epic, schedules them into dependency-ordered waves, groups them by
  parent Story, and outputs a **Story Dispatch Table** with model
  recommendations. Re-run after each wave to advance progress. Automatically
  enters the **Bookend Lifecycle** once all Tasks reach `agent::done`.

- **`/sprint-execute #[Story ID]`** — Story-level execution. Checks out the
  Story branch, implements ALL child Tasks sequentially in a single session,
  validates, creates a unified PR, and transitions tickets to `agent::review`.

---

## Mode A: Epic-Level Dispatch (`/sprint-execute [Epic ID]`)

### Step 0 — Resolve Configuration

1. Read `.agentrc.json` and resolve `orchestration`, `agentSettings`, and
   `bookendRequirements`.
2. Instantiate the ticketing provider via:

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId> --dry-run
   ```

   Review the printed **Story Dispatch Table** to confirm the wave plan and
   recommended models before live dispatch.

3. To run a live wave dispatch:

   ```powershell
   node .agents/scripts/dispatcher.js --epic <epicId>
   ```

4. The manifest JSON is written to `temp/dispatch-manifest-<epicId>.json`.
   The **Story Dispatch Table** printed to stdout shows each Story's model
   tier, recommended model, and branch — use this to select the correct model
   when starting Story-level execution.

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
2. **Model Selection**: Check the Story Dispatch Table (from Mode A output) for
   this Story's `recommendedModel`. Select that model before starting the
   session.
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
2. Implement all described changes strictly within the scope of the Story branch.
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

### Step 4 — Commit & PR

1. Push the Story branch:

   ```powershell
   git push --force-with-lease origin HEAD
   ```

2. Check if a Pull Request already exists for this branch:

   ```powershell
   gh pr list --head <storyBranch> --json url,number
   ```

3. **If no PR exists**: Create one against the Epic base branch
   (`epic/<epicId>`) — **not** `main`. The PR description **must** include
   `Closes #<taskId>` for EVERY child Task implemented.

4. **If a PR already exists**: Ensure all Task IDs are listed in the PR
   description.

5. Post a progress comment summarising the work:

   ```powershell
   node -e "
     import { postStructuredComment } from './.agents/scripts/update-ticket-state.js';
     postStructuredComment(<storyId>, 'progress', 'All tasks committed to branch <storyBranch>. PR: <PR_URL>');
   "
   ```

### Step 5 — Finalize State

1. Transition the Story to `agent::review`:

   ```powershell
   # transitionTicketState(<storyId>, 'agent::review')
   ```

2. **If `risk::high`**: Hold at `agent::review`; await human merge approval
   before the cascade runs.

3. **On merge**: The `cascadeCompletion()` function in
   `update-ticket-state.js` automatically propagates `agent::done` up the
   hierarchy (Tasks → Story → Feature → Epic).

---

## Constraint

- **Never** push Story branch work directly to `main` or the Epic base branch.
- **Never** merge across Story branches — the `/sprint-integration` bookend
  handles all merges.
- **Always** validate before creating a PR. A PR with failing tests is a
  blocker.
- **Always** select the model recommended by the Story Dispatch Table for the
  session.
