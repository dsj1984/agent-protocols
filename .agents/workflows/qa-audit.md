---
description: Run a testing and quality assurance audit
---

# Testing & Quality Assurance Audit

## Role

Principal SDET (Software Development Engineer in Test) & Quality Architect

## Context & Objective

You are performing a comprehensive, read-only audit of this repository's testing
infrastructure, test coverage, and overall quality assurance practices. Your
goal is to identify testing gaps, flaky tests, inefficient mocking strategies,
and opportunities to improve test execution speed and reliability without making
any immediate changes. Additionally, you must evaluate the sprint test plans
against the `docs/roadmap.md` and the current codebase to ensure all test
documentation is complete, consistent, and accurate.

## Step 1: Context Gathering (Read-Only Scan)

Before generating the report, silently scan the workspace for testing-related
files. Pay special attention to:

- Test configuration files (e.g., `jest.config.js`, `vitest.config.ts`,
  `playwright.config.ts`, `cypress.json`).
- Test directories and files (e.g., `__tests__/`, `spec/`, `e2e/`, `*.test.ts`,
  `*.spec.js`).
- Manual and automated test plans stored and organized in
  `docs/sprints/sprint-[##]/`.
- Product documentation like `docs/roadmap.md` to map out expected features
  versus documented/implemented tests.
- Mocking and stubbing setups (e.g., `__mocks__/`, `setupTests.js`, MSW
  handlers).
- CI/CD workflow files to understand how and when tests are executed.

## Step 2: Analysis Dimensions

Evaluate the gathered context against the following test quality dimensions:

1. **Coverage vs. Confidence:** Identify areas with missing tests (unit,
   integration, or E2E) or tests that assert trivial things while missing core
   business logic.
2. **Test Fragility & Flakiness:** Spot patterns that lead to flaky tests, such
   as reliance on hardcoded timeouts (`sleep`), improper handling of
   asynchronous code, or shared mutable state between tests.
3. **Mocking & Stubbing Strategy:** Identify over-mocked tests that test
   implementation details rather than behavior, or missing mocks that cause
   tests to inadvertently hit external networks/APIs.
4. **Test Data Management:** Look for hardcoded test data, lack of proper
   setup/teardown (`beforeEach`/`afterEach`), or test pollution.
5. **Performance & Execution:** Find bottlenecks in the test suite, such as
   unnecessary serial execution, heavy setup running too frequently, or
   opportunities for parallelization.
6. **Test Plan Alignment:** Cross-reference the features outlined in
   `docs/roadmap.md` to ensure they have corresponding and complete test plans
   within `docs/sprints/sprint-[##]/test-plan.md`. Verify that the test plans
   accurately reflect the exact implementation found in the codebase and
   highlight any inconsistencies, gaps, or outdated assertions.

## Step 3: Output Requirements

Generate and save a highly structured Markdown audit report to
`qa-audit-results.md` in the project root, using the exact template below.

```markdown
# Testing & Quality Assurance Audit

## Executive Summary

[Provide a brief overview of the current test suite health, highlighting the
primary vulnerabilities, coverage gaps, and areas causing developer friction.]

## Test Strategy Assessment

| Layer               | Status                           | Notes          |
| ------------------- | -------------------------------- | -------------- |
| Unit Testing        | [Healthy / Needs Work / Missing] | [Brief reason] |
| Integration Testing | [Healthy / Needs Work / Missing] | [Brief reason] |
| E2E Testing         | [Healthy / Needs Work / Missing] | [Brief reason] |
| Test Plans          | [Healthy / Needs Work / Missing] | [Brief reason] |

## Detailed Findings

[For every gap identified, use the following strict structure:]

### [Short Title of the Issue]

- **Category:** [Flakiness | Coverage | Performance | Mocking | Test Plans]
- **Impact:** [High | Medium | Low]
- **Current State:** [How the tests are currently written and why it's
  problematic]
- **Recommendation & Rationale:** [The specific testing pattern or refactor
  strategy to fix the issue]
- **Agent Prompt:**
  `[A copy-pasteable, highly specific prompt to execute this fix independently]`
```

---

## Constraint

Do NOT execute any code modifications, edit files, create branches, or run the
test suite. This is strictly a read-only analysis. Output the report and stop.
