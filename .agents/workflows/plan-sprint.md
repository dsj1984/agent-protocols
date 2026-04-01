---
description:
  Sequentially execute PRD, Tech Spec, and Playbook workflows for a sprint
---

# Master Sprint Planning Workflow

## Role

Director

## Context & Objective

Your objective is to trigger the end-to-end planning process for a given sprint
number. This single orchestrator workflow handles the sequential execution of
the PRD, Tech Spec, and Playbook generation workflows to fully automate the
sprint planning pipeline.

## Step 0 - Sprint Setup

Run the `/sprint-setup` workflow for the `[SPRINT_NUMBER]`.

1. Read `.agents/workflows/sprint-setup.md` to understand your instructions.
2. Execute the steps described in `sprint-setup.md`.
3. Verify that the branch `sprint-[SPRINT_NUMBER]` (padded to 3 digits) has been
   created and pushed to origin.

## Step 1 - Product Requirements Document Generation

Run the `/generate-prd` workflow for the `[SPRINT_NUMBER]`.

1. Read `.agents/workflows/generate-prd.md` to understand your instructions.
1. Execute the steps described in `generate-prd.md` as if you were running the
   command yourself.
1. Verify that `docs/sprints/sprint-[SPRINT_NUMBER]/prd.md` has been
   successfully created.

## Step 2 - Architecture Review & Tech Spec Generation

Run the `/generate-tech-spec` workflow for the `[SPRINT_NUMBER]`.

1. Read `.agents/workflows/generate-tech-spec.md` to understand your
   instructions.
1. Execute the steps described in `generate-tech-spec.md`.
1. Verify that `docs/sprints/sprint-[SPRINT_NUMBER]/tech-spec.md` has been
   successfully created.

## Step 3 - Playbook Generation

Run the `/generate-sprint-playbook` workflow for the `[SPRINT_NUMBER]`.

1. Read `.agents/workflows/generate-sprint-playbook.md` to understand your
   instructions.
1. Execute the steps described in `generate-sprint-playbook.md`.
1. Verify that `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md` has been
   successfully created.

## Step 4 - Alignment & Consistency Audit

1.  Adopt the `architect` persona.
2.  Perform a cross-artifact review of the generated `prd.md`, `tech-spec.md`,
    and `playbook.md`.
3.  **Verify Consistency**:
    - Ensure all features in the PRD are mapped to technical designs in the Tech
      Spec.
    - Ensure all technical designs have corresponding tasks in the Playbook.
    - Check that sprint numbers, dates, and versioning across all files are
      identical and strictly follow the three-digit padding standard (e.g.,
      `040`).
4.  **Verify Protocol Adherence**:
    - Confirm the Playbook tasks follow the mandatory bookend order (Integration
      → QA → Code Review → Retro).
    - Confirm all tasks have associated personas, models, and skills.
5.  If any inconsistencies are found, fix the source manifest or document and
    regenerate as needed before proceeding.

## Step 5 - Notification

Upon successful completion of all planning and audit steps, notify the user that
the planning artifacts and the final playbook for Sprint `[SPRINT_NUMBER]` are
audited and ready for execution.

## Constraint

Adhere strictly to the templates and instructions provided.
