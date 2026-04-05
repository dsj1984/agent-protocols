---
description: Start and implement a single task from the GitHub backlog.
---

# /sprint-execute [Issue ID]

## Role

Engineer / Developer

## Context

You are an autonomous agent executing a specific technical task from the v5
GitHub backlog. Your goal is to implement, test, and submit the requested
changes while maintaining strict linkage to the parent Story and Feature.

## Step 1 - Context Gathering

1.  **Read Ticket**: Fetch and read the full content of GitHub
    Issue #[Issue_ID].
2.  **Verify Prerequisites**:
    - Ensure all `Blocked By` issues in the `Metadata` section are **CLOSED**.
    - If any blocker is open, **STOP** and alert the user.
3.  **Trace Hierarchy**: Read the parent Story and Feature issues linked in the
    `Metadata` to understand the broader context.

## Step 2 - Implementation Plan

1.  **Read Docs**: Read the PRD and Tech Spec on the parent Epic for
    architectural constraints.
2.  **Analyze Reach**: Identify all files that will be affected by this task.
3.  **Draft Plan**: Create a local `.task_plan.md` (scratch) outlining the
    specific code changes.

## Step 3 - Branch & Implement

1.  **Branching**: Create a new task-specific branch: `task/#[Issue_ID]-[slug]`.
2.  **Write Code**: Implement the changes following the `Instructions` in the
    Issue.
3.  **Local Validation**: Run the `testCommand` defined in `.agentrc.json`.

## Step 4 - Commit & PR

1.  **Commit**: Commit changes with a message linked to the issue:
    `feat: [Task Name] (resolves #[Issue_ID])`.
2.  **Push**: Push the branch to origin.
3.  **PR**: Create a Pull Request against the base branch (default: `main`).
    - The PR description MUST include: `Closes #[Issue_ID]`.

## Step 5 - Finalize

1.  **Update Issue**: Add a comment to #[Issue_ID] with the PR link.
2.  **HITL Gate**: If the task was flagged as `risk::high`, wait for human
    review of the PR before merging.
3.  **Cleanup**: Delete the branch once merged.
