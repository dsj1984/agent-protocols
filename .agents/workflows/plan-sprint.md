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

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agentrc.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Roadmap Review

Run the `/sprint-roadmap-review` workflow for the `[SPRINT_NUMBER]`.

1. Read `[WORKFLOWS_ROOT]/sprint-roadmap-review.md` to understand your
   instructions.
2. Execute the steps described in `sprint-roadmap-review.md`.
3. **User Alert**: If you suggest any changes to the scope (splitting sprints,
   decomposing features, or moving items), you MUST **STOP** and alert the user.
   Do NOT proceed to the next step until the user has approved the updated
   `[DOCS_ROOT]/roadmap.md`.

## Step 2 - Environment Preparation

1.  Checkout the base branch (default: `main`) defined in `.agentrc.json`.
2.  Pull the latest changes from origin.
3.  Ensure the working directory is clean. If there are uncommitted changes,
    **STOP** and alert the user.
4.  **Purge Prior Artifacts**: If `[SPRINT_ROOT]` already exists, delete it
    entirely (`rm -rf [SPRINT_ROOT]`) to guarantee a clean slate. Planning MUST
    NOT be influenced by documents from a prior run.
5.  Recreate the directory: `mkdir -p [SPRINT_ROOT]`.

## Step 3 - Product Requirements Document Generation

Run the `/sprint-generate-prd` workflow for the `[SPRINT_NUMBER]`.

1. Read `[WORKFLOWS_ROOT]/sprint-generate-prd.md` to understand your
   instructions.
2. Execute the steps described in `sprint-generate-prd.md`.
3. Verify that `[SPRINT_ROOT]/prd.md` has been successfully created.

## Step 4 - Architecture Review & Tech Spec Generation

Run the `/sprint-generate-tech-spec` workflow for the `[SPRINT_NUMBER]`.

1. Read `[WORKFLOWS_ROOT]/sprint-generate-tech-spec.md` to understand your
   instructions.
1. Execute the steps described in `sprint-generate-tech-spec.md`.
1. Verify that `[SPRINT_ROOT]/tech-spec.md` has been successfully created.

## Step 5 - Playbook Generation

Run the `/sprint-generate-playbook` workflow for the `[SPRINT_NUMBER]`.

1. Read `[WORKFLOWS_ROOT]/sprint-generate-playbook.md` to understand your
   instructions.
1. Execute the steps described in `sprint-generate-playbook.md`.
1. Verify that `[SPRINT_ROOT]/playbook.md` has been successfully created.

## Step 6 - Alignment & Consistency Audit

1.  Adopt the `architect` persona.
2.  Perform a cross-artifact review of the generated `prd.md`, `tech-spec.md`,
    and `playbook.md`.
3.  **Verify Consistency**:
    - Ensure all features in the PRD are mapped to technical designs in the Tech
      Spec.
    - Ensure all technical designs have corresponding tasks in the Playbook.
    - Check that sprint numbers, dates, and versioning across all files are
      identical and strictly follow the padding standard (e.g.,
      `sprintNumberPadding` in config) for the sprint version (e.g., `040`).
    - **Verify Protocol Version**: Confirm that `agent-protocols` version in
      `prd.md`, `tech-spec.md`, `task-manifest.json`, and `playbook.md` matches
      the current version in `.agents/VERSION`. If there is a mismatch, you MUST
      alert the user and regenerate the affected artifacts.
4.  **Verify Protocol Adherence**:
    - Confirm the Playbook tasks follow the mandatory bookend order (Integration
      → QA → Code Review → Retro).
    - Confirm all tasks have associated personas, models, and skills.
5.  If any inconsistencies are found, fix the source manifest or document and
    regenerate as needed before proceeding.

## Step 7 - Commit & Push Planning Artifacts

1.  Stage the generated artifacts: `git add [SPRINT_ROOT]`.
2.  Commit the changes:
    `git commit -m "docs: planning artifacts for sprint [SPRINT_NUMBER]"`.
3.  Push to origin: `git push origin [BASE_BRANCH]`.

## Step 8 - Sprint Setup

Run the `/sprint-setup` workflow for the `[SPRINT_NUMBER]`.

1.  Read `[WORKFLOWS_ROOT]/sprint-setup.md` to understand your instructions.
2.  Execute the steps described in `sprint-setup.md`.
3.  Verify that the branch `sprint-[PADDED_NUM]` has been created and pushed to
    origin.

## Step 9 - Notification

Upon successful completion of all planning and audit steps, notify the user that
the planning artifacts for Sprint `[SPRINT_NUMBER]` are committed to `main` and
the sprint branch is ready for execution.

## Constraint

Adhere strictly to the templates and instructions provided.
