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

7. **Stale Branch Audit**: Run `git branch -r` and verify no
   `sprint-[SPRINT_NUMBER]/*` branches remain on origin. If any are found,
   delete them with `git push origin --delete [BRANCH_NAME]`.
8. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in
   the `AGENTS.md` file, send a JSON payload:

   ```text
   curl -X POST -H "Content-Type: application/json" \
     -d '{"message": "Sprint [SPRINT_NUMBER] has been merged to main and the sprint branch has been cleaned up."}' \
     $AGENT_NOTIFICATION_WEBHOOK
   ```

   If the variable is not set, skip gracefully.

## Constraint

Do NOT execute this workflow unless ALL bookend stages (Integration, QA, Code
Review, and Retro) have been completed. This is the final, irreversible
promotion of sprint code to production. The Completeness Gate (Step 1) is
mandatory and must not be bypassed.
