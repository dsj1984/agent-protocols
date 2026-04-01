---
description:
  Perform Sprint Retrospective, update documentation, and align the roadmap.
---

# Sprint Retro & Roadmap Alignment

When instructed to perform a sprint retro and align the roadmap (typically in
Chat Session 5), you must execute the following steps:

1. **Generate Retro Document**: Generate a
   `docs/sprints/sprint-[SPRINT_NUMBER]/retro.md` file using the
   `.agents/templates/sprint-retro-template.md` template.
2. **Analyze the Sprint**: Analyze the sprint execution logs, test results,
   commits, and the `agent-friction-log.json` to accurately fill in the Sprint
   Scorecard, What Went Well, What Could Be Improved, Architectural Debt, and
   Protocol Automation & Optimization Recommendations sections in the retro
   document.
3. **Formulate Action Items**: Create clear, actionable items for the next
   sprint based on the retro analysis.
4. **Update Roadmap**: Open `roadmap.md` and mark newly completed items as
   `✅ Implemented`. Note: Do NOT add new protocol-related action items to the
   roadmap; these should remain in the retro document for later implementation
   in the `agent-protocols` repository.
5. **Update Architecture**: Update `architecture.md` if any core patterns,
   schemas, or dependencies were introduced or changed during this sprint.
6. **Finalize**: Use the `/sprint-finalize-task` workflow for your task ID
   (e.g., `39.8.1`) to ensure the retro documentation and roadmap updates are
   pushed and the playbook status is tracked.

## Constraint

Do NOT mark items as implemented in the roadmap unless they have successfully
passed all QA test cases and the code review audit for the current sprint.
