---
description: >-
  Standard validation, commit, completion, and notification workflow for agent
  sprint tasks. Integrates with update-ticket-state.js for v5 GitHub-native
  state management.
---

# Sprint Finalize Task

When instructed to finalize a sprint task, execute the following steps
precisely. This workflow integrates with the **v5 State Sync Engine** —
`update-ticket-state.js` — to synchronize progress directly to GitHub.

## Step 0 — Resolve Configuration

1. Resolve `[TASK_ID]` — the GitHub Issue number of the Task being finalized.
2. Resolve `[EPIC_ID]` — from the Task body `## Metadata` → `Epic: #<N>`.
3. Resolve `[TASK_BRANCH]` — `task/epic-<epicId>/<taskId>`.
4. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
5. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
6. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json` (default:
   `.agents/scripts`).

## Step 1 — Branch Guard

1. **Branch Guard**: Before ANY git operations, verify you are on the correct
   Task feature branch.

   ```powershell
   git branch --show-current
   ```

   If the result is `main`, `[EPIC_BRANCH]`, or any other non-Task branch,
   **STOP IMMEDIATELY** and alert the operator. All Task implementation work
   MUST occur on `[TASK_BRANCH]`.

2. **Sync**: Pull the latest from the Epic base branch via rebase:

   ```powershell
   git pull --rebase origin [EPIC_BRANCH]
   ```

   If there are conflicts, resolve them, stage, and run `git rebase --continue`.

## Step 2 — Validate

1. **Lint check**: Ensure no new lint issues have been introduced.

   ```powershell
   npm run lint
   ```

2. **Tests**: Run the full test suite.

   ```powershell
   npm test
   ```

   If either command fails: fix the issues and commit the fixes before
   continuing.

## Step 3 — Commit & Push

1. Stage and commit all changes:

   ```powershell
   git add .
   git commit --no-verify -m "feat(<scope>): <task title> (resolves #[TASK_ID])"
   ```

2. Push the feature branch upstream:

   ```powershell
   git push --force-with-lease -u origin [TASK_BRANCH]
   ```

## Step 4 — Create Pull Request

Create a Pull Request against `[EPIC_BRANCH]` (the Epic base branch, **not**
`main`):

- **Title**: `feat: <Task title>`
- **Body** must include: `Closes #[TASK_ID]`
- **Reviewer**: Set to `operatorHandle` from `orchestration.github` in
  `.agentrc.json`

Use the GitHub MCP tool or the provider to create PR programmatically.

## Step 5 — State Sync (v5)

Use the `update-ticket-state.js` state writer to sync progress to GitHub. These
are programmatic calls within the agent loop (or via temporary inline Node
scripts):

1. **Post a progress comment** on the Task ticket with the PR link:

   ```javascript
   // postStructuredComment([TASK_ID], 'progress', 'PR created: <PR_URL>. Implementation complete, awaiting review.')
   ```

2. **Transition the Task label** to `agent::review`:

   ```javascript
   // transitionTicketState([TASK_ID], 'agent::review')
   ```

3. **Toggle the tasklist checkbox** in the parent Story body:

   ```javascript
   // toggleTasklistCheckbox([STORY_ID], [TASK_ID], true)
   ```

   Resolve `[STORY_ID]` from the Task body `## Metadata` → `Story: #<N>`.

> **Note:** After merge, `cascadeCompletion([TASK_ID])` should be triggered to
> propagate `agent::done` up through the Story → Feature → Epic hierarchy. This
> is typically called by the `/sprint-integration` bookend workflow.

## Step 6 — Notification

If `notificationWebhookUrl` is configured in `.agentrc.json`, fire a
notification:

```powershell
node [SCRIPTS_ROOT]/notify.js "[TASK_ID]: Task implementation complete. PR open for review."
```

If the notification fails, log it:

```powershell
node [SCRIPTS_ROOT]/log-friction.js "agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"
```

If `notificationWebhookUrl` is empty, skip gracefully.

## Step 7 — For Risk::High Tasks

If the Task has a `risk::high` label:

- **Do not** proceed to cascade. Remain at `agent::review`.
- The operator must manually approve the PR before the state writer's
  `cascadeCompletion` is triggered.
- Post a HITL gate comment on the ticket:

  ```javascript
  // postStructuredComment([TASK_ID], 'notification', '⚠️ HITL Gate: This task is risk::high. Awaiting operator approval before cascade.')
  ```

## State Progression Reference

| Transition                           | Mechanism                              | Triggered By             |
| ------------------------------------ | -------------------------------------- | ------------------------ |
| `agent::ready` → `agent::executing`  | `transitionTicketState`                | `/sprint-execute` Step 1 |
| `agent::executing` → `agent::review` | `transitionTicketState` (Step 5 above) | This workflow            |
| `agent::review` → `agent::done`      | `cascadeCompletion` (after PR merge)   | `/sprint-integration`    |
| Parent auto-completion cascade       | `cascadeCompletion` (recursive)        | `/sprint-integration`    |

## Constraint

- Do **not** merge the Task branch directly into `main`. The
  `/sprint-integration` bookend workflow handles all merges.
- Do **not** skip the state sync steps. GitHub is the Single Source of Truth.
- Do **not** call the legacy `update-task-state.js` script — it is deprecated in
  v5 and will be removed in Sprint 3F.
