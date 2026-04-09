# Git & Version Control Conventions

This rule applies globally to all repository changes to maintain a clean git
history.

## Canonical Branching (v5 Orchestration)

### Epic Base Branch

Each Epic operates on a dedicated **Epic base branch** named `epic/[EPIC_ID]`
(e.g., `epic/98`). This branch is created from `main` and serves as the
integration target for all Stories within that Epic.

### Story-Level Branching

All tasks within a Story MUST be committed to a shared **Story branch**:
`story/epic-[EPIC_ID]/[STORY_SLUG]` (e.g., `story/epic-98/schema-refactor`).

### Task-Level Branching (Legacy/Transition)

During the v5 transition, individual task branches may still be used:
`task/epic-[EPIC_ID]/[TASK_ID]`.

## Conventional Commits

- MUST adhere to Conventional Commits format:
  `<type>(<optional scope>): <description>`
- Types allowed: `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`,
  `perf:`, `test:`.
- Description must be in the imperative mood (e.g., "add feature", not "adds" or
  "added").

## Push Validation & Reliability

To prevent "silent" push failures (e.g., hidden by multi-command chains or
rejected by `pre-push` hooks):

1.  **Local Validation**: ALWAYS run `npm run lint` and `npm run format:check`
    locally _before_ attempting a `git push`.
2.  **Verify Push Output**: Do NOT assume a push succeeded unless the output
    explicitly confirms the remote ref was updated (`[new branch]`,
    `[up to date]`, or `... -> ...`).
3.  **Handle Rejections**: If a push is rejected by a `pre-push` hook, fix the
    underlying issue (usually formatting or linting) and **amend** the commit
    rather than creating "fix lint" commits.

## Pull Requests

- Never commit `.env` or hardcoded secrets.
- Always include a short description of _why_ the change was made in the PR
  body.
- **Reference Issues**: Use "Resolves #109" or "Closes #114" to link tickets.
