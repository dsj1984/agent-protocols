---
name: vitest
description:
  Writes fast, isolated unit and integration tests with Vitest. Use when each
  test must run on file-save without shared state — `vi.mock()` for external
  deps, `vi.spyOn()` for call monitoring, AAA structure, and edge-case
  coverage for null/undefined/boundary inputs.
vendor: vitest
---

# Skill: Vitest

Guidelines for writing fast, reliable unit and integration tests.

## 1. Core Principles

- **Speed:** Tests should be fast enough to run on every file save.
- **Isolation:** Each test must be independent. Avoid shared state between
  tests.
- **Confidence:** Tests should verify behavior, not implementation details.

## 2. Technical Standards

- **Mocking:** Use `vi.mock()` for external dependencies (APIs, network calls)
  and `vi.spyOn()` for monitoring function calls.
- **Snapshot Testing:** Use snapshots for large, stable data structures, but
  avoid them for frequently changing UI components to prevent "snapshot
  fatigue."
- **Coverage:** Aim for 80%+ coverage on business logic and edge cases. Use
  `vitest --coverage` for auditing.

## 3. Best Practices

- **Descriptive Titles:** Use the
  `describe('Component/Utility', () => { it('should [action] when [condition]') })`
  pattern.
- **Arrange-Act-Assert (AAA):** Structure tests clearly into setup (Arrange),
  execution (Act), and verification (Assert) phases.
- **Edge Cases:** Always include tests for error states, null/undefined inputs,
  and boundary conditions.
