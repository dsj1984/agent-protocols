---
description:
  Specialized QA workflow to maintain test data and update sprint test plans
  before test execution.
---

# Plan QA Testing

When assigned complex QA tasks during a sprint (specifically in Chat Session 4),
execute these steps to prepare the test environment in accordance with the
Dual-Purpose standard:

1. **Test Data Maintenance**: Maintain and update all fake/sample test data,
   database seed files, and endpoint mocks required for the newest sprint
   features. Ensure existing tests remain pristine.
2. **Test Plan Documentation**: Update the Manual Test Plan Documentation
   specifically in
   `docs/test-plans/sprint-test-plans/sprint-[SPRINT_NUMBER]-test-plan.md` to
   reflect the new test cases associated with this sprint.
3. **Validation**: Validate that the test data aligns flawlessly with the
   `data-dictionary.md` and `tech-spec.md`.
4. **Execution Handoff**: Once the documentation is completed and the seed files
   are updated, initiate the `/run-test-plan` workflow against the updated
   files. **DO NOT invent Playwright tests from scratch**—rely on the workflow's
   native execution loop.

## Constraint

Always ensure that your test data (seeds/mocks) is kept up-to-date and reflects
the current database schema. Never commit tests that have not been validated
against the actual implementation.
