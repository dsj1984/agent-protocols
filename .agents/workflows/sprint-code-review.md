---
description:
  Perform a comprehensive code review of all changes implemented during a sprint
---

# Sprint Code Review Workflow

## Role

Adopt the `architect` or `security-engineer` persona from `.agents/personas/`.

## Context & Objective

Your objective is to comprehensively review all code modified during the current
sprint to ensure absolute alignment with the PRD, Technical Spec, and global
coding standards before the sprint is formally closed.

**Target Sprint:** `[SPRINT_NUMBER]`

## Step 1 - Mandatory Context Retrieval

Execute the `gather-sprint-context` workflow for `[SPRINT_NUMBER]` to retrieve
the architectural guidelines, PRD, Technical Spec, and Playbook.

## Step 2 - Code Analysis

Identify the code changes implemented during this sprint (using git diffs, PRs,
or by inspecting the files listed as modified in the sprint playbook).

For all modified code, execute a strict review against these four pillars:

1. **Adherence to Spec:** Does the implementation precisely match the database
   schemas and API routes defined in the Technical Specification?
2. **Security & Privacy:** Are there any OWASP Top 10 vulnerabilities, leaked
   secrets, or inadequate validation schemas?
3. **Performance & Technical Debt:** Identify expensive queries, unoptimized
   React renders, or god-functions.
4. **Anti-patterns:** Does the codebase diverge from the project's established
   conventions?

## Step 3 - Issue Reporting

Output your consolidated findings directly to the user in the chat:

1. Group all findings strictly by severity (**Critical Blocker**, **High Risk**,
   **Medium Risk**, **Suggestion**).
2. For every finding, explicitly state:
   - File Path
   - The specific problematic lines of code
   - A detailed explanation of _why_ it failed the review
   - The concrete recommended fix
3. If no issues are found, explicitly output: "Audit Complete. All sprint
   implementations meet the architectural and product specifications."
