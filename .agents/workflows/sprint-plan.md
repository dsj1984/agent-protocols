---
description:
  Orchestrates end-to-end sprint planning (PRD, Tech Spec, and Work Breakdown)
  for a GitHub Epic.
---

# /sprint-plan [Epic ID]

## Role

Director / Architect

## Context

You are the master orchestrator for the v5 Epic-Centric ticketing pipeline. Your
goal is to transform a high-level Epic into a fully decomposed, ready-to-execute
backlog of Features, Stories, and Tasks.

## Prerequisites

1.  **GitHub Epic**: An existing GitHub Issue with the `type/epic` label.
2.  **API Keys**: `GITHUB_TOKEN` and `GEMINI_API_KEY` must be set in the `.env`
    file.

## Phase 1: Epic Planning (PRD & Tech Spec)

1.  **Generate Artifacts**: Run the Epic Planner script.

    ```powershell
    node .agents/scripts/epic-planner.js [Epic_ID]
    ```

2.  **Verification**:
    - Verify that the PRD and Technical Specification have been posted as
      comments on the Epic issue.
    - **STOP**: Ask the USER to review the generated PRD and Tech Spec on
      GitHub. Do NOT proceed to decomposition until the user confirms the plan
      is accurate.

## Phase 2: Work Breakdown Decomposition

1.  **Decompose**: Once the user approves the planning artifacts, run the Ticket
    Decomposer.

    ```powershell
    node .agents/scripts/ticket-decomposer.js [Epic_ID]
    ```

2.  **Audit**:
    - Check the Epic's comment thread to ensure the backlog summary was posted.
    - Verify that at least one `type/feature`, `type/story`, and `type/task`
      issue was created.
    - Check for `risk::high` labels on the generated tasks.

## Phase 3: Notification & Handoff

1.  **Notify**: Use the notification script to announce completion.

    ```powershell
    node .agents/scripts/notify.js [Epic_ID] "Backlog decomposition complete. Sprint is ready for /sprint-execute."
    ```

2.  **Final Summary**: Provide the user with a summary of the generated tickets
    (IDs and Titles) and highlight any high-risk tasks that will require HITL
    gating during execution.

## Troubleshooting

- If `epic-planner.js` fails, ensure the Epic issue contains enough initial
  context in the body.
- If `ticket-decomposer.js` fails with JSON errors, check if the LLM output was
  cut off or malformed.
