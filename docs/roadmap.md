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

## Implemented: Version 4.x (Autonomous Efficiency & Scalability)

- ✅ **Agentic Plan Caching (APC):** Implement a novel test-time memory
  architecture to extract structured intent from successful executions,
  bypassing expensive generative dependencies for semantically similar tasks.
- ✅ **Speculative Execution & Cache-Aware Scheduling:** Establish a global
  prompt cache that maps the inputs of deterministic operations to their
  previously computed outputs, eliminating structural redundancies across
  workflows.
- ✅ **Perception-Action Event Stream:** Decouple core logic from the
  environment by shifting to an event-stream abstraction where agents read the
  history of events and produce the next atomic action.
- ✅ **Isolated Multi-Agent Parallelization**: Eliminated Git lock race
  conditions during concurrent executions via native \`git worktree\` isolation.
- ✅ **Strict Workflow Patterns**: Integrated \`Evaluator-Optimizer\` and
  \`Prompt Chaining\` pattern enforcement into the core orchestration loop.

## Implemented: Version 3.x (Optimization & Refinement)

Version 3.x focused on internal hardening, prompt optimization, and safer
evolutionary loops.

- ✅ **Exploratory Testing Integration**: Enhanced the `sprint-testing` workflow
  with a mandatory exploratory step and configurable command
  (`exploratoryTestCommand`) to identify and remediate edge cases before final
  integration.
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

## Version 4.x: Enterprise-Grade Autonomy & Scalability

Version 4 transitions the framework from sequential scripting to robust, highly
scalable, and secure engineering pipelines.

### 1. Interface Extensibility and Dynamic Tool Discovery

- **MCP Standardization:** Refactor internal agent scripts and diagnostic
  interceptors into standardized local Model Context Protocol (MCP) servers,
  moving away from brittle Bash execution to dynamic tool discovery.
- **Deep Skill Ecosystem Integration:** Implement a repository structure and
  installer interface to load role-based skill bundles (e.g., "Production
  Hardening", "SaaS MVP") directly into agent environments.
- **Universal Protocol Standardization:** Adopt an open standard for defining
  constraints via a unified agent configuration file at the repository root to
  ensure cross-platform interoperability.

### 2. Autonomous Quality Assurance and Continuous Refactoring

- **Event-Driven Headless CI/CD:** Containerize the execution interface to
  function as an actions runner, allowing agents to asynchronously resolve
  broken pipelines and issue verified pull requests without human initiation.
- **Autonomous Micro-Sprints:** Deploy specialized refactoring agents that parse
  Abstract Syntax Trees (ASTs) in the background to detect code smells and
  systematically reduce technical debt.
- **Automated Maintainability Scoring:** Integrate static code analysis tools
  via an MCP Server to provide real-time maintainability and security feedback
  directly into the agent's context window.
- **Living Documentation (Metadata Agents):** Utilize background agents to
  continuously scan for redundant patterns and automatically generate
  Architecture Decision Records (ADRs) upon feature merges.

### 3. Enterprise-Grade Security and Adversarial Resilience

- **Secure Sandboxing:** Instantiate all task sessions within ephemeral,
  containerized Linux environments to explicitly isolate system resources from
  the host environment.
- **Autonomous Red vs. Blue Teaming:** Deploy an adversarial security protocol
  during the pre-release hardening phase, pitting an Autonomous Red Team
  (attempting exploits) against an Autonomous Blue Team (building real-time
  containment).
- **Shadow Mode & Layered Guardrails:** Deploy new autonomous capabilities in a
  human-validated "shadow mode" while enforcing programmatic escalation policies
  that halt execution upon hitting confidence threshold failures.
- **Cryptographic Provenance:** Digitally sign agent-generated test receipts to
  establish an immutable, verifiable chain of custody proving code passed all
  security protocols prior to deployment.

### 4. Observability and Real-Time Telemetry

- **Ephemeral Local Web Dashboard:** Transition the Telemetry Observer from
  Markdown reports to an interactive local web dashboard for richer data
  visualization and real-time budget tracking.

## Future Horizon: Version 5+ (Advanced Autonomy)

Focuses on the ultimate expression of agentic software development: systems that
naturally evaluate external aesthetics and heal their own operational
parameters.

### Multimodal Visual Verification

**Concept:** Introduce native multimodal testing into the QA workflows. Equip
agents with advanced vision models to computationally compare application
rendering states and CSS outputs against baseline mockups, successfully catching
visual regressions that text-only DOM parsing misses.

### Autonomous Protocol Evolution

**Concept:** Implement a self-healing protocol immune system. Through continuous
analysis of execution friction logs, the overarching orchestration system will
autonomously draft and apply adjustments to its own prompt specifications,
routing logic, and skill libraries, operating via a continuous reinforcement
learning loop.
