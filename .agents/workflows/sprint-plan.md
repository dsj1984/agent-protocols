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

## Constraint

- Do not modify existing issues without explicit permission.
- Wait for user validation before migrating to Phase 2.

## Prerequisites

1. **GitHub Epic**: An existing GitHub Issue with the `type/epic` label.
2. **API Keys**: `GITHUB_TOKEN` and `GEMINI_API_KEY` must be set in the `.env`
   file.

## Phase 0: Re-Plan Detection

Before generating any artifacts, check whether the Epic has already been planned.

1. **Fetch Epic**: Read the Epic issue body and check for a `## Planning
   Artifacts` section containing PRD and Tech Spec references.
2. **If already planned**: Inform the user that this Epic already has planning
   artifacts. Ask:

   > "Epic #[ID] already has PRD (#XX) and Tech Spec (#XX) with YY decomposed
   > tickets. Do you want to **re-plan** from scratch? This will close the old
   > PRD, Tech Spec, and all Feature/Story/Task tickets and regenerate them."

3. **If user confirms re-plan**: Pass `--force` to all subsequent script
   invocations. This will:
   - Close old PRD and Tech Spec issues (reason: `not_planned`).
   - Close all existing Feature, Story, and Task child issues.
   - Strip the `## Planning Artifacts` section from the Epic body.
   - Regenerate everything fresh.
4. **If user declines**: Abort gracefully.

## Phase 1: Epic Planning (PRD & Tech Spec)

1. **Generate Artifacts**: Run the Epic Planner script.

   ```powershell
   # Normal planning
   node .agents/scripts/epic-planner.js --epic [Epic_ID]

   # Re-planning (force regeneration)
   node .agents/scripts/epic-planner.js --epic [Epic_ID] --force
   ```

2. **Verification**:
   - Verify that the PRD and Technical Specification have been posted as
     comments on the Epic issue.
   - **STOP**: Ask the USER to review the generated PRD and Tech Spec on
     GitHub. Do NOT proceed to decomposition until the user confirms the plan
     is accurate.

## Phase 2: Work Breakdown Decomposition

1. **Decompose**: Once the user approves the planning artifacts, run the Ticket
   Decomposer.

   ```powershell
   # Normal decomposition
   node .agents/scripts/ticket-decomposer.js --epic [Epic_ID]

   # Re-planning (close old tickets first)
   node .agents/scripts/ticket-decomposer.js --epic [Epic_ID] --force
   ```

2. **Cross-Validation**:
   - **Verify**: every PRD feature -> Feature issue -> at least one Story -> at
     least one Task.
   - **Verify**: dependency DAG across Tasks is acyclic (no circular deps).
   - **Verify**: risk::high Tasks are flagged correctly.
   - **Action**: Fix any gaps by creating additional issues or updating
     existing ones manually.

3. **Audit**:
   - Check the Epic's comment thread to ensure the backlog summary was posted.
   - Verify that at least one `type/feature`, `type/story`, and `type/task`
     issue was created.

## Phase 3: Notification & Handoff

1. **Notify Operator (INFO)**:
   - Post a summary comment on the Epic issue with work breakdown stats.
   - @mention the operator (informational — no webhook for planning) by running
     the notification script:

   ```powershell
   node .agents/scripts/notify.js [Epic_ID] "Planning complete, review tickets. Backlog decomposition complete. Sprint is ready for /sprint-execute." --action
   ```

2. **Final Summary**: Provide the user with a summary of the generated tickets
   (IDs and Titles) and highlight any high-risk tasks that will require HITL
   gating during execution.

## Troubleshooting

- If `epic-planner.js` fails, ensure the Epic issue contains enough initial
  context in the body.
- If `ticket-decomposer.js` fails with JSON errors, check if the LLM output was
  cut off or malformed.
