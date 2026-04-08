---
description: >-
  Final Epic closure — merge the Epic base branch to main, close the Epic issue
  via GitHub provider, clean up branches, and tag a release.
---

# Sprint Close

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

## Step 1 — Completeness Gate (Hierarchy Check)

Before executing any git operations, verify ALL child items under the Epic are
successfully closed:

1. **Tasks**: Must all be `agent::done` and closed.
2. **Stories**: Must all be closed.
3. **Features**: Must all be closed.

```javascript
/*
const allTickets = await provider.getTickets(epicId);
const openChildren = allTickets.filter(t => 
  t.id !== epicId && 
  t.state === 'open' &&
  (t.labels.includes('type::task') || t.labels.includes('type::story') || t.labels.includes('type::feature'))
);

if (openChildren.length > 0) {
  console.error("The following child tickets are still OPEN:");
  openChildren.forEach(t => console.error(` - #${t.id}: ${t.title}`));
  process.exit(1);
}
*/
```

If ANY child ticket is not closed: **STOP IMMEDIATELY.** Alert the operator with
the exact open IDs.

## Step 2 — Pre-Merge Validation

Ensure the code is stable and passes all quality gates on the Epic branch before
merging to `main`.

// turbo
```powershell
npm run lint; npm test
```

If the build fails: **STOP**. Fix the regressions on a hotfix branch and merge
back into the Epic branch before restarting this workflow.

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

## Step 6 — Close Planning & Strategy Tickets

Formally close the PRD and Tech Spec tickets. Note: These were excluded from 
auto-closure during execution to ensure they remained visible to the agents.

```powershell
# Discovery and closure handled by update-ticket-state.js cascade or manual IDs
node [SCRIPTS_ROOT]/update-ticket-state.js --task [PRD_TICKET_ID] --state "agent::done"
node [SCRIPTS_ROOT]/update-ticket-state.js --task [TECH_SPEC_TICKET_ID] --state "agent::done"
```

## Step 7 — Final Epic Closure

Use the ticketing provider to close the Epic issue with a summary comment:

```javascript
// postStructuredComment([EPIC_ID], 'notification',
//   '🎉 Epic #[EPIC_ID] has been shipped. Branch merged to main. All tasks complete.')
// await provider.updateTicket([EPIC_ID], { state: 'closed', state_reason: 'completed' })
```

## Step 8 — Tag Release (If Applicable)

If the Epic corresponds to a versioned release:

```powershell
git tag -a "v[VERSION]" -m "Release: Epic #[EPIC_ID] — [Epic Title]"
git push origin "v[VERSION]"
```

## Step 9 — Branch Cleanup

Delete the Epic base branch and **all** remaining Task and Story branches
(local and remote):

```powershell
# 1. Delete the Epic base branch (local + remote)
git branch -D epic/[EPIC_ID]
git push origin --delete epic/[EPIC_ID]

# 2. Delete all remote task branches for this Epic
git branch -r --list "origin/task/epic-[EPIC_ID]/*" | ForEach-Object { $b = $_.Trim().Replace("origin/", ""); git push origin --delete $b }

# 3. Delete all remote story branches for this Epic
git branch -r --list "origin/story/epic-[EPIC_ID]/*" | ForEach-Object { $b = $_.Trim().Replace("origin/", ""); git push origin --delete $b }

# 4. Delete all local task and story branches for this Epic
git branch --list "task/epic-[EPIC_ID]/*" | ForEach-Object { git branch -D $_.Trim() }
git branch --list "story/epic-[EPIC_ID]/*" | ForEach-Object { git branch -D $_.Trim() }

# 5. Prune stale remote-tracking references
git fetch --prune
```

## Step 10 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```
