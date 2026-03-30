---
description:
  Ensure that all mandatory tasks and dependencies have been completed before
  starting a new sprint task.
---

# Verify Sprint Prerequisites

Before an agent begins performing file modifications for a sprint task in the
`playbook.md`, it MUST execute the following pre-flight checks:

1. **Locate the Playbook**: Open the sprint playbook (e.g.,
   `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`).
2. **Check Dependencies**: Look at your assigned task instructions. There is an
   explicit list of pre-requisite task numbers under the `Dependencies` block in
   the AGENT EXECUTION PROTOCOL.
3. **Verify Dependencies**: You MUST verify that every task ID listed in the
   `Dependencies` block has a marked `[x]` (Complete) in the `playbook.md`. If
   any dependent task is marked `[ ]` (Not Started), `[~]` (Executing), or `[/]`
   (Committed), you MUST **STOP IMMEDIATELY** and alert the user.
4. **Check Intra-Chat Predecessors**: Within the same sequential Chat Session
   (e.g., Chat Session `1`), verify that every numerically preceding task (e.g.,
   if you are `1.1.2`, check `1.1.1`) is also marked complete with an `[x]`.
5. **Halt on Failure**: If ANY required predecessor or dependent task is not
   complete (`[x]`), you must **STOP IMMEDIATELY**. Do not attempt to code.
   Alert the user that the prerequisite check failed and state exactly which
   specific task number is blocking your execution.

## State Reference

| Marker | State       | Blocks Execution?            |
| ------ | ----------- | ---------------------------- |
| `[ ]`  | Not Started | ✅ Yes                       |
| `[~]`  | Executing   | ✅ Yes                       |
| `[/]`  | Committed   | ✅ Yes                       |
| `[x]`  | Complete    | ❌ No — dependency satisfied |

## Constraint

Do NOT attempt to bypass these checks. Out-of-order execution leads to merge
conflicts and regression bugs. If a predecessor is blocked, inform the user
immediately.
