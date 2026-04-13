---
description: Run a Lighthouse performance and audit-accessibility
---

# Lighthouse Performance Audit & Optimization Loop

## Role

Senior Web Performance Engineer & Site Reliability Expert

## Context & Objective

You are conducting a rigorous, iterative Lighthouse performance audit to
identify and resolve the top performance, accessibility, best practices, and SEO
issues affecting a web application. Unlike other audit workflows, this one
**does** implement fixes — but under a strict verify-and-revert discipline to
ensure only proven improvements are committed.

**Target URL:** `[TARGET_URL]` — Replace this with the URL of the running local
dev server (e.g., `http://localhost:3000`) before starting.

## Step 1: Baseline Audit

1. Run a Lighthouse audit on `[TARGET_URL]` in Desktop mode. Fix any
   environmental issues that prevent Lighthouse from running.
2. Create and save a file named
   `{{auditOutputDir}}/audit-accessibility-results.md`.
3. Log the initial "Before" scores in a table:

| Metric         | Before Score |
| -------------- | ------------ |
| Performance    | —            |
| Accessibility  | —            |
| Best Practices | —            |
| SEO            | —            |

## Step 2: Issue Identification

Identify the **top 3 opportunities** with the highest potential impact on the
score. List them in `{{auditOutputDir}}/audit-accessibility-results.md` before
touching any code.

## Step 3: Optimization Loop

Execute the following cycle **for each of the 3 issues**:

1. **Plan:** Analyze the codebase and outline a specific implementation plan to
   fix the issue.
2. **Implement:** Apply the code fix. Do not break existing functionality.
3. **Verify:** Re-run Lighthouse immediately after the fix.
4. **Decision:**
   - ✅ **Score improves or target metric decreases** → Keep the change and log
     the "After" result in `{{auditOutputDir}}/audit-accessibility-results.md`.
   - ❌ **Score is unchanged or worsens** → **Revert the change immediately**
     and log the failure in the report.

## Step 4: Final Artifact

Update `{{auditOutputDir}}/audit-accessibility-results.md` with a final summary
table:

| Metric         | Before Score | After Score | Delta |
| -------------- | ------------ | ----------- | ----- |
| Performance    | —            | —           | —     |
| Accessibility  | —            | —           | —     |
| Best Practices | —            | —           | —     |
| SEO            | —            | —           | —     |

## Constraint

Only modify code as part of the verify-and-revert optimization loop. Do not
refactor or change code outside of the three identified issues. If a fix worsens
the score, revert it before proceeding to the next issue.
