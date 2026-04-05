---
description: Create the sprint branch and initialize the sprint directory
---

# Sprint Setup

## Context

This workflow is used to initialize a new sprint. It handles the creation of the
sprint-specific branch and the base directory structure, ensuring a clean state
for subsequent planning and execution.

**Target Sprint:** `[SPRINT_NUMBER]`

## Step 1 - Normalize Sprint Number

1.  Resolve `[PADDED_NUM]` by padding the `[SPRINT_NUMBER]` based on the
    `sprintNumberPadding` field in `.agentrc.json` (e.g., if padding is `3`,
    `40` becomes `040`).
2.  Use this padded version for all subsequent steps.

## Step 2 - Repository Hygiene & Environment Reset

1.  Resolve `[BASE_BRANCH]` from the `baseBranch` field in `.agentrc.json`
    (default: `main`).
2.  Perform repository maintenance:
    - Run `git fetch origin --prune` to clean up deleted remote branches.
    - Run `git gc --auto` to optimize local repository size and performance.
3.  Ensure the working directory is clean (e.g., using `git status`). If there
    are uncommitted changes, **STOP** and alert the user to stash or commit them
    before initializing a sprint.
4.  Checkout the base branch: `git checkout [BASE_BRANCH]`.
5.  Pull the latest changes from origin: `git pull origin [BASE_BRANCH]`.

## Step 3 - Sprint Branch Creation

1.  Verify if the sprint branch `sprint-[PADDED_NUM]` already exists:
    - `git branch --list sprint-[PADDED_NUM]`
2.  If the branch **does not** exist:
    - Create it: `git checkout -b sprint-[PADDED_NUM]`.
    - Push to origin: `git push -u origin sprint-[PADDED_NUM]`.
3.  If the branch **does exist**:
    - Checkout the existing branch: `git checkout sprint-[PADDED_NUM]`.
    - Sync with origin: `git pull origin sprint-[PADDED_NUM]`.
4.  Capture the sprint's initial lint baseline to prevent integration
    regressions:
    - `node [SCRIPTS_ROOT]/lint-baseline.js capture`

## Step 4 - Directory Initialization

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` defined in `.agentrc.json` (default: `docs/sprints`).
2.  Create the sprint directory if it doesn't exist: `mkdir -p [SPRINT_ROOT]`.
3.  Initialize the agent observability log (JSON Lines format) if it doesn't
    exist:
    `node -e "import('fs').then(fs => fs.writeFileSync('[SPRINT_ROOT]/agent-friction-log.json', ''))"`.
4.  Verify the directory exists.

## Step 5 - Finalization

1.  Confirm to the user that the environment is ready for sprint planning on
    branch `sprint-[PADDED_NUM]`.

## Constraint

Adhere strictly to the naming conventions and ensure the branch is pushed to
origin before concluding.
