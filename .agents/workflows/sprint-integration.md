---
description:
  Automated consolidation of sprint feature branches and Playbook updates.
---

# Sprint Integration

This workflow consolidates all concurrent feature development into
`sprint-[SPRINT_NUMBER]`. It must be run BEFORE QA Testing begins.

## Execution Steps

1. **Environment Reset**: Ensure you are on `sprint-[SPRINT_NUMBER]`. Pull the
   latest changes: `git checkout sprint-[SPRINT_NUMBER] ; git pull`.
2. **Branch Discovery**: Identify all remote branches associated with this
   sprint's tasks (e.g., branches matching `sprint-[SPRINT_NUMBER]/*`).
3. **Sequential Merging**:
   - Merge each identified feature branch into `sprint-[SPRINT_NUMBER]`.
   - Use standard `git merge --no-ff`.
   - **Minor conflicts** (fewer than 20 conflicting lines across fewer than 3
     files, e.g., import ordering or adjacent line edits): resolve
     automatically.
   - **Major conflicts** (20+ conflicting lines OR structural changes to shared
     files like schemas, configs, or routing): **STOP** and alert the user with
     the exact conflicting files and branches before proceeding.
4. **Playbook Sync (State Transition to Complete)**:
   - Open `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`.
   - For every task branch that was successfully merged, locate its status check
     and change it from Committed (`- [/]`) to Complete (`- [x]`).
5. **Visualize Progress**:
   - For every Chat Session in the Playbook where **all** component tasks have
     now been checked off (`- [x]`), locate the Mermaid diagram at the top.
   - Update the status class from `committed` to `complete`. (e.g., Change
     `class C4 committed` to `class C4 complete`).
6. **Commit State**: Commit the updated `playbook.md` and the merge commits with
   the message:
   `chore(sprint): integrate feature branches and sync playbook state`. Push to
   origin: `git push origin sprint-[SPRINT_NUMBER]`.
7. **Branch Cleanup**: For each successfully merged feature branch, delete the
   remote ref: `git push origin --delete sprint-[SPRINT_NUMBER]/[TASK_ID]`.

## Constraint

Do NOT skip any steps. The Mermaid diagram and task checkboxes MUST accurately
reflect the merged branches before you consider this workflow complete. This is
the only authorized step for marking tasks as `- [x]` or applying the `complete`
class during parallel execution phases.
