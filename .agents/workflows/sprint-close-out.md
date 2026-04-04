---
description:
  Final sprint closure — merge sprint branch to main, clean up, and tag release.
---

# Sprint Close Out

This workflow is the **terminal step** of the sprint lifecycle. It promotes the
fully integrated and reviewed `sprint-[SPRINT_NUMBER]` branch into `main`,
cleans up the sprint branch, and optionally tags a release.

> **When to run**: After the Sprint Retro is finalized and all bookend tasks
> (Integration, QA, Code Review, Retro) are complete.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.
3.  Resolve `[BASE_BRANCH]` from the `baseBranch` field in `.agentrc.json`
    (default: `main`).

## Execution Steps

1. **Completeness Gate**: Open the sprint playbook at
   `[SPRINT_ROOT]/playbook.md`. Scan every task checkbox.
   - If ALL tasks are marked `- [x]` (Complete): proceed.
   - If ANY task is marked `- [ ]`, `- [~]`, or `- [/]`: **STOP IMMEDIATELY**.
     Alert the user with the exact incomplete task numbers and their current
     statuses.
2. **Environment Reset**: Ensure your local environment is clean:
   `git checkout sprint-[SPRINT_NUMBER] ; git pull`.
3. **Final Integration Audit**: Before promoting to `[BASE_BRANCH]`, you MUST
   confirm that ALL feature branches have been consolidated.
   - Run `git branch -r` and look for any remaining
     `origin/task/sprint-[SPRINT_NUMBER]/*` branches.
   - For each branch found, check if it contains unmerged commits:
     `git log sprint-[SPRINT_NUMBER]..origin/task/sprint-[SPRINT_NUMBER]/[TASK_ID]`.
   - If ANY unmerged commits exist: **STOP**. You must run the
     `sprint-integration` workflow one last time to consolidate these changes
     before closing the sprint.
   - If the branches exist but have 0 unmerged commits, they are safe to ignore
     (they will be purged in the Cleanup step).
4. **Merge to Base Branch**: Switch to the base branch (defined as "baseBranch"
   in .agentrc.json) and perform the merge:

   ```text
   git checkout [BASE_BRANCH]
   git pull origin [BASE_BRANCH]
   git merge --no-ff sprint-[SPRINT_NUMBER] -m "chore(release): merge sprint-[SPRINT_NUMBER] into [BASE_BRANCH]"
   ```

5. **Conflict Marker Scan**: Run the standard post-merge scan:
   `git grep -rn '<<<<<<<\|=======\|>>>>>>>' -- '*.md' '*.ts' '*.js' '*.json'`
   If ANY markers are found, resolve them, stage fixes with `git add`, and amend
   the merge commit before proceeding.
6. **Push Main**: Push the updated main branch: `git push origin main`.
7. **Sprint Branch Cleanup**: Delete the sprint branch locally and remotely:

   ```text
   git branch -d sprint-[SPRINT_NUMBER]
   git push origin --delete sprint-[SPRINT_NUMBER]
   ```

8. **Protocol Refresh**: Reset and refresh the `.agents` submodule to the latest
   version from its pinned branch (`dist`) to ensure the next sprint starts with
   pristine protocols:

   ```text
   git submodule update --remote --merge .agents
   git add .agents
   git commit -m "chore(sprint): refresh .agents protocol submodule to latest"
   git push origin [BASE_BRANCH]
   ```

9. **Final Playbook Sync**: Mark the final sprint closure task as complete to
   ensure the playbook is 100% current before the branch is purged:
   - Open `[SPRINT_ROOT]/playbook.md`.
   - Locate the `close-sprint` task (typically in the final Chat Session) and
     change its status from Not Started `[ ]` (or Executing `[~]`) to Complete
     `[x]`.
   - In the Mermaid diagram, update the final Chat Session class from
     `executing` to `complete`.
   - Commit the playbook update:
     `git commit -am "chore(sprint): finalize terminal playbook status"`.
   - Push to the base branch: `git push origin [BASE_BRANCH]`.

10. **Stale Branch Audit**: Run `git branch -r` and identify any remaining
    `task/sprint-[SPRINT_NUMBER]/*` OR `sprint-[SPRINT_NUMBER]-*` branches on
    origin. Delete ALL remaining sprint task branches:
    `git push origin --delete [BRANCH_NAME]`.
    - **Note**: This catch-all audit ensures even legacy dash-named branches are
      purged before the sprint is closed.
11. **Notification**: Resolve `[WEBHOOK_URL]` from the `webhookUrl` field in
    `.agentrc.json`. If `webhookUrl` is not empty, send a notification using the
    cross-platform Node script:
    `node [SCRIPTS_ROOT]/notify.js "[WEBHOOK_URL]" "Sprint [SPRINT_NUMBER] has been merged to [BASE_BRANCH] and the sprint branch has been cleaned up."`

- If the command fails, log the failure using the provided script:
  `node [SCRIPTS_ROOT]/log-friction.js "[SPRINT_ROOT]/agent-friction-log.json" "friction_point" "notify.js" "[ERROR_MESSAGE]"`
- If the `webhookUrl` is empty, skip gracefully.

## Constraint

Do NOT execute this workflow unless ALL bookend stages (Integration, QA, Code
Review, and Retro) have been completed. This is the final, irreversible
promotion of sprint code to production. The Completeness Gate (Step 1) is
mandatory and must not be bypassed.
