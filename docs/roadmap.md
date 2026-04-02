# Project Roadmap

This document outlines the strategic priorities, upcoming feature developments,
and future architectural evolution for the Agent Protocols framework.

## Currently Active (v2.18.0)

- **Centralized Configuration**: Extracted all hardcoded paths and branch
  namespaces into `.agents/config/config.json`.
- **Cross-Platform Scripting**: Replaced OS-dependent shell commands with
  deterministic Node.js scripts for notifications, conflict detection, and
  prerequisite verification.
- **Decoupled Task State**: Transitioned to `task-state/[TASK_ID].json` files
  for thread-safe concurrent execution.

## Planned (Next)

- **Enhanced Diagnostic Tools**: Further development of automated
  troubleshooting scripts and telemetry collectors.
- **Persona Specialization**: Refining role-specific behavior constraints for
  emerging frameworks (e.g., Astro 5, Tailwind 4).

## Future Horizon

### Dynamic Context Boundaries (RAG vs. Static Reading)

**Current State**: Agents rely on Context7 MCP to mandate live documentation
retrieval, loading flat markdown files like `architecture.md` and
`data-dictionary.md`.

**Improvement**: As the monorepo scales, loading monolithic markdown files will
blow out context windows, increase API costs, and degrade model reasoning (the
"lost-in-the-middle" phenomenon). Future iterations should transition to a
Retrieval-Augmented Generation (RAG) or semantic vector search. Agents should
query an index to retrieve only the specific schemas and ADRs relevant to their
immediate micro-task.

### FinOps & Token Budgeting

**Current State**: Guardrails rely on `frictionThresholds` and
`maxInstructionSteps` in `.agents/config/config.json` to prevent thrashing.

**Improvement**: Parallel AI agents can quietly burn through massive API budgets
if they get stuck in subtle loops that don't trigger the exact error thresholds.
Future versions of `config.json` should expand to include a `maxTokenBudget` per
task or sprint. Agents should halt execution and trigger a human override if
they exceed their allocated financial budget, providing a hard economic ceiling
on automated development cycles.
