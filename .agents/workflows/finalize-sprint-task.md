---
description:
  Standard validation, commit, completion, and notification workflow for agent
  sprint tasks.
---

# Finalize Sprint Task

When instructed to finalize a sprint task, you must execute the following steps
precisely:

1. **Validation**: Ensure all validation and pre-commit hooks pass
   (`npm run lint`, etc.). Fix any resulting errors.
2. **Commit**: Stage your changes and commit using standard conventional
   commits: `[type]([scope]): [lowercase conventional commit message]`
3. **Completion**: Mark this task as complete (`- [x]`) in `playbook.md`.
4. **Visualize Progress**: If ALL tasks in the current Chat Session are
   complete, locate the Mermaid diagram at the top of `playbook.md` and apply
   the `complete` class to the corresponding node (e.g., `class C1 complete`).
5. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in
   the `AGENTS.md` file, make a webhook call to that URL with a message
   indicating that sprint step `[TASK_ID]` was completed. If the variable is not
   set, fail gracefully without error.

## Constraint

Do NOT skip any of the steps above. You MUST ensure validation passes and the
task is marked as complete in the playbook before considering the set of work
finished.
