# Implementation Plan: Clean Code Refactoring

This plan addresses the recommendations from the `clean-code-audit-results.md`
file to improve maintainability, reduce complexity, and eliminate duplication in
the `agent-protocols` repository.

## Proposed Changes

### [Component Name] Script Refactoring (`.agents/scripts/generate-playbook.js`)

Decompose the complex `groupIntoChatSessions` function into focused, well-named
helper functions to reduce cyclomatic complexity.

#### [MODIFY] [generate-playbook.js](file:///c:/Users/dsj19/.agents/scripts/generate-playbook.js)

- Extract a `segregateTasks` helper to separate bookend tasks from regular
  tasks.
- Extract a `groupRegularTasks` helper to handle layer and scope-based grouping
  of development tasks.
- Extract an `appendBookendSessions` helper to manage the deterministic bookend
  stage generation (Integration, QA, Review, Retro, Close).
- Ensure the logic remains identical to the existing implementation to prevent
  regressions.

### [Component Name] Test Suite DRY Hardening (`tests/generate-playbook.test.js`)

Abstract the repetitive bookend task definitions into a shared helper function.

#### [MODIFY] [generate-playbook.test.js](file:///c:/Users/dsj19/tests/generate-playbook.test.js)

- Create a `makeBookendTasks(dependsOnIds)` helper in the manifest factory
  section.
- Refactor existing integration tests to use this helper, eliminating dozens of
  lines of repetitive boilerplate.

### [Component Name] Naming Clarity Fixes (`tests/structure.test.js`)

Replace single-letter variables in iterators with semantic names.

#### [MODIFY] [structure.test.js](file:///c:/Users/dsj19/tests/structure.test.js)

- Replace `d` with `dirent` or `entry`.
- Replace `f` with `filename` or `file`.

## Verification Plan

### Automated Tests

- Run the full test suite using `npm test` (or `node --test tests/*.test.js`).
- Verify that 89/89 tests still pass after refactoring.
- Specifically verify `tests/generate-playbook.test.js` to ensure the session
  grouping logic behaves exactly as before.

### Manual Verification

- Run `node .agents/scripts/generate-playbook.js 40` to ensure the Sprint 40
  playbook is still generated correctly with no visual or structural changes in
  the Mermaid diagram.
