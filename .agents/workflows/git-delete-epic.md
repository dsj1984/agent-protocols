---
description: >-
  Hard reset of an Epic — delete all local/remote branches for the Epic and its
  children (Tasks, Stories, Features). Confirms with the user before proceeding.
---

# Delete Epic Workflow

This workflow provides a **safe, manual cleanup** mechanism for when an Epic
dispatch or lifecycle needs to be completely reset. It deletes both the local
and remote branches associated with the Epic and its children.

> **When to run**: When an Epic needs to be scrapped or reset to the
> pre-dispatch state after a failed orchestration attempt.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 1 — Confirmation

Confirm with the operator that they want to proceed. This is a DESTRUCTIVE
action for git branches and optionally GitHub issues.

> [!WARNING] This will permanently delete branches and (if requested) GitHub
> issues. Ensure all valuable code is backed up or committed elsewhere.

## Step 2 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic to delete.
2. Resolve `[EPIC_BRANCH]` — `epic/[EPIC_ID]`.

## Step 3 — Checkout Stable Branch

Always switch to a stable branch (e.g., `main` or `v5`) before deleting other
branches.

```powershell
git checkout v5
```

## Step 4 — List Branches (Audit)

Identify all branches targeted for deletion.

```powershell
# Local branches
git branch --list "epic/[EPIC_ID]" "task/epic-[EPIC_ID]/*" "feature/epic-[EPIC_ID]/*" "story/epic-[EPIC_ID]/*"

# Remote branches
git branch -r --list "origin/epic/[EPIC_ID]" "origin/task/epic-[EPIC_ID]/*" "origin/feature/epic-[EPIC_ID]/*" "origin/story/epic-[EPIC_ID]/*"
```

## Step 5 — Final Operator Approval

Verify the output of Step 4 with the user. Ask: "Are you sure you want to delete
these branches?"

## Step 6 — Delete Local Branches

```powershell
# Delete the Epic branch if it exists
git branch -D epic/[EPIC_ID]

# Delete all task, feature, and story branches for this epic
git branch --list "task/epic-[EPIC_ID]/*" "feature/epic-[EPIC_ID]/*" "story/epic-[EPIC_ID]/*" | ForEach-Object { git branch -D $_.Trim() }
```

## Step 7 — Delete Remote Branches

```powershell
# Delete the Epic branch on origin
git push origin --delete epic/[EPIC_ID]

# Delete all child branches on origin
git branch -r --list "origin/task/epic-[EPIC_ID]/*" "origin/feature/epic-[EPIC_ID]/*" "origin/story/epic-[EPIC_ID]/*" | ForEach-Object {
    $branch = $_.Trim() -replace 'origin/', ''
    git push origin --delete $branch
}
```

## Step 8 — Ticket Pruning (Optional)

If the user also requested deleting the GitHub issues themselves:

```powershell
# Delete the Epic issue
gh issue delete [EPIC_ID] --confirm

# Delete children (Finding them via the 'epic: #[EPIC_ID]' reference in body)
gh issue list --search "body:'epic: #[EPIC_ID]'" --json number --jq '.[].number' | ForEach-Object {
    gh issue delete $_ --confirm
}
```

## Constraint

Do **not** run this workflow if there is any work on the branches that has not
been merged but needs to be saved. Always perform Step 4 (Listing) and Step 5
(Approval) before executing deletions. This workflow is intended as a "nuclear
option" for failed dispatches.
