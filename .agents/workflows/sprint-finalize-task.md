---
description:
  Standard validation, commit, completion, and notification workflow for agent
  sprint tasks.
---

# Sprint Finalize Task

When instructed to finalize a sprint task, you must execute the following steps
precisely:

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Branch Guard

1. **Branch Guard**: Before ANY git operations, verify you are NOT on the base
   branch (defined as "baseBranch" in .agents/config/config.json). Run
   `git branch --show-current`. If the result is the base branch, **STOP
   IMMEDIATELY** and alert the user. All sprint work MUST happen on
   `sprint-[NUM]` or a `sprint-[NUM]/[TASK_ID]` feature branch.
2. **Validation**: Ensure all validation and pre-commit hooks pass. Run the
   command defined as "validationCommand" in .agents/config/config.json
   (default: `npm run lint`). Fix any resulting errors.
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
   - Check if directory `[SPRINT_ROOT]/task-state/` exists.
   - If YES: Create/Update `[SPRINT_ROOT]/task-state/[TASK_ID].json` with
     `{"status": "committed", "timestamp": "ISO8601"}`.
   - If NO: Open `[SPRINT_ROOT]/playbook.md`, locate your task and change its
     status from `[~]` to `[/]`, and update the Mermaid diagram class from
     `executing` to `committed`.
7. **Commit State**: Commit ONLY the state update:
   `git add . ; git commit -m "chore(sprint): update task [TASK_ID] status to committed"`.
   Push this tracking commit upstream: `git push`. (If it fails, pull --rebase
   and push again).
8. **Notification**: Resolve `[WEBHOOK_URL]` from the `webhookUrl` field in
   `.agents/config/config.json`. If `webhookUrl` is not empty, send a
   notification using the cross-platform Node script:
   - **Protocol**:
     `node .agents/scripts/notify.js "[WEBHOOK_URL]" "Sprint step [TASK_ID] was pushed to its feature branch."`
   - **Failure Logging**: If the notification script fails, log the failure in
     `WEBHOOK_FAILURE.md` in the `[SPRINT_ROOT]` directory.
   - If `webhookUrl` is empty, skip gracefully.

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
