---
description:
  Ensure that all mandatory tasks and dependencies have been completed before
  starting a new sprint task.
---

# Sprint Verify Task Prerequisites

Before an agent begins performing file modifications for a sprint task in the
`playbook.md`, it MUST execute the following pre-flight checks:

1. **Locate the Playbook**: Open the sprint playbook (e.g.,
   `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`).
2. **Branch Validation**: Run `git branch --show-current`. The result MUST be
   `sprint-[SPRINT_NUMBER]`. If you are on `main`, `master`, a feature branch
   (e.g., `sprint-[NUM]/[TASK_ID]`), or a detached HEAD, **STOP** and switch to
   `sprint-[SPRINT_NUMBER]` with
   `git checkout sprint-[SPRINT_NUMBER] ; git pull` before continuing.
3. **Check Dependencies**: Look at your assigned task instructions. There is an
   explicit list of pre-requisite task numbers under the `Dependencies` block in
   the AGENT EXECUTION PROTOCOL.
4. **Verify Dependencies**: You MUST verify that every task ID listed in the
   `Dependencies` block has a marked `[/]` (Committed) OR `[x]` (Complete) in
   the `playbook.md`. If any dependent task is marked `[ ]` (Not Started) or
   `[~]` (Executing), you MUST **STOP IMMEDIATELY** and alert the user.
5. **Check Intra-Chat Predecessors**: Within the same sequential Chat Session
   (e.g., Chat Session `1`), verify that every numerically preceding task (e.g.,
   if you are `1.1.2`, check `1.1.1`) is also marked `[/]` (Committed) or `[x]`
   (Complete).
6. **Halt on Failure**: If ANY required predecessor or dependent task is Still
   marked `[ ]` or `[~]`, you must **STOP IMMEDIATELY**. Do not attempt to code.
   Alert the user that the prerequisite check failed and state exactly which
   specific task number is blocking your execution.
7. **Code Retrieval for Unmerged Dependencies**: If a dependency is marked `[/]`
   (Committed), its code lives on branch
   `sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]` but is NOT YET merged into
   `sprint-[SPRINT_NUMBER]`. If your current task requires that code to build
   upon, you MUST:
   - `git fetch origin sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]`
   - `git merge origin/sprint-[SPRINT_NUMBER]/[DEPENDENCY_TASK_ID]` into your
     current working branch.
   - If the merge fails due to conflicts, **STOP** and alert the user with the
     exact conflicting files before proceeding.

## State Reference

| Marker | State       | Blocks Execution?                          |
| ------ | ----------- | ------------------------------------------ |
| `[ ]`  | Not Started | ✅ Yes                                     |
| `[~]`  | Executing   | ✅ Yes                                     |
| `[/]`  | Committed   | ❌ No — code is pushed to a feature branch |
| `[x]`  | Complete    | ❌ No — code is integrated into main       |

## Constraint

Do NOT attempt to bypass these checks. Out-of-order execution leads to merge
conflicts and regression bugs. If a predecessor is blocked, inform the user
immediately.
