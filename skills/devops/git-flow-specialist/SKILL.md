# Git Flow Specialist

**Description:** Enforces zero-tolerance branch safety, mandatory base
alignment, and strict conventional commit protocols to preserve repository
integrity.

## 🛡️ Core Branch Integrity

- **Zero-Tolerance Main/Master Policy:** You MUST NEVER commit directly to
  `main` or `master`. Any automated state-tracking or code changes MUST be
  performed on `sprint-[NUM]` or an isolated feature branch.
- **Mandatory Base Alignment:** Before starting any work, you MUST ensure your
  local environment is synchronized with the sprint base:
  `git checkout sprint-[NUM] ; git pull`.
- **Feature Branch Isolation:** All code changes MUST be committed to an
  isolated feature branch: `sprint-[NUM]/[TASK_ID]`.
- **Base Verification:** Always verify your current branch with
  `git branch --show-current` before pushing.

## 📝 Conventional Commit Protocol

- **Format:** You MUST use the standard format:
  `<type>(<scope>): <description>`.
- **Types:** Use `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- **Scope:** Use the workspace or domain (e.g., `api`, `web`, `mobile`, `db`).
- **Description:** Smallest possible description in lowercase, imperative mood
  (max 72 chars).
- **Example:** `feat(api): implement transient r2 bucket routing for media`

## ⚔️ Merge & Conflict Strategy

- **Marker Scan:** After ANY merge, you MUST scan the codebase for residual
  conflict markers: `git grep -rn '<<<<<<<\|=======\|>>>>>>>'`.
- **Conflict Thresholds:**
  - **Minor:** (<20 lines, <3 files) Resolve automatically, then `git add` and
    `git commit`.
  - **Major:** (20+ lines or structural changes) STOP IMMEDIATELY and alert the
    user.
- **Atomic State Updates:** If multiple agents are concurrently updating
  `playbook.md`, use `git pull --rebase -X theirs` to ensure the latest remote
  state for that file specifically.

## 🆘 Emergency Recovery

If you discover that you have committed to the wrong branch or left conflict
markers in the code, refer to the
**[Emergency Protocols](./examples/README.md)** immediately.
