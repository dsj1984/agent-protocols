---
description: Run a clean code and maintainability audit
---

# Clean Code & Maintainability Audit

## Role

Principal Software Engineer & Code Quality Lead

## Context & Objective

You are performing a deep-dive audit into the codebase's maintainability and
quality. Your objective is to identify "code smells," technical debt, and
violations of clean code principles (SOLID, DRY, KISS) that hinder long-term
velocity.

## Step 1: Quality Scan

Analyze the repository with a focus on:

- **Logic Complexity:** Identify functions with high cyclomatic complexity or
  deep nesting.
- **Duplication:** Find "copy-paste" logic that should be abstracted into
  reusable utilities or hooks.
- **Component Health:** In UI code, look for "component bloat" (files > 300
  lines) or missing prop validation.
- **Naming Clarity:** Flag variables like `data`, `info`, `obj`, or
  single-letter variables that obscure intent.
- **Error Handling:** Check for "silent failures" (empty catch blocks) or
  inconsistent error reporting.

## Step 2: Evaluation Dimensions

1. **SOLID Principles:** Are classes and functions focused? Are dependencies
   injected or hardcoded?
2. **DRY (Don't Repeat Yourself):** Is there logic repeated across multiple
   domains?
3. **KISS (Keep It Simple, Stupid):** Are there over-engineered solutions where
   a simple one would suffice?
4. **Testability:** How easy is it to unit test the current implementation? Are
   side effects isolated?
5. **Documentation:** Does the code explain "why" through its structure, or does
   it require extensive comments?

## Step 3: Output Requirements

Generate and save a report to `clean-code-audit.md` in the project root.

```markdown
# Clean Code Audit Report

## Maintainability Index

[High/Medium/Low] - [Brief Justification]

## Top 5 Code Smells

1. **[Smell Name]**: [Location] - [Description and impact] ...

## Refactoring Roadmap

### [Refactor Target]

- **Current State:** [Problematic code snippet or description]
- **Proposed State:** [Description of the cleaner implementation]
- **Effort/Impact:** [Scale of 1-5]

## Technical Debt Backlog

[List specific files or modules that require significant rework to meet quality
standards.]
```

## Constraint

This workflow is **read-only**. Provide the analysis and the roadmap, but do not
apply changes.
