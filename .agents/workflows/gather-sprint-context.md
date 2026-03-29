---
description:
  Read the foundational planning and architecture files to gain full context for
  a Sprint.
---

# Gather Sprint Context

When instructed to gather sprint context, you must sequentially read the
following files to ensure you fully grasp the objectives, features, algorithms,
and technical architecture of the target sprint before proceeding.

1. `roadmap.md`: Identify the specific features slated for the requested sprint.
2. `docs/sprints/sprint-[SPRINT_NUMBER]/prd.md`: Read the Product Requirements
   Document. Pay special attention to the Acceptance Criteria to guarantee no
   business logic is overlooked.
3. `docs/sprints/sprint-[SPRINT_NUMBER]/tech-spec.md`: Review the technical
   implementation specifications, database models, and API definitions.
4. `docs/architecture.md` and `docs/data-dictionary.md` (or equivalent
   location): Ensure all APIs, UI components, and schemas align perfectly with
   the established technical architecture of the repository.

Once these files are read, summarize the core objectives internally (do not
output them to the user unless requested) and proceed with your core task.

## Constraint

You MUST read the PRD and Technical Spec in their entirety before generating any
code. Never rely on the playbook's task summary alone for business logic.
