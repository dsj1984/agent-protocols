---
description: Create the sprint branch and initialize the sprint directory
---

# Sprint Setup Workflow

## Context

This workflow is used to initialize a new sprint. It handles the creation of the
sprint-specific branch and the base directory structure, ensuring a clean state
for subsequent planning and execution.

**Target Sprint:** `[SPRINT_NUMBER]`

## Step 1 - Normalize Sprint Number

1.  Pad the `[SPRINT_NUMBER]` to three digits (e.g., `40` becomes `040`).
2.  Use this padded version for all subsequent steps.

## Step 2 - Environment Reset

1.  Checkout the `main` branch: `git checkout main`.
2.  Pull the latest changes from origin: `git pull origin main`.

## Step 3 - Sprint Branch Creation

1.  Verify if the sprint branch `sprint-[PADDED_NUM]` already exists:
    - `git branch --list sprint-[PADDED_NUM]`
2.  If the branch **does not** exist:
    - Create it: `git checkout -b sprint-[PADDED_NUM]`.
    - Push to origin: `git push -u origin sprint-[PADDED_NUM]`.
3.  If the branch **does exist**:
    - Checkout the existing branch: `git checkout sprint-[PADDED_NUM]`.
    - Sync with origin: `git pull origin sprint-[PADDED_NUM]`.

## Step 4 - Directory Initialization

1.  Create the sprint directory if it doesn't exist:
    - `mkdir docs/sprints/sprint-[PADDED_NUM]`
2.  Initialize the agent observability log (JSON Lines format) if it doesn't
    exist:
    - `echo "" > docs/sprints/sprint-[PADDED_NUM]/agent-friction-log.json`
3.  Verify the directory exists.

## Step 5 - Finalization

1.  Confirm to the user that the environment is ready for sprint planning on
    branch `sprint-[PADDED_NUM]`.

## Constraint

Adhere strictly to the naming conventions and ensure the branch is pushed to
origin before concluding.
