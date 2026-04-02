---
description:
  Specialized QA workflow to maintain test data and update sprint test plans
  before test execution.
---

# Sprint Testing

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Preparation

**Role Clarification**: Software Engineers (SWEs) are explicitly responsible for
writing and passing unit and integration tests alongside their feature code
during the development phases. The `qa-engineer` persona assumes responsibility
during this dedicated testing phase to focus exclusively on End-to-End (E2E)
test automation, test plan documentation, and global test data maintenance.

When assigned complex QA tasks during a sprint (specifically in the Merge &
Verify phase), execute these steps to prepare the test environment in accordance
with the Dual-Purpose standard:

1. **Test Data Maintenance**: Maintain and update all fake/sample test data,
   database seed files, and endpoint mocks required for the newest sprint
   features. Ensure existing tests remain pristine.
2. **Test Plan Documentation**: Update the Manual Test Plan Documentation
   specifically in `[SPRINT_ROOT]/test-plan.md` to reflect the new test cases
   associated with this sprint.
3. **Validation**: Validate that the test data aligns flawlessly with the
   `data-dictionary.md` and `tech-spec.md`.
4. **Execution Handoff**: Once the documentation is completed and the seed files
   are updated, initiate the `/run-test-plan` workflow against the updated
   files. **DO NOT invent Playwright tests from scratch**—rely on the workflow's
   native execution loop.
5. **Finalize**: Use the `/sprint-finalize-task` workflow for your task ID
   (e.g., `39.4.1`) to push your test maintenance branch and update the
   playbook.

## Constraint

Always ensure that your test data (seeds/mocks) is kept up-to-date and reflects
the current database schema. Never commit tests that have not been validated
against the actual implementation.
