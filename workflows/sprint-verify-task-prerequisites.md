---
description:
  Ensure that all mandatory tasks and dependencies have been completed before
  starting a new sprint task.
---

<!-- // turbo-all -->

# Sprint Verify Task Prerequisites

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.
3.  Resolve `[TASK_STATE_ROOT]` from the `taskStateRoot` field in
    `.agentrc.json` (default: `temp/task-state`).

## Step 1 - Pre-flight Checks

Before an agent begins performing file modifications for a sprint task in the
`playbook.md`, it MUST execute the following pre-flight checks:

1. **Locate the Playbook**: Open the sprint playbook (located at
   `[SPRINT_ROOT]/playbook.md`).
2. **Branch Validation**: Run `git branch --show-current`. The result MUST be
   `sprint-[SPRINT_NUMBER]`. If you are on the base branch (refer to
   "baseBranch" in .agentrc.json), a feature branch (e.g.,
   `task/sprint-[NUM]/[TASK_ID]`), or a detached HEAD, **STOP** and switch to
   `sprint-[SPRINT_NUMBER]` with
   `git checkout sprint-[SPRINT_NUMBER] ; git pull` before continuing.
3. **Execute Verification Script**: Run the deterministic Node.js script to
   verify that all prerequisite tasks are satisfied (marked as `[x]` in playbook
   or `committed` in decoupled state):
   `node [SCRIPTS_ROOT]/verify-prereqs.js [SPRINT_ROOT]/playbook.md [TASK_ID] [TASK_STATE_ROOT]`
   - If the script exits with `0` (Success), proceed to Step 4.
   - If the script exits with `1` (Failure), **STOP IMMEDIATELY**. Do not
     attempt to write code or bypass the block. Alert the user that the
     prerequisite check failed.
4. **Code Retrieval for Unmerged Dependencies**: If a dependency is marked
   `committed` in its decoupled state file, its code lives on branch
   `task/sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]` but is NOT YET merged into
   `sprint-[SPRINT_NUMBER]`. If your current task requires that code to build
   upon, you MUST:
   - `git fetch origin task/sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]`
   - `git merge origin/task/sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]` into
     your current working branch.
   - If the merge fails due to conflicts, **STOP** and alert the user with the
     exact conflicting files before proceeding.

## State Reference

| Marker / Location      | State       | Blocks Execution?                          |
| ---------------------- | ----------- | ------------------------------------------ |
| `[ ]` (Playbook)       | Not Started | ✅ Yes                                     |
| State JSON `executing` | Executing   | ✅ Yes                                     |
| State JSON `committed` | Committed   | ❌ No — code is pushed to a feature branch |
| `[x]` (Playbook)       | Complete    | ❌ No — code is integrated into main       |

## Constraint

Do NOT attempt to bypass these checks. Out-of-order execution leads to merge
conflicts and regression bugs. If a predecessor is blocked, inform the user
immediately.
