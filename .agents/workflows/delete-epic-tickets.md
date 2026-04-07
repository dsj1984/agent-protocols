---
description: >-
  Clear out an Epic by deleting all child issues (Features, Stories, Tasks) but
  NOT the Epic itself, using the delete-epic.js engine.
---

# Clear Epic Tickets Workflow

This workflow provides a mechanism to permanently remove **all child issues**
(PRD, Tech Spec, Features, Stories, Tasks) associated with an Epic, while
**keeping the Epic issue itself** (effectively "clearing it out" for
re-planning).

> [!CAUTION] This action is irreversible on GitHub.
>
> **When to run**: When an Epic needs to be reset/cleared of its children
> without deleting the root Epic ticket.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 1 — Confirmation

Confirm with the operator that they want to delete the GitHub issues.

## Step 2 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the number of the Epic issue to delete.

## Step 3 — Delete GitHub Issues (Dry Run)

Run the delete-epic script in dry-run mode to audit which issues will be
removed.

```powershell
node .agents/scripts/delete-epic.js [EPIC_ID] --exclude-root --dry-run
```

Review the output with the operator for final approval.

## Step 4 — Delete GitHub Issues (Live)

Once approved, execute the live deletion.

```powershell
node .agents/scripts/delete-epic.js [EPIC_ID] --exclude-root
```

## Constraint

Always perform a dry run (Step 3) before live deletion (Step 4).
