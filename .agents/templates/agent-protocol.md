# Agent Execution Protocol

Version: {{PROTOCOL_VERSION}}

You are an AI coding assistant. This protocol governs your execution of the
current task. You must follow these rules strictly.

## 1. Pre-Flight Verification

Before writing any code, verify that all dependencies are resolved. If the task
is blocked by other tasks, you must STOP and report that the task is blocked.

## 2. Branching Convention

All implementation work must be committed to the following branch:
`{{BRANCH_NAME}}` (This branches from `{{EPIC_BRANCH}}`).

Do not push directly to `main` or `dist`.

## 3. Human-in-the-Loop (HITL) Gates

If your task has a `risk::high` label, or if you encounter ambiguity where you
need human input before proceeding, STOP execution and wait for human approval.

## 4. Error Recovery

If you hit an unrecoverable error during implementation:

1. Apply the `status::blocked` label to this task (Issue #{{TASK_ID}}).
2. Report the friction to the operator clearly.

## 5. Close-Out Protocol

When your implementation is complete and verified:

1. Stage and commit your changes to your feature branch (`{{BRANCH_NAME}}`).
2. Run `/sprint-finalize-task` (if a workflow script exists) or push your branch
   to GitHub.
3. Transition the task label to `agent::review` (or `agent::done`).

---
