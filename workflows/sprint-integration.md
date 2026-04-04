---
description:
  Automated consolidation of sprint feature branches and Playbook updates.
---

<!-- // turbo-all -->

# Sprint Integration

This workflow consolidates all concurrent feature development into
`sprint-[SPRINT_NUMBER]`. It must be run BEFORE QA Testing begins, and SHOULD be
rerun if any remediation tasks (QA fixes, Code Review updates) create new
feature branches.

## Progress Protocol

Before executing each numbered step, emit a visible progress banner to the
terminal:

`echo "▶ [Sprint Integration] Step N/10: <STEP_NAME> (Branch: <BRANCH_NAME> if applicable)"`

When entering the per-branch verification loop (Step 4), emit a sub-banner for
each branch:

`echo "  ↳ [Candidate N/TOTAL] Verifying: task/sprint-[NUM]/[TASK_ID]"`

This ensures the human operator always has a clear signal of current progress,
even when commands are auto-running.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.
3.  Resolve `[TASK_STATE_ROOT]` from the `taskStateRoot` field in
    `.agentrc.json` (default: `temp/task-state`).

## Execution Steps

1. **Environment Reset**: Ensure you are on `sprint-[SPRINT_NUMBER]`. Pull the
   latest changes: `git checkout sprint-[SPRINT_NUMBER] ; git pull`.
2. **Branch Discovery**: Identify all remote branches associated with this
   sprint's tasks (e.g., branches matching `task/sprint-[SPRINT_NUMBER]/*`).
3. **Shift-Left Validation**: For each identified feature branch:
   - Extract the `[TASK_ID]` from the branch name.
   - Verify the existence of `[TASK_STATE_ROOT]/[TASK_ID]-test-receipt.json`.
   - If the receipt is **MISSING** or the status is not **"passed"**: **STOP**
     and log a friction point. This branch is NOT eligible for integration until
     isolated tests pass.
4. **Ephemeral Candidate Verification**: For each VALIDATED feature branch
   identified in Step 2, run the batch integration script:
   `node [SCRIPTS_ROOT]/sprint-integrate.js --sprint [SPRINT_NUMBER] --task [TASK_ID]`
   - This script performs the full candidate verification loop in a single
     process: creates the ephemeral candidate branch, merges, runs validation +
     tests, and either consolidates (on success) or rolls back (on failure).
   - **Merge Conflict Resolution** (handled inside the script):
     - **Minor conflicts** (fewer than 20 conflicting lines across fewer than 3
       files, e.g., import ordering or adjacent line edits): the script resolves
       automatically.
     - **Major conflicts** (20+ conflicting lines OR structural changes to
       shared files like schemas, configs, or routing): the script exits with
       code `2`. You MUST **STOP** and alert the user with the exact conflicting
       files and branches before proceeding.
   - **Blast-Radius Check** (exit codes from the script):
     - **Exit 0 (Build Green)**: The candidate was successfully merged into the
       sprint base and the candidate branch was cleaned up. Proceed to the next
       branch.
     - **Exit 1 (Build Broken)**: The candidate was purged (blast-radius
       contained) and friction was logged automatically.
       - **REMEDIATE (Zero-Touch Loop)**: DO NOT STOP EXECUTION. You must now
         immediately checkout the original feature branch
         `task/sprint-[SPRINT_NUMBER]/[TASK_ID]` and transition into the
         `/[[WORKFLOWS_ROOT]/sprint-hotfix.md]` workflow. Use the diagnostic
         traces you just generated to automatically remediate the regression.
         This task is NOT eligible for `[x]` (Complete) status yet.
     - **Exit 2 (Major Conflict)**: STOP and alert the user.

5. **Conflict Marker Scan**: After all merges complete, run the cross-platform
   script: `node [SCRIPTS_ROOT]/detect-merges.js` If the script exits with an
   error (markers found), the merge is INCOMPLETE. Resolve them manually, stage
   the fixes with `git add`, and amend the merge commit before proceeding. Do
   NOT continue with unresolved markers.
6. **Playbook Sync (State Transition to Complete)**:
   - Open `[SPRINT_ROOT]/playbook.md`.
   - For every task branch that was successfully merged, locate its status check
     and change it from Not Started (`- [ ]`) to Complete (`- [x]`).
7. **Visualize Progress**:
   - For every Chat Session in the Playbook where **all** component tasks have
     now been checked off (`- [x]`), locate the Mermaid diagram at the top.
   - Update the status class from `not_started` to `complete`. (e.g., Change
     `class C4 not_started` to `class C4 complete`).
8. **Commit State**: Commit the updated `playbook.md` and the merge commits with
   the message:
   `chore(sprint): integrate feature branches and sync playbook state`. Push to
   origin: `git push origin sprint-[SPRINT_NUMBER]`.
9. **Branch Cleanup**: For each successfully merged feature branch, delete the
   remote ref: `git push origin --delete task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
10. **Notification**: Resolve `[WEBHOOK_URL]` from the `notificationWebhookUrl`
    field in `.agentrc.json`. If `notificationWebhookUrl` is not empty, send a
    notification using the cross-platform Node script:
    `node [SCRIPTS_ROOT]/notify.js "[WEBHOOK_URL]" "Sprint [SPRINT_NUMBER]: Feature branches have been integrated into the sprint base branch."`

- If the command fails, log the failure using the provided script:
  `node [SCRIPTS_ROOT]/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"`
- If the `notificationWebhookUrl` is empty, skip gracefully.

## Constraint

Do NOT skip any steps. The Mermaid diagram and task checkboxes MUST accurately
reflect the merged branches before you consider this workflow complete. This is
the only authorized step for marking tasks as `- [x]` or applying the `complete`
class during parallel execution phases.

**Timeout**: If a single branch's candidate verification (Step 4) has not
completed within 5 minutes of wall-clock time, treat it as a failure and proceed
to the blast-radius containment path (exit code 1). Log the timeout via
`node [SCRIPTS_ROOT]/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "sprint-integration" "[TASK_ID] candidate verification timed out after 5 minutes."`
