---
description:
  Standard validation, commit, completion, and notification workflow for agent
  sprint tasks.
---

# Finalize Sprint Task

When instructed to finalize a sprint task, you must execute the following steps
precisely:

1. **Branch Guard**: Before ANY git operations, verify you are NOT on `main` or
   `master`. Run `git branch --show-current`. If the result is `main` or
   `master`, **STOP IMMEDIATELY** and alert the user. All sprint work MUST
   happen on `sprint-[NUM]` or a `sprint-[NUM]/[TASK_ID]` feature branch.
2. **Validation**: Ensure all validation and pre-commit hooks pass
   (`npm run lint`, etc.). Fix any resulting errors.
3. **Branch & Commit**: Create a new isolated branch for your task FROM the
   sprint base using the **STRICT** naming convention:
   `git checkout sprint-[SPRINT_NUMBER] ; git checkout -b task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - **Note**: Use the `task/` prefix and a FORWARD SLASH (`/`) as the primary
     separators. Stage your changes and commit using standard conventional
     commits: `[type]([scope]): [lowercase conventional commit message]`.
4. **Push Feature Branch**: Push your code upstream: `git push -u origin HEAD`.
5. **State Sync**: Switch back to `sprint-[NUM]`. Execute `git pull --rebase` to
   fetch any state updates from sibling agents.
6. **Update Playbook (Decoupled State)**:
   - Check if directory `docs/sprints/sprint-[NUM]/task-state/` exists.
   - If YES: Create/Update `docs/sprints/sprint-[NUM]/task-state/[TASK_ID].json`
     with `{"status": "committed", "timestamp": "ISO8601"}`.
   - If NO: Open `docs/sprints/sprint-[NUM]/playbook.md`, locate your task and
     change its status from `[~]` to `[/]`, and update the Mermaid diagram class
     from `executing` to `committed`.
7. **Commit State**: Commit ONLY the state update:
   `git add . ; git commit -m "chore(sprint): update task [TASK_ID] status to committed"`.
   Push this tracking commit upstream: `git push`. (If it fails, pull --rebase
   and push again).
8. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in
   the `AGENTS.md` file, make a webhook call to that URL. **You must send a JSON
   payload with a `message` parameter**.
   - **Protocol**: Use the following cross-platform `curl` syntax to ensure
     compatibility with both Bash and PowerShell:
     `curl -s -X POST -H "Content-Type: application/json" -d "{\"message\": \"Sprint step [TASK_ID] was pushed to its feature branch.\"}" $AGENT_NOTIFICATION_WEBHOOK`
   - **Failure Logging**: If the `curl` command fails (exit code != 0), you MUST
     log a short `WEBHOOK_FAILURE.md` file in the sprint directory with the
     timestamp and task ID before proceeding. Do NOT stop the workflow, but
     ensure the failure is documented for audit.
   - If the variable is not set, fail gracefully without error.

## State Progression Reference

| Transition              | Checkbox      | Mermaid Class               | Triggered By                      |
| ----------------------- | ------------- | --------------------------- | --------------------------------- |
| Not Started → Executing | `[ ]` → `[~]` | `not_started` → `executing` | Agent Execution Protocol (Step 2) |
| Executing → Committed   | `[~]` → `[/]` | `executing` → `committed`   | This workflow (Step 6)            |
| Committed → Complete    | `[/]` → `[x]` | `committed` → `complete`    | `sprint-integration` workflow     |

## Constraint

Do NOT skip any of the steps above. You MUST ensure validation passes, your code
feature branch is pushed, AND the playbook on `sprint-[NUM]` is updated with
`- [/]`. Do NOT merge your feature branch code directly into `sprint-[NUM]` —
the `sprint-integration` workflow handles all code merging.
