---
description:
  Automated consolidation of sprint feature branches and Playbook updates.
---

# Sprint Integration

This workflow consolidates all concurrent feature development into the main
sprint branch. It must be run BEFORE QA Testing begins.

## Execution Steps

1. **Environment Reset**: Ensure you are on the primary sprint tracking branch
   (e.g., `main` or your designated environment branch). Pull the latest changes
   from the remote tracking branch.
2. **Branch Discovery**: Identify all remote branches associated with this
   sprint's tasks (e.g., branches matching `sprint-[SPRINT_NUMBER]/*`).
3. **Sequential Merging**:
   - Merge each identified feature branch into the main sprint tracking branch.
   - Use standard `git merge --no-ff`.
   - Resolve any minor conflicts (strict scoping should prevent large code
     overlaps).
4. **Playbook Sync (State Transition to Complete)**:
   - Open `.agents/docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md` (or the
     equivalent Playbook Path).
   - For every task branch that was successfully merged, locate its status check
     and change it from Committed (`- [/]`) to Complete (`- [x]`).
5. **Visualize Progress**:
   - For every Chat Session in the Playbook where **all** component tasks have
     now been checked off (`- [x]`), locate the Mermaid diagram at the top.
   - Update the status class from `committed` to `complete`. (e.g., Change
     `class C4 committed` to `class C4 complete`).
6. **Commit State**: Commit the updated `playbook.md` and the merge commits with
   the message:
   `chore(sprint): integrate feature branches and sync playbook state`. Push the
   final integrated branch to origin.

## Constraint

Do NOT skip any steps. The Mermaid diagram and task checkboxes MUST accurately
reflect the merged branches before you consider this workflow complete. This is
the only authorized step for marking tasks as `- [x]` or applying the `complete`
class during parallel execution phases.
