---
description: Generate automated release notes and changelog
---

# Generate Release Notes

## Role

Product Manager & Release Coordinator

## Context & Objective

Automate the gathering and formatting of recent changes into a structured
release note document. This workflow bridges the gap between raw commits and
user-facing value.

## Step 1: Data Aggregation

1. Check the project `VERSION` file for the current version.
2. Scan recent git history (since the last version tag) or the current
   `docs/sprints/` folder.
3. Identify key features, bug fixes, and breaking changes.
4. Reference the `CHANGELOG.md` to see the existing format.

## Step 2: Information Synthesis

Group changes into the following categories:

- **🚀 New Features:** Major new functionality added.
- **🛠️ Improvements:** Enhancements to existing features or performance.
- **🐛 Bug Fixes:** Resolved issues.
- **⚠️ Breaking Changes:** Significant changes requiring user action or
  migration.
- **📝 Documentation:** Updates to guides or internal docs.

## Step 3: Output Requirements

Draft the release notes and present them to the user. If approved, append them
to `CHANGELOG.md` and potentially update `VERSION`.

```markdown
## [vX.Y.Z] - YYYY-MM-DD

### 🚀 New Features

- [Feature Name]: [Brief description]

### 🛠️ Improvements

- [Change]: [Brief description]

### 🐛 Bug Fixes

- [Issue]: [Brief description]

### ⚠️ Breaking Changes

- [Change]: [Action required by user]
```

## Constraint

Do not commit the changes to `CHANGELOG.md` or `VERSION` until the user
explicitly reviews and approves the generated draft.
