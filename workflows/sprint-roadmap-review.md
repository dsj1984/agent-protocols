---
description: analyze and decompose upcoming sprints in roadmap.md
---

# Sprint Roadmap Review

Use this workflow to groom the `docs/roadmap.md` file, identifying sprints that
are over-scoped or features that are too vague/monolithic for efficient
execution.

## 🛠️ Step-by-Step Execution

1.  **Read the Roadmap**: Ingest the current `docs/roadmap.md`.
2.  **Filter Active Sprints**: Identify sprints in the "Current & Upcoming"
    section that are NOT marked as `Completed`.
3.  **Analyze Complexity**: Evaluate each identified sprint based on these
    criteria:
    - **Feature Count**: Does the sprint contain more than 10 major bullet
      points? If yes, it's a candidate for splitting.
    - **Monolith Keywords**: Flag features containing terms like "Entire," "Full
      System," "Implement Engine," "Migration" (without sub-steps).
    - **Vagueness**: Flag features that lack at least 2-3 specific sub-tasks or
      implementation boundaries.
4.  **Propose Decomposition**:
    - **Split Sprint**: If a sprint is too heavy, recommend a "Part 1" and "Part
      2" approach or moving low-priority features back to the "Horizon."
    - **Sub-task Injection**: If a feature is monolithic, propose a set of
      smaller, atomic sub-tasks.
5.  **Alignment Check**: Ensure that upcoming sprints contain the foundational
    work (e.g., Auth, Schema) required by later sprints.
6.  **Update Strategy**: Present the proposed decomposition to the user for
    approval. Upon approval, update the `docs/roadmap.md`.

---

## 💡 Heuristic Guidance

- **Task Density**: Successful agentic sprints typically have between 4-7 atomic
  features. Sprints with >10 items often lead to merge conflicts and context
  bloat.
- **Dependency Flow**: A well-scoped roadmap prioritizes Infrastructure -> API
  -> UI. Flag any roadmap where this order is reversed.
- **Horizon Management**: Moving an over-scoped feature back to "Horizon H1" is
  better than execution failure.

---

## Constraint

- **ReadOnly Protection**: Do NOT modify features marked as `(✅ Completed)` or
  `(🚀 Active)` unless explicitly requested by the user.
- **Horizon Integrity**: Do NOT move features from a Sprint back to the
  "Horizon" without providing a clear rationale regarding technical debt or
  dependency blockers.
- **Decomposition Accuracy**: Ensure that split features maintain the original
  Acceptance Criteria and user value.
