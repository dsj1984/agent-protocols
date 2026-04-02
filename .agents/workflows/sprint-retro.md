---
description:
  Perform Sprint Retrospective, update documentation, and align the roadmap.
---

# Sprint Retro & Roadmap Alignment

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Retrospective Execution

When instructed to perform a sprint retro and align the roadmap (typically in
Chat Session 5), you must execute the following steps:

1. **Generate Retro Document**: Generate a `[SPRINT_ROOT]/retro.md` file using
   the `.agents/templates/sprint-retro-template.md` template.
2. **Analyze the Sprint**: Analyze the sprint execution logs, test results,
   commits, and the `agent-friction-log.json` to accurately fill in the Sprint
   Scorecard, What Went Well, What Could Be Improved, and Architectural Debt.
3. **Generate Self-Healing Recommendations**: In the **Protocol Optimization
   Recommendations (Self-Healing)** section, you MUST identify systemic friction
   points and generate "agent-ready" markdown snippets or skills. These snippets
   should be specifically designed for immediate human-approved application
   (e.g., via the PM/Lead) to the `agent-protocols` library.
4. **Formulate Action Items**: Create clear, actionable items for the next
   sprint based on the retro analysis.
5. **Update Roadmap**: Open `roadmap.md` and mark newly completed items as
   `✅ Implemented`. Note: Do NOT add new protocol-related action items to the
   roadmap; these should remain in the retro document for later implementation
   in the `agent-protocols` repository.
6. **Update Architecture & Patterns**: Update `architecture.md` if any core
   schemas or dependencies were introduced. Update `docs/patterns.md` and
   `docs/decisions.md` to document new technical rulings, accepted library
   patterns, or key architectural decisions made during this sprint.
7. **Finalize**: Use the `/sprint-finalize-task` workflow for your task ID
   (e.g., `39.8.1`) to ensure the retro documentation and roadmap updates are
   pushed and the playbook status is tracked.

## Constraint

Do NOT mark items as implemented in the roadmap unless they have successfully
passed all QA test cases and the code review audit for the current sprint.
