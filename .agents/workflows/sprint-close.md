---
description: >-
  Final Epic closure — merge the Epic base branch to main, close all tickets,
  tag a release, clean up branches, and fire the completion notification.
---

# /sprint-close

This workflow is the **terminal step** of the Epic lifecycle. Run it after all
Stories have been merged into `epic/<epicId>` and all bookend phases (Code
Review, Retro) have completed. It promotes the Epic branch into `main`, closes
all remaining open tickets, optionally tags a release, and cleans up the
repository.

> **When to run**: After `/sprint-retro` completes and all bookend phases are
> done. All Tasks must be `agent::done` before this workflow starts.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

---

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic to close.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json` (default:
   `.agents/scripts`).

---

## Step 1 — Completeness Gate

Before any git operations, verify all Tasks under the Epic are `agent::done`.
Run the dispatcher in dry-run mode — it will print the completion percentage:

```powershell
$env:GITHUB_TOKEN=...
node [SCRIPTS_ROOT]/dispatcher.js --epic [EPIC_ID] --dry-run
```

The output must show **100%** progress. If any Task is incomplete:

- **STOP IMMEDIATELY.** Report the incomplete Task IDs and their current labels
  to the operator.
- Do **not** proceed until all Tasks are `agent::done`.

---

## Step 2 — Final Integration Audit

Confirm no unmerged Story branches remain on origin:

```powershell
git fetch origin
git branch -r --list "origin/story/epic-[EPIC_ID]/*"
```

For each branch still listed, check for unmerged commits:

```powershell
git log epic/[EPIC_ID]..origin/story/epic-[EPIC_ID]/[STORY_SLUG] --oneline
```

If any branch has unmerged commits: **STOP**. Resolve via `/sprint-integration`
before proceeding.

---

## Step 3 — Merge Epic Branch to Main

```powershell
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git merge --no-ff epic/[EPIC_ID] -m "chore(release): merge epic/[EPIC_ID] into [BASE_BRANCH] (resolves #[EPIC_ID])"
```

---

## Step 4 — Conflict Marker Scan

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

If markers are found: resolve them, `git add`, and amend the merge commit before
proceeding.

---

## Step 5 — Push Main

```powershell
git push --no-verify origin [BASE_BRANCH]
```

---

## Step 6 — Close Planning Tickets (PRD and Tech Spec)

Close all planning tickets linked to the Epic (labeled `context::prd` or
`context::tech-spec`):

```powershell
$env:GITHUB_TOKEN=...
node [SCRIPTS_ROOT]/update-ticket-state.js --task [PRD_TICKET_ID] --state "agent::done"
node [SCRIPTS_ROOT]/update-ticket-state.js --task [TECH_SPEC_TICKET_ID] --state "agent::done"
```

To discover planning ticket IDs automatically, inspect the Epic's sub-issues for
those labels. If no planning tickets exist, skip gracefully.

---

## Step 7 — Close the Epic

Transition the Epic itself to `agent::done`. The state writer will close the
GitHub issue and post a structured completion comment:

```powershell
$env:GITHUB_TOKEN=...
node [SCRIPTS_ROOT]/update-ticket-state.js --task [EPIC_ID] --state "agent::done"
```

---

## Step 8 — Tag Release (If Applicable)

If the Epic corresponds to a versioned release (check `package.json`):

```powershell
git tag -a "v[VERSION]" -m "Release: Epic #[EPIC_ID] — [Epic Title]"
git push --no-verify origin "v[VERSION]"
```

Resolve `[VERSION]` from `package.json`. Only tag if the version was bumped
during Epic implementation.

---

## Step 9 — Branch Cleanup

Delete the Epic base branch and all remaining Story branches:

```powershell
# Delete local Epic branch
git branch -d epic/[EPIC_ID]

# Delete remote Epic branch
git push --no-verify origin --delete epic/[EPIC_ID]
```

Fetch and prune to confirm all story branches are gone:

```powershell
git fetch origin --prune
git branch -r | Select-String "epic-[EPIC_ID]"
```

The output should be empty.

---

## Step 10 — Local Temp Cleanup

Purge ephemeral state generated during this Epic:

```powershell
node -e "
  import { rmSync } from 'node:fs';
  rmSync('temp/task-state', { recursive: true, force: true });
  rmSync('temp/workspaces', { recursive: true, force: true });
  rmSync('temp/event-streams', { recursive: true, force: true });
  console.log('Temp state purged.');
"
```

---

## Step 11 — Notification

```powershell
node [SCRIPTS_ROOT]/notify.js "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```

If the command fails, log friction:

```powershell
node [SCRIPTS_ROOT]/log-friction.js "agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"
```

If `notificationWebhookUrl` is empty, skip gracefully.

---

## Constraint

- Do **not** run this workflow unless the Completeness Gate (Step 1) passes at
  100% and all bookend phases (Code Review, Retro) are complete.
- Do **not** close the Epic via the GitHub UI — always use the state writer so
  the closure is auditable in the v5 state sync log.
- This is the **only** authorized step for merging Epic branches to `main`.
- Do **not** delete branches before verifying the merge succeeded and `main` is
  up to date on origin.
