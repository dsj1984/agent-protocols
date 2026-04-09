---
description: >-
  Perform a comprehensive code review of all changes implemented during a sprint
---

# Sprint Code Review

This workflow performs a comprehensive code review of **all code changes** on an
Epic branch before it is merged to `main`. It is a mandatory Bookend phase —
every sprint must pass a code review before closure.

> **When to run**: After all Stories are merged into the Epic branch and before
> `/sprint-close`. The Bookend Lifecycle in `/sprint-execute` invokes this
> automatically when all Tasks reach `agent::done`.
>
> **Persona**: `architect` · **Skills**: `core/code-review-and-quality`,
> `core/security-and-hardening`

## Step 0 — Resolve Context

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic under review.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Fetch the Epic ticket and identify linked context tickets:
   - **PRD** — the `context::prd` ticket linked in the Epic body.
   - **Tech Spec** — the `context::tech-spec` ticket linked in the Epic body.
5. Read both the PRD and Tech Spec fully to understand the intended scope,
   architectural decisions, and acceptance criteria.

## Step 1 — Identify Changed Files

Generate the full diff of the Epic branch against the base branch to determine
the review surface:

```powershell
git diff [BASE_BRANCH]...[EPIC_BRANCH] --stat
git diff [BASE_BRANCH]...[EPIC_BRANCH] --name-only
```

Group the changed files by category for structured analysis:

- **Scripts / Logic** — `.js`, `.ts`, `.py`, `.go`, etc.
- **Configuration** — `.json`, `.yaml`, `.toml`, `.env*`
- **Documentation** — `.md`, `.txt`
- **Styles / UI** — `.css`, `.scss`, `.astro`, `.tsx`, `.jsx`
- **Tests** — files matching `testFilePattern` from `.agentrc.json`
- **CI/CD** — `.github/`, `Dockerfile`, deployment configs

## Step 2 — Review Pillars

For each changed file, execute a strict review against six pillars:

### Pillar 1: Spec Adherence

Does the implementation match the PRD requirements and Tech Spec architecture?

- Compare each completed Story/Task against its stated acceptance criteria.
- Flag any undocumented deviations, missing features, or scope creep.
- Verify API contracts, data models, and interface boundaries match the Tech
  Spec.

### Pillar 2: Security & Privacy

Scan for common vulnerability patterns:

- **Secrets**: Hardcoded API keys, tokens, passwords, or connection strings.
- **Injection**: Unsanitized user input in SQL, shell commands, or templates.
- **Auth/AuthZ**: Missing or broken access control checks.
- **Dependencies**: Known vulnerable packages (check `npm audit` or equivalent).
- **Data exposure**: PII logged to console, included in error responses, or
  stored without encryption.

### Pillar 3: Performance & Scalability

Identify potential performance bottlenecks:

- Unindexed database queries or N+1 patterns.
- Synchronous I/O in hot paths.
- Unbounded loops, missing pagination, or memory leaks.
- Missing caching where appropriate.
- Oversized bundle imports or unnecessary dependencies.

### Pillar 4: Code Quality & Conventions

Verify adherence to the project's established patterns:

- Consistent naming conventions, file structure, and module boundaries.
- Proper error handling (no swallowed errors, structured logging).
- Functions that exceed 50 lines or have more than 4 parameters.
- Duplicated logic that should be extracted into shared utilities.
- Proper use of the project's configured linter and formatter rules.

### Pillar 5: Test Coverage

Assess whether the changes are adequately tested:

- New features and bug fixes should have corresponding tests.
- Tests should cover happy paths, edge cases, and error conditions.
- Test assertions should be meaningful (not just "does not throw").
- Mock boundaries should be appropriate — not mocking the unit under test.

### Pillar 6: Documentation Integrity

Verify documentation stays synchronized with code:

- All new public APIs have JSDoc/TSDoc comments.
- Updated interfaces have updated documentation.
- README and CHANGELOG reflect the changes if applicable.
- Inline comments explain _why_, not _what_.

## Step 3 — Produce Findings Report

Output a consolidated findings report grouped by severity:

1. **🔴 Critical Blocker** — Must be fixed before merge (security
   vulnerabilities, data loss risks, broken functionality).
2. **🟠 High Risk** — Should be fixed before merge (performance regressions,
   missing auth checks, spec deviations).
3. **🟡 Medium Risk** — Should be addressed but not blocking (code quality
   issues, missing tests for edge cases).
4. **🟢 Suggestion** — Nice-to-have improvements (style, naming, minor
   optimizations).

For every finding, provide:

- **File path** and **line number(s)**
- **Pillar** (which review pillar it failed)
- **Description** of the issue
- **Recommended fix** with a concrete code suggestion

## Step 4 — Remediation

If the operator instructs you to fix any findings:

1. Implement the fixes on the `[EPIC_BRANCH]`.
2. Commit each logical fix atomically:

   ```powershell
   git add .
   git commit --no-verify -m "fix(<scope>): <description> (review finding)"
   ```

3. Re-run the project's validation suite to confirm no regressions:

   ```powershell
   npm run lint
   npm test
   ```

If no fixes are requested, this workflow is complete. The operator may proceed
to `/sprint-close`.

## Constraint

- **Always** diff against `[BASE_BRANCH]`, not against individual Story
  branches. The review examines the **cumulative** effect of the entire Epic.
- **Always** read the PRD and Tech Spec before reviewing code. Findings without
  spec context are noise.
- **Never** implement fixes unless the operator explicitly requests it. The
  default mode is read-only audit.
- **Never** mark findings as Critical Blocker unless they represent a genuine
  security risk, data integrity issue, or functional breakage. Overuse of
  Critical severity creates alert fatigue.
- **Always** provide actionable, concrete fix suggestions — not vague advice
  like "consider improving this."
