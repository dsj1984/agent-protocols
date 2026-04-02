# Project Roadmap

This document outlines the strategic priorities, upcoming feature developments,
and future architectural evolution for the Agent Protocols framework.

## Guiding Principles

- **Framework Flexibility**: Avoid overengineering that creates rigid or
  restrictive protocols. The framework must remain lightweight enough to take
  advantage of native model and tool improvements (e.g., larger context windows,
  improved reasoning, new system capabilities).
- **Self-Contained Architecture**: Minimize or eliminate external dependencies.
  Core functionality should reside within the protocol itself to maximize
  portability and security.

## Implemented: Version 3.x (Optimization & Refinement)

Version 3.x focused on internal hardening, prompt optimization, and safer
evolutionary loops.

- ✅ **Context Caching Prompt Architecture**: Restructured playbook execution
  prompts to rigidly separate static framework rules from volatile task state,
  maximizing native LLM API token caching efficiency.
- ✅ **Automated Context Pruning ("Gardener")**: Implemented a background
  archiving workflow to curate stale architectural decisions and patterns into
  `docs/archive/`, maintaining a pristine Local RAG signal-to-noise ratio.
- ✅ **Dynamic Context Boundaries (Local RAG)**: Implemented zero-dependency
  TF-IDF engine (`context-indexer.js`) for semantic retrieval and semantic
  context gathering.
- ✅ **FinOps & Token Budgeting**: Implemented `maxTokenBudget` and
  `budgetWarningThreshold` with soft-warning and hard-stop protocols. Enriched
  models.json with cost-tiering recommendations.
- ✅ **Zero-Touch Remediation Loop**: Automatically transitions agents from a
  failed `/sprint-integration` candidate check into a `/sprint-hotfix` loop,
  resolving build/test failures autonomously up to a configurable
  `maxIntegrationRetries` threshold (default: 2).
- ✅ **Dynamic Golden-Path Harvesting (Agentic RLHF)**: Implemented automated
  harvesting of zero-friction instruction-to-diff mappings into
  `.agents/golden-examples/` for dynamic few-shot prompt reinforcement.
- ✅ **Semantic Risk & Blast-Radius Gates**: Upgraded static `riskGates.words`
  to a `riskGates.heuristics` framework, enabling AI-driven semantic
  classification of destructive operations and architectural anomalies.
- ✅ **Adversarial Red-Teaming (Tribunal)**: Implemented the on-demand
  `/run-red-team` workflow for high-assurance code hardening via dynamic fuzzing
  and mutation tests.
- ✅ **Self-Healing Protocols (Retro-Augmentation)**: Updated `/sprint-retro`
  and Architect persona to generate agent-ready optimization snippets from
  friction logs.
- ✅ **Granular Human-In-The-Loop (HITL) Gates**: Implemented `riskGates`
  keyword scanning during planning to flag high-risk tasks for mandatory human
  approval.
- ✅ **Global Telemetry Reporting (Observer MVP)**: Implemented
  `aggregate-telemetry.js` to generate structured macroscopic reports on
  efficiency and tool failures.

## Implemented: Version 2.x (Continuous Evolution)

Version 2.x established the core Agentic SDLC, focusing heavily on concurrency,
stability, and testing.

- ✅ **Hybrid Integration & Blast-Radius Containment**: Introduced ephemeral
  integration candidates and `/sprint-hotfix` workflows to ensure the shared
  sprint branch never enters a broken state.
- ✅ **Advanced Concurrency Protocols**: Implemented `focusAreas` for static
  prediction of high-risk file overlaps and a **Runtime Rebase Wait-Loop** to
  eliminate complex structural conflicts.
- ✅ **Shift-Left Agentic Testing**: Mandated pre-merge testing on feature
  branches, creating cryptographic-like "test receipts" required to pass
  integration gates.
- ✅ **Decoupled Task State Tracking**: Migrated from Git-tracked playbook
  checkmarks to decoupled JSON state files (`task-state/`) to prevent race
  conditions during parallel agent execution.
- ✅ **Passive Telemetry & Diagnostic Tools**: Shipped `diagnose-friction.js` to
  intercept failing commands, log context to `agent-friction-log.json`, and
  provide auto-remediation suggestions to prevent thashing.
- ✅ **Framework Handshakes**: Hardened personas (Astro 5, Tailwind v4) to
  explicitly require ruleset ingestion before code execution.

## Implemented: Version 1.x (Foundations)

Version 1.x represented the initial release of the Agent Protocols, establishing
the baseline structure, rules, and fundamental execution pipeline.

- ✅ **Core Architecture**: Standardized the overarching framework including
  Global Instructions, Persona constraints, and domain-specific Skills.
- ✅ **Automated Sprint Planning Pipeline**: Introduced deterministic generation
  of PRDs, Technical Specs, and Playbooks via slash commands (`/plan-sprint`).
- ✅ **Fan-Out Orchestration**: Overhauled the playbook generator to support
  multi-agent parallel execution models via distinct Chat Sessions.
- ✅ **Modular Global Rules**: Split base logic into a `rules/` directory
  containing domain-agnostic standards for Git, APIs, databases, and UI
  copywriting.
- ✅ **Submodule Distribution**: Established the `dist` branch mechanism for
  consumer consumption.

## Upcoming: Version 3.x (Refinement & Standardization)

Focuses on prompt efficiency, diagnostic telemetry, and hardening existing risk
gates.

### Ephemeral Local Web Dashboard

**Concept:** Transition the Telemetry Observer from Markdown reports to an
interactive local web dashboard for richer data visualization and real-time
budget tracking.

## Future Horizon: Version 4+ (Advanced Autonomy)

Focuses on self-healing protocols, multimodal verification, and autonomous
ecosystem maintenance.

### Multimodal Visual Verification

**Concept:** Integrate vision-model capabilities into the `sprint-testing`
workflow to natively verify UI/UX regressions against Figma mockups and baseline
screenshots.

### Autonomous Protocol Evolution

**Concept:** Enable agents to autonomously draft PRDs and implementation plans
against `.agents/rules/` and `.agents/skills/` based on historical friction
logs, creating a self-healing protocol immune system.

### Cryptographic Provenance

**Concept:** Digitally sign agent-generated `test-receipts` to establish a
verifiable chain of custody for compliance and enterprise security auditing.

### Autonomous Ecosystem Upgrades

**Concept:** Deploy background "Micro-Sprints" that autonomously patch
dependencies, resolve technical debt, run shift-left test receipts, and issue
verified PRs.

### Event-Driven Headless CI/CD Execution

**Concept:** Containerize the CLI as a standard headless CI actions runner for
asynchronous background event processing (e.g., autonomous patch generation on
CI failure).

### MCP Standardization

**Concept:** Refactor internal agent scripts and diagnostic interceptors
(`context-indexer.js`, `diagnose-friction.js`) into standardized local MCP
servers, providing a rigid, native interface for LLMs and Agentic IDEs without
relying on brittle Bash execution. Deferred to v4.0 to prioritize dashboard
visualization and framework stability.

### Inter-Agent Negotiation

**Concept:** Enable dynamic cross-persona negotiation to resolve contract gaps
in real-time. Deferred to v4.0 to prioritize state-manager stability in the
interim.
