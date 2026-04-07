---
description: >-
  Final Epic closure — merge the Epic base branch to main, close the Epic issue
  via GitHub provider, clean up branches, and tag a release.
---

# Sprint Close Out

This workflow is the **terminal step** of the Epic lifecycle. It promotes the
fully integrated and reviewed `epic/<epicId>` branch into `main`, closes the
Epic GitHub issue, cleans up all sprint branches, and optionally tags a release.

> **When to run**: After the Retrospective is finalized and all Bookend phases
> (Integration, QA, Code Review, Retro) are complete.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic to close.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.

## Step 1 — Completeness Gate (Ticket State Check)

Before executing any git operations, verify all Tasks under the Epic are
`agent::done`:

```javascript
// const tasks = await provider.getTickets(epicId, { label: 'type::task' });
// const incomplete = tasks.filter(t => !t.labels.includes('agent::done'));
// If incomplete.length > 0: STOP and report to operator.
```

If ANY Task is not `agent::done`: **STOP IMMEDIATELY.** Alert the operator with
the exact incomplete Task IDs and their current labels.

## Step 2 — Final Integration Audit

Confirm all Task branches have been merged into the Epic base:

```powershell
git branch -r --list "origin/task/epic-[EPIC_ID]/*"
```

For each remaining branch, check for unmerged commits:

```powershell
git log epic/[EPIC_ID]..origin/task/epic-[EPIC_ID]/[TASK_ID] --oneline
```

If any branch has unmerged commits: **STOP**. Run `/sprint-integration` one
final time before proceeding.

## Step 3 — Merge Epic Branch to Main

```powershell
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git merge --no-ff epic/[EPIC_ID] -m "chore(release): merge epic/[EPIC_ID] into [BASE_BRANCH]"
```

## Step 4 — Conflict Marker Scan

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

If markers are found: resolve them, stage with `git add`, and amend the merge
commit before proceeding.

## Step 5 — Push Main

```powershell
git push origin [BASE_BRANCH]
```

## Step 6 — Close Planning Tickets (PRD and Tech Spec)

Before closing the Epic itself, close all planning tickets associated with it.
These are tickets labeled `context::prd` or `context::tech-spec` that have the
Epic as their parent.

```powershell
$env:GITHUB_TOKEN=...
# Transition each planning ticket to agent::done (which closes it)
node [SCRIPTS_ROOT]/update-ticket-state.js --task [PRD_TICKET_ID] --state "agent::done"
node [SCRIPTS_ROOT]/update-ticket-state.js --task [TECH_SPEC_TICKET_ID] --state "agent::done"
```

To discover planning ticket IDs automatically, query for sub-issues of the Epic
with the relevant labels:

```javascript
// const planningTickets = await provider.getSubTickets([EPIC_ID]);
// const toClose = planningTickets.filter(t =>
//   t.labels.includes('context::prd') || t.labels.includes('context::tech-spec')
// );
// for (const t of toClose) { await transitionTicketState(t.id, STATE_LABELS.DONE); }
```

If no planning tickets exist, skip gracefully.

## Step 7 — Close the Epic via Provider

Use the ticketing provider to close the Epic issue with a summary comment:

```javascript
// postStructuredComment([EPIC_ID], 'notification',
//   '🎉 Epic #[EPIC_ID] has been shipped. Branch merged to main. All tasks complete.')
// await provider.updateTicket([EPIC_ID], { state: 'closed' })
```

This closes the GitHub issue, making the Epic read-only in the ticket graph.

## Step 8 — Tag Release (If Applicable)

If the Epic corresponds to a versioned release (check `package.json` version):

```powershell
git tag -a "v[VERSION]" -m "Release: Epic #[EPIC_ID] — [Epic Title]"
git push origin "v[VERSION]"
```

Resolve `[VERSION]` from `package.json`. Only tag if the version was bumped
during the Epic implementation.

## Step 9 — Branch Cleanup

Delete the Epic base branch and all remaining Task branches:

```powershell
git branch -d epic/[EPIC_ID]
git push origin --delete epic/[EPIC_ID]
```

For any remaining Task feature branches:

```powershell
git push origin --delete task/epic-[EPIC_ID]/[TASK_ID]
```

Run `git branch -r` to confirm no `task/epic-[EPIC_ID]/*` or `epic/[EPIC_ID]`
branches remain on origin.

## Step 10 — Local Temp Cleanup

Purge any local ephemeral state generated during this Epic:

```powershell
node -e "
  import { rmSync } from 'node:fs';
  rmSync('temp/task-state', { recursive: true, force: true });
  rmSync('temp/workspaces', { recursive: true, force: true });
  rmSync('temp/event-streams', { recursive: true, force: true });
  console.log('Temp state purged.');
"
```

## Step 11 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```

If the command fails, log friction:

```powershell
node [SCRIPTS_ROOT]/log-friction.js "agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"
```

If `notificationWebhookUrl` is empty, skip gracefully.

## Constraint

Do **not** execute this workflow unless ALL Bookend phases (Integration, QA,
Code Review, Retro) have been completed and the Completeness Gate (Step 1)
passes. Do **not** close the Epic via the GitHub UI — always use the provider so
the closure is auditable in the v5 state sync log. This is the only authorized
step for merging Epic branches to `main`.
