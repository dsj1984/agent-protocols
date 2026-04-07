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

Identify all Story branches for this Epic. Unlike legacy tasks, stories
consolidate multiple tasks into a single branch:

```powershell
git branch -r --list "origin/story/epic-[EPIC_ID]/*"
```

For each branch found, identify the constituent `[TASK_ID]` labels by querying
the Story's child tickets on GitHub.

## Step 3 — Prerequisite Gate (Ticket State Check)

For each Story branch discovered, verify that at least one of its constituent
Tasks is `agent::done` before it is eligible for integration.

A Story branch is eligible if:

- Its tasks relevant to this integration wave are labeled `agent::done`.
- Its PR (if any) is ready for consolidation.

## Step 4 — Ephemeral Candidate Verification

For each eligible Story, run the integration script for one of its Tasks. The
script automatically resolves the shared Story branch:

```powershell
node [SCRIPTS_ROOT]/sprint-integrate.js --epic [EPIC_ID] --task [TASK_ID]
```

The script performs the full candidate verification loop: creates an ephemeral
candidate branch, merges the Story branch (which includes all completed tasks
within that story), runs validation + tests, and either consolidates (on
success) or rolls back (on failure).

**Exit codes:**

- **0 — Build Green**: Story branch successfully merged into Epic base.
- **1 — Build Broken**: Blast-radius contained, friction logged. Immediately
  transition into `/sprint-hotfix`.
- **2 — Major Conflict**: **STOP**. Alert the operator.

## Step 5 — Conflict Marker Scan

After all merges, scan for unresolved conflict markers:

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

## Step 6 — State Sync (v5)

For every Task within the Story branch that was successfully merged, sync state
to GitHub:

```javascript
// For each taskId in story:
// transitionTicketState(taskId, 'agent::done')
// cascadeCompletion(taskId)
```

This propagates `agent::done` status up through Story → Feature → Epic
automatically.

## Step 7 — Commit & Push

Commit the integration state and push:

```powershell
git commit -am "chore(epic-[EPIC_ID]): integrate story branches"
git push origin epic/[EPIC_ID]
```

## Step 8 — Branch Cleanup

Delete the remote Story branches that were successfully integrated:

```powershell
git push origin --delete story/epic-[EPIC_ID]/[STORY_SLUG]
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
