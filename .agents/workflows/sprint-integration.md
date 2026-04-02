---
description:
  Automated consolidation of sprint feature branches and Playbook updates.
---

# Sprint Integration

This workflow consolidates all concurrent feature development into
`sprint-[SPRINT_NUMBER]`. It must be run BEFORE QA Testing begins, and SHOULD be
rerun if any remediation tasks (QA fixes, Code Review updates) create new
feature branches.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.
3.  Resolve `[TASK_STATE_ROOT]` from the `taskStateRoot` field in
    `.agents/config/config.json` (default: `temp/task-state`).

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
   identified in Step 2, perform the following verification loop:
   - Check out a temporary candidate branch from the sprint base:
     `git checkout -b integration-candidate-[TASK_ID] sprint-[SPRINT_NUMBER]`.
   - Merge the feature branch:
     `git merge --no-ff task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - **Merge Conflict Resolution**:
     - **Minor conflicts** (fewer than 20 conflicting lines across fewer than 3
       files, e.g., import ordering or adjacent line edits): resolve
       automatically.
     - **Major conflicts** (20+ conflicting lines OR structural changes to
       shared files like schemas, configs, or routing): **STOP** and alert the
       user with the exact conflicting files and branches before proceeding.
   - **Verification**: Execute the verification suite with diagnostic
     interception:
     `node .agents/scripts/diagnose-friction.js --sprint [SPRINT_ROOT] --cmd "npm run lint ; npm run test"`.
     (Note: Resolve exact commands from `validationCommand` and `testCommand` in
     `.agents/config/config.json`).
   - **Blast-Radius Check**:
     - **IF SUCCESS (Build Green)**:
       - Switch back to the base: `git checkout sprint-[SPRINT_NUMBER]`.
       - Consolidate the candidate:
         `git merge --no-ff integration-candidate-[TASK_ID]`.
       - Delete candidate: `git branch -D integration-candidate-[TASK_ID]`.
     - **IF FAILURE (Build Broken)**:
       - Switch back to the base: `git checkout sprint-[SPRINT_NUMBER]`.
       - Delete candidate. The shared sprint branch is now "Clean" and
         unaffected by the failure.
       - Log a critical friction entry using the provided script:
         `node .agents/scripts/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "sprint-integration" "[TASK_ID] failed post-merge integration check. Blast-radius contained. Rework triggered via /sprint-hotfix."`
       - **REMEDIATE (Zero-Touch Loop)**: DO NOT STOP EXECUTION. You must now
         immediately checkout the original feature branch
         `task/sprint-[SPRINT_NUMBER]/[TASK_ID]` and transition into the
         `/[.agents/workflows/sprint-hotfix.md]` workflow. Use the diagnostic
         traces you just generated to automatically remediate the regression.
         This task is NOT eligible for `[x]` (Complete) status yet.

5. **Conflict Marker Scan**: After all merges complete, run the cross-platform
   script: `node .agents/scripts/detect-merges.js` If the script exits with an
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
10. **Self-Cleanup**: Delete your OWN local and remote task branch for this
    integration session:
    `git branch -D task/sprint-[SPRINT_NUMBER]/[TASK_ID] ; git push origin --delete task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
11. **Notification**: Resolve `[WEBHOOK_URL]` from the `webhookUrl` field in
    `.agents/config/config.json`. If `webhookUrl` is not empty, send a
    notification using the cross-platform Node script:
    `node .agents/scripts/notify.js "[WEBHOOK_URL]" "Sprint [SPRINT_NUMBER] feature branches have been integrated into the sprint base branch."`

- If the command fails, log the failure using the provided script:
  `node .agents/scripts/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"`
- If the `webhookUrl` is empty, skip gracefully.

## Constraint

Do NOT skip any steps. The Mermaid diagram and task checkboxes MUST accurately
reflect the merged branches before you consider this workflow complete. This is
the only authorized step for marking tasks as `- [x]` or applying the `complete`
class during parallel execution phases.
