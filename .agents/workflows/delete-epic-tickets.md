---
description: >-
  Delete all GitHub issues (Epic and its hierarchy) specifically using the
  recursive delete-epic.js engine.
---

# Delete Epic Tickets Workflow

This workflow provides a mechanism to permanently remove **GitHub issues** (Epic, PRD, Tech Spec, Features, Stories, Tasks) associated with an orchestration attempt.

> [!CAUTION] This action is irreversible on GitHub.

> **When to run**: When an Epic needs to be fully wiped from the ticketing system.
>
> **Persona**: `devops-engineer` · **Skills**: `core/git-workflow-and-versioning`

## Step 1 — Confirmation

Confirm with the operator that they want to delete the GitHub issues.

## Step 2 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the number of the Epic issue to delete.

## Step 3 — Delete GitHub Issues (Dry Run)

Run the delete-epic script in dry-run mode to audit which issues will be removed.

```powershell
node .agents/scripts/delete-epic.js [EPIC_ID] --dry-run
```

Review the output with the operator for final approval.

## Step 4 — Delete GitHub Issues (Live)

Once approved, execute the live deletion.

```powershell
node .agents/scripts/delete-epic.js [EPIC_ID]
```

## Constraint

Always perform a dry run (Step 3) before live deletion (Step 4).
