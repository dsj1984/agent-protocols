---
description:
  Final sprint closure — merge sprint branch to main, clean up, and tag release.
---

# Close Sprint

This workflow is the **terminal step** of the sprint lifecycle. It promotes the
fully integrated and reviewed `sprint-[SPRINT_NUMBER]` branch into `main`,
cleans up the sprint branch, and optionally tags a release.

> **When to run**: After the Sprint Retro is finalized and all bookend tasks
> (Integration, QA, Code Review, Retro) are complete.

## Execution Steps

1. **Completeness Gate**: Open the sprint playbook at
   `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`. Scan every task checkbox.
   - If ALL tasks are marked `- [x]` (Complete): proceed.
   - If ANY task is marked `- [ ]`, `- [~]`, or `- [/]`: **STOP IMMEDIATELY**.
     Alert the user with the exact incomplete task numbers and their current
     statuses.
2. **Environment Reset**: Ensure your local environment is clean:
   `git checkout sprint-[SPRINT_NUMBER] ; git pull`.
3. **Merge to Main**: Switch to `main` and perform the merge:

   ```text
   git checkout main
   git pull origin main
   git merge --no-ff sprint-[SPRINT_NUMBER] -m "chore(release): merge sprint-[SPRINT_NUMBER] into main"
   ```

4. **Conflict Marker Scan**: Run the standard post-merge scan:
   `git grep -rn '<<<<<<<\|=======\|>>>>>>>' -- '*.md' '*.ts' '*.js' '*.json'`
   If ANY markers are found, resolve them, stage fixes with `git add`, and amend
   the merge commit before proceeding.
5. **Push Main**: Push the updated main branch: `git push origin main`.
6. **Sprint Branch Cleanup**: Delete the sprint branch locally and remotely:

   ```text
   git branch -d sprint-[SPRINT_NUMBER]
   git push origin --delete sprint-[SPRINT_NUMBER]
   ```

7. **Protocol Refresh**: Reset and refresh the `.agents` submodule to the latest
   version from its pinned branch (`dist`) to ensure the next sprint starts with
   pristine protocols:

   ```text
   git submodule update --remote --merge .agents
   git add .agents
   git commit -m "chore(sprint): refresh .agents protocol submodule to latest"
   git push origin main
   ```

8. **Final Playbook Sync**: Mark the final sprint closure task as complete to
   ensure the playbook is 100% current before the branch is purged:
   - Open `.agents/docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`.
   - Locate the `close-sprint` task (typically in the final Chat Session) and
     change its status from Not Started `[ ]` (or Executing `[~]`) to Complete
     `[x]`.
   - In the Mermaid diagram, update the final Chat Session class from
     `executing` to `complete`.
   - Commit the playbook update:
     `git commit -am "chore(sprint): finalize terminal playbook status"`.
   - Push to main: `git push origin main`.

9. **Stale Branch Audit**: Run `git branch -r` and identify any remaining
   `sprint-[SPRINT_NUMBER]/*` OR `sprint-[SPRINT_NUMBER]-*` branches on origin.
   Delete ALL remaining sprint task branches:
   `git push origin --delete [BRANCH_NAME]`.
   - **Note**: This catch-all audit ensures even legacy dash-named branches are
     purged before the sprint is closed.
10. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in
    the `AGENTS.md` file, send a JSON notification using the cross-platform
    syntax:
    `curl -s -X POST -H "Content-Type: application/json" -d "{\"message\": \"Sprint [SPRINT_NUMBER] has been merged to main and the sprint branch has been cleaned up.\"}" $AGENT_NOTIFICATION_WEBHOOK`

- If the command fails, log the failure in `WEBHOOK_FAILURE.md` in the sprint
  directory.
- If the variable is not set, skip gracefully.

## Constraint

Do NOT execute this workflow unless ALL bookend stages (Integration, QA, Code
Review, and Retro) have been completed. This is the final, irreversible
promotion of sprint code to production. The Completeness Gate (Step 1) is
mandatory and must not be bypassed.
