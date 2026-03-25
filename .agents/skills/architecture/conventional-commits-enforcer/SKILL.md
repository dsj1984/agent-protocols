# Conventional Commits Enforcer

**Description:** Ensures all automated commits follow strict semantic versioning
standards.

**Instruction:** You are making Git commits for your generated work.

- You MUST use Conventional Commits format: `<type>(<scope>): <description>`.
- Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- The `<scope>` must be the workspace or domain (e.g., `api`, `web`, `mobile`,
  `db`).
- The `<description>` must be lowercase, imperative mood, and no longer than 72
  characters.
- Example: `feat(api): implement transient r2 bucket routing for media`
- NEVER write multi-line commit messages unless explicitly requested.
