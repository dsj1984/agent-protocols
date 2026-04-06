---
description: >-
  Automated consolidation of Epic Task branches into the Epic base branch, with
  v5 GitHub-native state sync via update-ticket-state.js.
---

# Sprint Integration

This workflow consolidates all Task feature branches for an Epic into the Epic
base branch (`epic/<epicId>`). It **must** run before any Bookend Lifecycle
phases (QA, Code Review, Retro, Close-Out) begin. Re-run it if any hotfix
creates a new commit on a Task branch after initial integration.

> **When to run**: Called automatically by `/sprint-execute` once all Tasks
> reach `agent::done`, or manually by the operator.

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic being integrated.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.
5. Resolve `[MAX_RETRY]` from `frictionThresholds.maxIntegrationRetries` in
   `.agentrc.json` (default: 2).

## Step 1 — Environment Reset

Ensure you are on the Epic base branch with the latest state:

```powershell
git checkout epic/[EPIC_ID]
git pull origin epic/[EPIC_ID]
```

## Step 2 — Branch Discovery

Identify all Task feature branches for this Epic:

```powershell
git branch -r --list "origin/task/epic-[EPIC_ID]/*"
```

For each branch found, extract the `[TASK_ID]` from the branch name suffix.

## Step 3 — Prerequisite Gate (Ticket State Check)

For each Task branch discovered, verify the corresponding GitHub ticket is
`agent::done` before it is eligible for integration:

```javascript
// const ticket = await provider.getTicket(taskId);
// const isDone = ticket.labels.includes('agent::done');
// If NOT done: skip this branch and log friction.
```

A Task branch is only eligible if:

- Its ticket is labeled `agent::done`.
- Its PR (if any) has been merged or is approved.

If any Task branch is not yet `agent::done`: log a warning and skip it. Do
**not** block the entire integration on incomplete Tasks — integrate what is
ready.

## Step 4 — Ephemeral Candidate Verification

For each eligible Task branch, run the integration script:

```powershell
node [SCRIPTS_ROOT]/sprint-integrate.js --epic [EPIC_ID] --task [TASK_ID]
```

The script performs the full candidate verification loop: creates an ephemeral
candidate branch, merges the Task branch, runs validation + tests, and either
consolidates (on success) or rolls back (on failure).

**Exit codes:**

- **0 — Build Green**: Task branch successfully merged into Epic base. Proceed
  to the next branch.
- **1 — Build Broken**: Blast-radius contained, friction logged. Immediately
  transition into `/sprint-hotfix`, then re-run this workflow.
- **2 — Major Conflict**: **STOP**. Alert the operator with the exact
  conflicting files and branches. Do not proceed until resolved manually.

**Retry limit**: If a single Task branch has failed integration more than
`[MAX_RETRY]` times, escalate to the operator immediately.

## Step 5 — Conflict Marker Scan

After all merges, scan for unresolved conflict markers:

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

If markers are found: resolve them manually, stage with `git add`, and amend the
merge commit before proceeding.

## Step 6 — State Sync (v5)

For every Task branch that was successfully merged, sync state to GitHub using
the `update-ticket-state.js` state writer:

```javascript
// transitionTicketState(taskId, 'agent::done')   // if not already done
// toggleTasklistCheckbox(storyId, taskId, true)   // check off in parent Story
// postStructuredComment(taskId, 'progress', 'Branch integrated into epic/[EPIC_ID].')
```

Then trigger the parent completion cascade for each integrated Task:

```javascript
// cascadeCompletion(taskId)
```

This propagates `agent::done` status up through Story → Feature → Epic
automatically if all siblings are also done.

## Step 7 — Commit & Push

Commit the integration state and push:

```powershell
git commit -am "chore(epic-[EPIC_ID]): integrate all task branches"
git push origin epic/[EPIC_ID]
```

## Step 8 — Branch Cleanup

Delete the remote Task feature branches that were successfully integrated:

```powershell
git push origin --delete task/epic-[EPIC_ID]/[TASK_ID]
```

Repeat for each successfully integrated Task.

## Step 9 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js "Epic #[EPIC_ID]: All task branches integrated into epic/[EPIC_ID]. Bookend Lifecycle starting."
```

If the command fails, log friction:

```powershell
node [SCRIPTS_ROOT]/log-friction.js "agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"
```

If `notificationWebhookUrl` is empty, skip gracefully.

## Constraint

Do **not** skip the Prerequisite Gate (Step 3). Do **not** merge Task branches
that are not `agent::done` — doing so will desync the GitHub ticket graph from
the real codebase. The state sync (Step 6) is the only authorized mechanism for
transitioning ticket labels during the integration phase.
