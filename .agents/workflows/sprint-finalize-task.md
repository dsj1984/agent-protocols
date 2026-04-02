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
3.  Resolve `[TASK_STATE_ROOT]` from the `taskStateRoot` field in
    `.agents/config/config.json` (default: `temp/task-state`).

## Step 1 - Branch Guard

1. **Branch Guard**: Before ANY git operations, verify you are NOT on the base
   branch (defined as "baseBranch" in .agents/config/config.json). Run
   `git branch --show-current`. If the result is the base branch, **STOP
   IMMEDIATELY** and alert the user. All sprint work MUST happen on
   `sprint-[NUM]` or a `sprint-[NUM]/[TASK_ID]` feature branch.
2. **Validation**: Ensure all validation and pre-commit hooks pass. Run the
   command defined as "validationCommand" in .agents/config/config.json
   (default: `pnpm turbo run lint`). Fix any resulting errors.
3. **Shift-Left Testing**: Run the command defined as "testCommand" in
   .agents/config/config.json (default: `pnpm turbo run test`).
   - If tests fail: Stop immediately and fix the tests before finalizing.
   - If tests pass: Proceed to the next step.
4. **Branch & Commit**: Create a new isolated branch for your task FROM the
   sprint base using the **STRICT** naming convention:
   `git checkout sprint-[SPRINT_NUMBER] ; git checkout -b task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - **Note**: Use the `task/` prefix and a FORWARD SLASH (`/`) as the primary
     separators. Stage your changes and commit using standard conventional
     commits: `[type]([scope]): [lowercase conventional commit message]`.
5. **Push Feature Branch**: Push your code upstream: `git push -u origin HEAD`.
6. **State Sync**: Switch back to `sprint-[NUM]`. Execute `git pull --rebase` to
   fetch any state updates from sibling agents.
7. **Update Task State (Decoupled)**:
   - Ensure the state directory exists: `mkdir -p [TASK_STATE_ROOT]`.
   - Create or update the JSON state file at `[TASK_STATE_ROOT]/[TASK_ID].json`
     with the current state:
     `{ "status": "committed", "timestamp": "[ISO_TIMESTAMP]" }`.
   - **Test Receipt**: Create a JSON test receipt at
     `[TASK_STATE_ROOT]/[TASK_ID]-test-receipt.json` confirming the green state:
     `{ "status": "passed", "timestamp": "[ISO_TIMESTAMP]", "task": "[TASK_ID]" }`.
   - **Note**: This decoupled approach prevents git merge conflicts when
     multiple agents are finalizing tasks simultaneously.
8. **Commit State**:
   - **If `[TASK_STATE_ROOT]` is within `/temp/`**: Skip Git operations for the
     state file (it is local-only).
   - **If `[TASK_STATE_ROOT]` is NOT in a Git-ignored directory**: Stage and
     commit the state files:
     `git add [TASK_STATE_ROOT]/[TASK_ID].json [TASK_STATE_ROOT]/[TASK_ID]-test-receipt.json ; git commit -m "chore(task): mark [TASK_ID] as committed with test receipt"`.
     Push this tracking commit upstream: `git push`. (If it fails, pull --rebase
     and push again).
9. **Notification**: Resolve `[WEBHOOK_URL]` from the `webhookUrl` field in
   `.agents/config/config.json`. If `webhookUrl` is not empty, send a
   notification using the cross-platform Node script:
   - **Protocol**:
     `node .agents/scripts/notify.js "[WEBHOOK_URL]" "Sprint step [TASK_ID] was pushed to its feature branch."`
   - **Failure Logging**: If the notification script fails, log the failure in
     `agent-friction-log.json` (JSONL format) in the `[SPRINT_ROOT]` directory
     with fields for `timestamp`, `type` (friction_point), `tool` (notify.js),
     and `error`.
   - If `webhookUrl` is empty, skip gracefully.

## State Progression Reference

| Transition                   | Location           | Triggered By                      |
| ---------------------------- | ------------------ | --------------------------------- |
| Not Started → Executing      | State JSON         | Agent Execution Protocol (Step 2) |
| Executing → Committed        | State JSON         | This workflow (Step 7)            |
| Committed → Complete (`[x]`) | Playbook / Mermaid | `sprint-integration` workflow     |

## Constraint

Do NOT skip any of the steps above. You MUST ensure validation passes, your code
feature branch is pushed, AND the decoupled task state file is committed on the
sprint base branch. Do NOT merge your feature branch code directly into the
sprint base branch — the `sprint-integration` workflow handles all code merging.
