# Git Flow Specialist — Emergency Protocols

Use these procedures if you discover state corruption or workflow violations.

---

## 🆘 Scenario 1: Accidental Commit to `main`/`master`

If you have committed changes to the protected `main` or `master` branch
locally.

### Recovery Procedure

1.  **Stop immediately**. Do NOT push.
2.  **Move the work**: Create a temporary feature branch from your current
    position.
    - `git checkout -b temp-recovery`
3.  **Reset main**: Switch back to `main` and force-reset it to match the
    remote.
    - `git checkout main`
    - `git fetch origin main`
    - `git reset --hard origin/main`
4.  **Restore the work**: Switch back to your feature branch and rename it.
    - `git checkout temp-recovery`
    - `git branch -m sprint-[NUM]/[TASK_ID]` (Rename if needed)

---

## 🆘 Scenario 2: Residual Conflict Markers Found

If you discover `<<<<<<<`, `=======`, or `>>>>>>>` in your code after a merge.

### Recovery Procedure

1.  **Audit the markers**: Identify all affected files.
    - `git grep -l '<<<<<<<\|=======\|>>>>>>>'`
2.  **Manually resolve**: Open each file and choose the correct code blocks.
3.  **Commit the fix**: Stage all fixed files and amend your last commit (if
    applicable) or create a fix commit.
    - `git add <fixed-files>`
    - `git commit -m "fix(git): resolve merge conflict markers"`

---

## 🆘 Scenario 3: Diverged Feature Branch

If your feature branch has diverged from the `sprint-[NUM]` base and is failing
to merge.

### Recovery Procedure

1.  **Sync the base**: Ensure your local base is fresh.
    - `git checkout sprint-[NUM]`
    - `git pull`
2.  **Rebase the feature**: Move your commits onto the new base.
    - `git checkout sprint-[NUM]/[TASK_ID]`
    - `git rebase sprint-[NUM]`
3.  **Resolve conflicts**: If prompted, resolve conflicts line-by-line using
    `git rebase --continue`.
