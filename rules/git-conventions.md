# Git & Version Control Conventions

This rule applies globally to all repository changes to maintain a clean git
history.

## Canonical Base Branch

Each sprint operates on a dedicated **per-sprint branch** named
`sprint-[SPRINT_NUMBER]` (e.g., `sprint-37`). This branch is created from `main`
at the start of sprint execution and serves as the integration target for all
feature branches during the sprint.

**Lifecycle:**

1. **Sprint Start**: Create the sprint branch from `main`:
   `git checkout -b sprint-[SPRINT_NUMBER] main ; git push -u origin HEAD`.
2. **During Execution**: All agents work from the sprint branch. Feature
   branches fork from and merge back into `sprint-[SPRINT_NUMBER]`.
3. **After Retro**: The sprint branch is merged into `main` via
   `git checkout main ; git merge --no-ff sprint-[SPRINT_NUMBER]` and the remote
   sprint branch is deleted.

This keeps `main` stable and production-ready while giving each sprint an
isolated integration and QA target.

## Branching Strategy

### Sprint Execution (Managed by Workflows)

During sprint execution, the `finalize-sprint-task` workflow controls branch
creation. Sprint task branches MUST follow this naming convention:

```text
sprint-[SPRINT_NUMBER]/[TASK_ID]
```

Examples: `sprint-37/db-migrations`, `sprint-37/bugfix-login-redirect`.

The `sprint-integration` workflow discovers branches matching
`sprint-[SPRINT_NUMBER]/*` and merges them into the sprint branch
`sprint-[SPRINT_NUMBER]`. Any branch that does not follow this pattern will be
**silently skipped** during integration.

### Ad-Hoc Work (Outside Sprint Workflows)

For changes made outside of the sprint playbook pipeline (e.g., hotfixes,
documentation updates, or infrastructure changes), use type-prefixed branch
names:

- `feature/` — New capabilities or enhancements
- `bugfix/` — Non-sprint bug fixes
- `hotfix/` — Urgent production fixes
- `chore/` — Tooling, config, or dependency updates

Example: `hotfix/fix-auth-redirect`.

## Commit Messages (Conventional Commits)

- MUST adhere to Conventional Commits format:
  `<type>(<optional scope>): <description>`
- Types allowed: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`,
  `perf:`, `test:`.
- Description must be in the imperative mood (e.g., "add feature", not "adds" or
  "added").

## Pull Requests

- Never commit `.env` or hardcoded secrets.
- Always include a short description of _why_ the change was made in the PR
  body.
