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
2. **Branch & Commit**: Create a new isolated branch for your task:
   `git checkout -b sprint-[SPRINT_NUMBER]/[TASK_ID]`. Stage your changes and
   commit using standard conventional commits:
   `[type]([scope]): [lowercase conventional commit message]`.
3. **Push Feature Branch**: Push your code upstream: `git push -u origin HEAD`.
4. **State Sync**: Switch back to the primary sprint tracking branch (e.g.,
   `main` or `sprint-[NUM]`). Execute `git pull --rebase` to fetch any state
   updates from sibling agents.
5. **Update Playbook (3-State Track)**:
   - Open `.agents/docs/sprints/sprint-[NUM]/playbook.md` (or the equivalent
     Playbook Path).
   - Locate your task and change its status from Pending `- [ ]` to Pushed/Ready
     `- [/]`.
   - In the Mermaid diagram, locate your Chat Session. If it doesn't already
     have a status class, append the `in_progress` class **inside the mermaid
     block** (e.g., add a line `s C4 in_progress` before the closing ` ``` `).
6. **Commit State**: Commit ONLY the playbook update:
   `git commit -am "chore(sprint): update task status to pushed"`. Push this
   state tracking commit upstream: `git push`. (If it fails due to concurrent
   edits from other agents, run `git pull --rebase` and try pushing again).
7. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in
   the `AGENTS.md` file, make a webhook call to that URL. **You must send a JSON
   payload with a `message` parameter**. Example:
   `curl -X POST -H "Content-Type: application/json" -d '{"message": "Sprint step [TASK_ID] was pushed to its feature branch."}' $AGENT_NOTIFICATION_WEBHOOK`
   If the variable is not set, fail gracefully without error.

## Constraint

Do NOT skip any of the steps above. You MUST ensure validation passes, your code
feature branch is pushed, AND the separate state tracking branch is updated with
`- [/]`. Do NOT merge your feature branch code directly into `main` (the
Integration hook will handle code merging).
