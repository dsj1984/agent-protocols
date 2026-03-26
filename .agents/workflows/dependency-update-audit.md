---
description: Audit and upgrade project dependencies
---

# Dependency Update Audit

## Role

DevOps Engineer & Security Researcher

## Context & Objective

Manage the lifecycle of project dependencies. Your goal is to identify outdated,
vulnerable, or bloated packages and suggest a safe upgrade path that maintains
system stability.

## Step 1: Inventory & Stale Check

1. Run `npm outdated` (or equivalent for the package manager) to see which
   packages are behind.
2. Identify "stale" dependencies (packages with no updates for >1 year).
3. Check for "bloat" — large dependencies that could be replaced by smaller
   alternatives or native code.

## Step 2: Vulnerability Scan

1. Run `npm audit` to find security vulnerabilities.
2. Cross-reference critical dependencies with known CVE databases if necessary.
3. Highlight any peer dependency conflicts that might arise from upgrades.

## Step 3: Output Requirements

Generate and save a report to `dependency-audit.md` in the project root.

```markdown
# Dependency Audit Report

## Health Summary

- **Outdated Packages:** [Count]
- **Vulnerabilities:** [Critical: #, High: #, Mod: #]
- **Deprecated Packages:** [List]

## Proposed Upgrade Path

### Category: Security Fixes (High Priority)

- `[package]`: [Current] -> [Target]. _Rationale: Fixes CVE-XXX._

### Category: Minor/Patch Updates (Low Risk)

- [List of packages safe to `npm update`.]

### Category: Major Version Upgrades (High Risk)

- `[package]`: [Current] -> [Target]. _Breaking Changes: [Summary of changes
  needed]._

## Recommended Removals/Replacements

- Replace `[heavy-library]` with `[light-library]` or native `[browser-api]`.
```

## Constraint

This is a **read-only** evaluation. Do not run `npm install` or `npm update`
unless explicitly requested by the user after reviewing this report.
