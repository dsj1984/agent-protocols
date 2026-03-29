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
2. **Check Intra-Chat Predecessors**: Identify your assigned task step number
   (e.g., `1.1.3`). Within the same Chat Session (e.g., Chat Session `1`),
   verify that all preceding tasks (e.g., `1.1.1` and `1.1.2`) are marked
   complete with an `[x]`.
3. **Check Cross-Chat Dependencies**: Review the `Fan-Out Flow` diagram and
   dependency notes specified at the top of the playbook. If your Chat Session
   depends on the completion of another Chat Session (for instance, Chat 2
   depends on the completion of Chat 1), verify that _all_ tasks in that
   foundational Chat Session are marked complete with an `[x]`.
4. **Halt on Failure**: If ANY required predecessor or dependent task is
   incomplete (`[ ]`), you must **STOP IMMEDIATELY**. Do not attempt to code.
   Alert the user that the prerequisite check failed and state exactly which
   task is blocking execution.
