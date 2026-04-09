---
description: >-
  Delete all local and remote branches associated with an Epic and its children
  (Tasks, Stories, Features).
---

# Delete Epic Branches Workflow

This workflow provides a manual cleanup mechanism specifically for **Git
branches** when an Epic needs to be reset. It deletes both local and origin
branches for the Epic and its full hierarchy.

> **When to run**: When an Epic needs to be scrapped or reset, but you want to
> handle branch deletion independently of issue deletion.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 1 — Confirmation

Confirm with the operator that they want to delete branches.

> [!WARNING] This will permanently delete branches. Ensure all valuable code is
> backed up or committed elsewhere.

## Step 2 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic.
2. Resolve `[EPIC_BRANCH]` — `epic/[EPIC_ID]`.

## Step 3 — Checkout Stable Branch

Always switch to a stable branch (e.g., `main` or `v5`) before deletion.

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

Verify the output of Step 4. Ask: "Are you sure you want to delete these
branches?"

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

## Constraint

Do **not** run this workflow if there is unmerged work that needs saving. Always
perform Step 4 (Audit) and Step 5 (Approval) before deletion.
