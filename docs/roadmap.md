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
- **"Shift-Left" Agentic Testing**: Merging unverified AI-generated code into a
  shared `sprint-N` branch is an anti-pattern that assumes a "happy path".
  Introduce a mandatory validation step where testing agents are forced to run
  isolated tests on their feature branch before merging. The
  `/sprint-integration` workflow will serve as a gatekeeper that only accepts
  green PRs.
- **Automated Rollback & Blast-Radius Containment**: Currently, the close-out
  process assumes zero cascading build failures upon merge. Introduce an
  explicit `/sprint-rollback` workflow that autonomously instructs the agent to
  cleanly undo an integration merge, capture the failure state into the
  `agent-friction-log.json`, and isolate the breaking changes back into the
  feature branch.
- **Advanced Concurrency & Merge Conflict Protocols**: While task statuses are
  now decoupled, autonomous agents simultaneously mutating the same codebase
  will still inevitably cause Git locks or complex structural conflicts (e.g.,
  shared UI components). Future releases will implement a file-locking mechanism
  inside `task-manifest.json` (`"locked_files": [...]`) or formally introduce a
  dedicated "Librarian Agent" responsible solely for sequencing commits.

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

### Self-Healing Protocols (Auto-Skill Generation)

**Concept**: Currently, `agent-friction-log.json` captures telemetry, and the
retro captures action items, but a human ultimately synthesizes this into
protocol rules.

**Future Capability**: Elevate the swarm to self-correct. Create a step in the
`/sprint-retro` workflow where the Architect persona analyzes the friction log
and automatically drafts PRs to update the `.agents/skills/` files. For
instance, if agents repeatedly failed on an Astro hydration issue, the system
autonomously writes a new `.agents/skills/astro-hydration-guardrails.md` rule to
permanently immunize the swarm against that mistake in future sprints.

### Granular Human-In-The-Loop (HITL) Gates

**Concept**: The current hand-off from Planning to Execution relies on a single
manual step by the PM/Operator.

**Future Capability**: Introduce a programmatic risk-scoring system during the
`/sprint-generate-tech-spec` phase. If a task involves high-risk actions—such as
destructive database migrations, modifying payment gateways, or IAM privilege
changes—the task in the manifest will be flagged with
`"requires_approval": true`. The executing agent will draft the code, pause
execution, ping the configured `webhookUrl` (e.g., Slack/Discord), and await an
explicit human ChatOps approval before committing.

### Multimodal (Vision) UI Auditing

**Concept**: The `ux-designer` and `engineer-web` personas currently evaluate
UIs via text-based code analysis and accessibility scanners, missing structural
visual hierarchy issues.

**Future Capability**: Integrate Vision-Language Models (VLMs) into the QA
phase. A specialized VLM agent will take automated screenshots of the local
frontend development server and visually compare the rendered DOM against layout
requirements, design tokens, or visual contrast rules to explicitly flag
misaligned padding, layout drift, or responsive design breakpoints.

### Event-Driven Headless CI/CD Execution

**Concept**: Workflows currently rely heavily on IDE-based slash commands (e.g.,
`/sprint-code-review`, `/sprint-integration`), keeping the orchestrator tied to
a local editor.

**Future Capability**: Transition to asynchronous, headless orchestration. Hook
the AI protocols directly into standard CI/CD pipelines (e.g., GitHub Actions).
If a test fails in the cloud or a Dependabot PR is opened, an agent autonomously
spins up, reads the CI logs, pushes a patch, and resolves the build in the
background.

### Inter-Agent Negotiation

**Concept**: Agents currently execute sequentially or in isolated parallel bands
based strictly on the static Playbook and Tech Spec.

**Future Capability**: Enable dynamic cross-persona negotiation. If a Frontend
Agent realizes an API response is missing a required field, it shouldn't fail or
hallucinate a workaround. It should initiate an autonomous sub-session to
"debate" the issue directly with the Backend Agent, updating the API contract
and the `tech-spec.md` dynamically before resuming execution.
