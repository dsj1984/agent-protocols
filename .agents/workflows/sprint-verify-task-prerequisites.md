---
description:
  Ensure that all mandatory tasks and dependencies have been completed before
  starting a new sprint task.
---

<!-- // turbo-all -->

# Sprint Verify Task Prerequisites

## Role

Engineer / Dispatcher

## Context

Ensure that all mandatory tasks and dependencies have been completed before
starting a new Task. In v5, dependencies are defined as `blocked by #NNN`
references in the Task ticket body.

## Step 1 — Pre-flight Checks

Before an agent begins performing file modifications for a Task ticket, it MUST 
execute the following pre-flight checks:

1. **Resolve Ticket ID**: identify the `[TASK_ID]` of the current task.
2. **Branch Validation**: Run `git branch --show-current`. The result MUST be
   `task/[EPIC_ID]/[TASK_ID]`. 
3. **Execute Verification Script**: Run the deterministic Node.js script to
   verify that all prerequisite tasks are satisfied (labelled `agent::done`):

   ```powershell
   node .agents/scripts/verify-prereqs.js --task [TASK_ID]
   ```

   - If the script exits with `0` (Success), proceed to Step 4.
   - If the script exits with `1` (Failure), **STOP IMMEDIATELY**. Do not
     attempt to write code or bypass the block. Alert the user that the
     prerequisite check failed.

4. **Code Retrieval for Unmerged Dependencies**: If your task requires code from
   a predecessor that has been merged into the Epic base branch (`epic/[EPIC_ID]`), 
   ensure you have pulled the latest:

   ```powershell
   git fetch origin epic/[EPIC_ID]
   git merge origin/epic/[EPIC_ID]
   ```

   If there are circular dependencies or conflicts, **STOP** and alert the user.

## State Reference

| Label           | State       | Blocks Execution? |
| --------------- | ----------- | ----------------- |
| `agent::ready`  | Ready       | ✅ Yes             |
| `agent::executing` | Executing | ✅ Yes             |
| `agent::review` | Reviewing   | ✅ Yes             |
| `agent::done`   | Complete    | ❌ No              |

## Constraint

Do NOT attempt to bypass these checks. Out-of-order execution leads to merge
conflicts and regression bugs. If a predecessor is blocked, inform the user
immediately.
