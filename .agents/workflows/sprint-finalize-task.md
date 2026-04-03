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
4.  Resolve `[BASE_BRANCH]` from the `baseBranch` field in
    `.agents/config/config.json` (default: `main`).

## Step 1 - Branch Guard

1. **Branch Guard**: Before ANY git operations, verify you are NOT on the base
   branch (defined as "baseBranch" in .agents/config/config.json). Run
   `git branch --show-current`. If the result is the base branch, **STOP
   IMMEDIATELY** and alert the user. All sprint work MUST happen on
   `sprint-[NUM]` or a `sprint-[NUM]/[TASK_ID]` feature branch.
2. **Branch & Commit**: If not already on your feature branch, create it now:
   `git checkout sprint-[SPRINT_NUMBER] ; git checkout -b task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - **Note**: Stage your changes and commit using standard conventional
     commits: `[type]([scope]): [lowercase conventional commit message]`.
3. **Runtime Rebase Wait-Loop**: Ensure your feature branch is perfectly
   up-to-date with the rest of the sprint and structurally sound.
   - Run `git pull --rebase origin sprint-[SPRINT_NUMBER]`.
   - If there are conflicts, you **MUST** resolve them now locally. Stage the
     resolutions and run `git rebase --continue`.
4. **Validation**: Ensure all validation and pre-commit hooks pass. Run the
   command defined as "validationCommand" in `.agents/config/config.json`
   (default: `pnpm turbo run lint`). Fix and commit any resulting errors.
5. **Shift-Left Testing**: Run the command defined as "testCommand" in
   `.agents/config/config.json` (default: `pnpm turbo run test`).
   - If tests fail: Stop immediately, fix the tests, and commit the fixes.
   - If tests pass: Proceed.
6. **Push Feature Branch**: Push your code upstream:
   `git push --force-with-lease -u origin HEAD`.
7. **State Sync**: Switch back to `sprint-[NUM]`. Execute `git pull --rebase` to
   fetch any state updates from sibling agents.
8. **Update Task State (Decoupled)**:
   - Run the state update script to mark the task as committed:
     `node .agents/scripts/update-task-state.js [TASK_ID] committed`
   - **Test Receipt**: Run the state update script again to generate the test
     receipt: `node .agents/scripts/update-task-state.js [TASK_ID] passed`
   - **Note**: This decoupled approach prevents git merge conflicts when
     multiple agents are finalizing tasks simultaneously.

9. **Golden-Path Harvesting**: If this task was completed without tool friction,
   harvest the implementation diff as a few-shot example for future agents:
   `node .agents/scripts/harvest-golden-path.js --task [TASK_ID] --sprint [SPRINT_ROOT] --base [BASE_BRANCH]`
   - **Note**: This script will automatically abort if the task logged errors to
     `agent-friction-log.json`.

10. **Commit State**:

- **If `[TASK_STATE_ROOT]` is within `/temp/`**: Skip Git operations for the
  state file (it is local-only).
- **If `[TASK_STATE_ROOT]` is NOT in a Git-ignored directory**: Stage and commit
  the state files:
  `git add [TASK_STATE_ROOT]/[TASK_ID].json [TASK_STATE_ROOT]/[TASK_ID]-test-receipt.json ; git commit -m "chore(task): mark [TASK_ID] as committed with test receipt"`.
  Push this tracking commit upstream: `git push`. (If it fails, pull --rebase
  and push again).

1. **Notification**: Resolve `[WEBHOOK_URL]` from the `webhookUrl` field in
   `.agents/config/config.json`. If `webhookUrl` is not empty, send a
   notification using the cross-platform Node script:
   - **Protocol**:
     `node .agents/scripts/notify.js "[WEBHOOK_URL]" "Sprint step [TASK_ID] was pushed to its feature branch."`
   - **Failure Logging**: If the notification script fails, log the failure
     using the provided script:
     `node .agents/scripts/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"`
   - If `webhookUrl` is empty, skip gracefully.

2. **Finalize**: Stage and commit any newly harvested golden examples along with
   your state updates (Step 10).

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
