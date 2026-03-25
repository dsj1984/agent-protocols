# Git & Version Control Conventions

This rule applies globally to all repository changes to maintain a clean git
history.

## Branching Strategy

- Name branches starting with their type: `feature/`, `bugfix/`, `hotfix/`, or
  `chore/`.
- Use a descriptive, dash-separated short name: `feature/add-user-auth`.

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
