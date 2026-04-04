---
description:
  Rapid remediation of regressions on a feature branch after failed integration.
---

# Sprint Hotfix

This workflow is used to fix regressions or build failures identified during the
`sprint-integration` phase. It is executed directly on the original feature
branch to ensure the shared sprint branch remains clean and unblocked.

> **When to run**: After a failed `/sprint-integration` candidate check.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.
3.  Identify the `[TASK_ID]` of the failed task.
4.  Resolve the feature branch: `task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
5.  Resolve `[MAX_RETRY]` from `frictionThresholds.maxIntegrationRetries` in
    `.agentrc.json`.
6.  Track your current attempt: If this is the first hotfix for this branch, you
    are at Retry 1.

## Execution Steps

1. **Environment Reset**:
   - Ensure you are on the feature branch:
     `git checkout task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - Rebase against the sprint base to ensure you have the latest integrated
     code: `git pull --rebase origin sprint-[SPRINT_NUMBER]`.
2. **Diagnostic Audit**:
   - Read the failure details in `[SPRINT_ROOT]/agent-friction-log.json`.
   - Run the verification suite to reproduce the failure:
     `[VALIDATION_COMMAND] ; [TEST_COMMAND]`. (Note: Resolve exact commands from
     `validationCommand` and `testCommand` in `.agentrc.json`).
3. **Remediation**:
   - Implement the necessary fixes.
   - Run isolated validation for the specific failure area.
4. **Local Verification**:
   - Execute the full verification suite again:
     `[VALIDATION_COMMAND] ; [TEST_COMMAND]`.
   - Ensure all tests pass locally on the feature branch.
5. **Finalize & Re-Push**:
   - Run the `sprint-finalize-task` workflow to update the state JSON,
     regenerate the green test receipt, and push the branch to origin.
6. **Re-Integration**:
   - IF your current Retry count is less than or equal to `[MAX_RETRY]`: Rerun
     the `/[[WORKFLOWS_ROOT]/sprint-integration.md]` workflow to attempt merging
     into the shared sprint branch again.
   - IF your current Retry count exceeds `[MAX_RETRY]`: **STOP IMMEDIATELY**.
     You have hit the Anti-Thrashing threshold for this integration candidate.
     Escalate to the user with a summary of your remediation attempts.

## Constraint

Do NOT attempt to fix regressions directly on the `sprint-[SPRINT_NUMBER]`
branch. Always maintain isolation on the feature branch to protect the
blast-radius of the shared integration branch.
