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
- ✅ **Cryptographic Provenance:** Digitally signed agent-generated test
  receipts via asymmetric PKI to establish an immutable chain of custody prior
  to deployment.
- ✅ **Universal Protocol Standardization:** Merged all agent configuration into
  a unified `.agentrc.json` standard at the project root. Distributed via
  `.agents/default-agentrc.json`. All orchestration scripts resolve config with
  graceful backwards-compatible legacy fallback.

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
  .agentrc.json with cost-tiering recommendations.
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

## Planned: Version 5.0.0 (Distributed Ticketing Orchestration)

Version 5.0.0 is a fundamental architectural migration from a local,
markdown-driven state machine (`playbook.md`, `temp/task-state/`) to a
distributed, API-driven orchestration layer powered by external ticketing
systems and project management platforms. The framework is designed
**provider-agnostic**—all integrations target abstract interfaces that can be
implemented for any ticketing backend or agentic IDE.

> **Reference Implementation:** GitHub Issues, Projects (V2), and Actions serve
> as the first-class provider. Google Antigravity serves as the reference
> agentic IDE. All examples below use GitHub terminology, but every interaction
> is routed through a **Provider Abstraction Layer** (see §A) that can be
> swapped for Jira, Linear, GitLab, Azure DevOps, or any system exposing a
> comparable API surface.

### Strategic Objective

Eliminate the flat-file bottleneck. The current pipeline—where agents read a
local `playbook.md`, track state in `temp/task-state/*.json`, and never leave
the filesystem—has reached its architectural ceiling. Moving to an external
ticketing backend unlocks:

- **Native collaboration**: Human reviewers, CI/CD runners, and agents all
  operate on the same ticketing surface.
- **API-driven state**: Ticket labels, tasklist checkboxes, and board columns
  replace fragile JSON state files.
- **Distributed observability**: Sprint progress is visible in the project board
  without running local telemetry scripts.
- **Ecosystem integration**: Platform-native CI/CD, branch protection rules, and
  required reviews replace custom gating scripts.
- **IDE portability**: Any agentic IDE (Antigravity, Cursor, Windsurf, Claude
  Code, etc.) can serve as the compute node by implementing the Execution
  Adapter interface.

---

### §A — Provider Abstraction Layer

All ticketing and IDE interactions are mediated through two abstract interfaces
defined in `.agents/scripts/lib/`. Concrete implementations are selected via the
`provider` field in `.agentrc.json`.

#### Ticketing Provider Interface (`ITicketingProvider`)

Defines the contract for any external project management backend:

- `listSprintTickets(sprintId, filters)` — Fetch tickets for a sprint.
- `getTicket(ticketId)` — Retrieve a single ticket with full metadata.
- `getTicketDependencies(ticketId)` — Return the dependency graph edges for a
  ticket (both `blocks` and `blocked_by`).
- `updateTicketState(ticketId, labels, body)` — Mutate labels and tasklist
  checkboxes on a ticket.
- `postComment(ticketId, payload)` — Append a structured comment.
- `createPullRequest(branchName, linkedTicketId)` — Open a PR/MR linking the
  ticket.
- `getParentContext(ticketId)` — Traverse up to the epic/milestone and return
  PRD/Tech Spec content.

**Reference Implementations:**

| Provider                      | Module                | Status                          |
| ----------------------------- | --------------------- | ------------------------------- |
| GitHub (Issues + Projects V2) | `providers/github.js` | **[PRIMARY]** Ships with v5.0.0 |
| GitLab (Issues + Boards)      | `providers/gitlab.js` | Community contribution          |
| Jira (REST v3)                | `providers/jira.js`   | Community contribution          |
| Linear (GraphQL)              | `providers/linear.js` | Community contribution          |

#### Execution Adapter Interface (`IExecutionAdapter`)

Defines the contract for the agentic IDE that serves as the compute node:

- `initWorktree(branchName)` — Create an isolated workspace for execution.
- `injectContext(contextString)` — Pass the hydrated context into the LLM
  session.
- `reportProgress(ticketId, update)` — Relay state changes back through the
  ticketing provider.

The reference adapter targets Google Antigravity. Any IDE that can run Node.js
scripts and interact with Git can implement this interface.

**Configuration (`.agentrc.json`):**

```json
{
  "orchestration": {
    "ticketingProvider": "github",
    "executionAdapter": "antigravity",
    "providerConfig": {
      "github": { "owner": "my-org", "repo": "my-repo", "projectId": 42 }
    }
  }
}
```

---

### §B — Data Ontology & Primitive Mapping

Map the current markdown entity model to external ticketing primitives while
retaining the strict determinism and **execution ordering semantics** of the
existing pipeline.

#### Entity Mapping

| Current Artifact               | Ticketing Primitive                | GitHub Example                                         |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| `roadmap.md`                   | **Project Board**                  | GitHub Projects (V2) with Now/Next/Later views         |
| Epics & Sprints                | **Milestones / Iterations**        | Milestone or Iteration field `"Sprint N"`              |
| PRD & Tech Spec                | **Epic-Level Tickets / Wiki**      | Parent issues linked via `context::` labels            |
| `playbook.md`                  | **[DEPRECATED]**                   | Replaced by a filtered board view of the active sprint |
| Chat Sessions (e.g. `045.1.1`) | **Tickets**                        | Individual GitHub Issues assigned to agent persona     |
| Atomic Subtasks                | **Tasklists**                      | `- [ ]` items in the ticket body                       |
| `temp/task-state/*.json`       | **Ticket Labels & Tasklist State** | `agent::ready`, `agent::executing`, `agent::review`    |
| `agent-friction-log.json`      | **Ticket Comments**                | Structured JSON posted as code-fenced comment          |
| `test-receipt.json`            | **CI Status Checks**               | GitHub Check Runs on PR                                |

#### Dependency Graph & Execution Ordering

The current playbook encodes both **sequential dependencies** (Task B cannot
start until Task A commits) and **concurrent execution groups** (Tasks C, D, E
can run in parallel). This must be preserved in the ticketing model.

**Mechanism:**

- **`depends_on` edges:** Each ticket declares its blocking dependencies via a
  structured field (GitHub: `blocked by #NNN` in the body, or a custom Project
  field). The `getTicketDependencies()` provider method returns a directed
  acyclic graph (DAG) of ticket relationships.
- **Execution labels:** Tickets are tagged with `execution::sequential` or
  `execution::concurrent` to declare their scheduling intent. The Dispatcher
  (§D) uses these labels plus the dependency DAG to determine launch order.
- **Topological scheduling:** The Dispatcher performs a topological sort of the
  DAG at sprint start. Tickets with no unresolved dependencies and an
  `execution::concurrent` label are dispatched in parallel. Tickets with
  `execution::sequential` or unresolved `depends_on` edges are queued until
  their predecessors reach `agent::review` or `agent::done`.
- **Focus Areas (Preserved):** The existing `focusAreas` concept from the task
  manifest is mapped to ticket labels (e.g., `focus::api`, `focus::ui`). The
  Dispatcher uses these to prevent concurrent execution of tickets that share a
  focus area, preserving blast-radius containment for high-conflict zones.

---

### §C — Context Hydration Engine

The biggest risk of moving to a ticketing system is LLM context fragmentation.
The agent cannot read a single isolated ticket in a vacuum. A **Context
Hydrator** (`.agents/scripts/context-hydrator.js`) uses the Ticketing Provider
interface to assemble a "Virtual Playbook" in memory before execution begins.

**Hydration Sequence (per ticket):**

1. **Fetch Target Ticket:** Call `getTicket(ticketId)` to retrieve title,
   labels, body (subtasks), and assignee metadata.
2. **Traverse Up:** Call `getParentContext(ticketId)` to fetch the linked
   epic/milestone description and inject PRD/Tech Spec context.
3. **Traverse Back:** Call `getTicketDependencies(ticketId)` and fetch the
   PR/diff of the immediate blocking predecessor to understand the current
   architectural state of the codebase.
4. **Inject Global Rules:** Prepend `.agents/instructions.md` and any
   persona-specific directives derived from ticket labels (e.g.,
   `persona::fullstack`).
5. **Deliver:** Pass the compiled, high-density context string to the Execution
   Adapter via `injectContext()`.

**Design Constraints:**

- The Hydrator must be idempotent—running it twice on the same ticket produces
  identical output if no upstream state has changed.
- Token budget awareness: the Hydrator respects `maxTokenBudget` from
  `.agentrc.json` and truncates lower-priority context (e.g., stale sibling
  ticket diffs) when approaching limits.
- Offline fallback: if the ticketing API is unreachable, the Hydrator degrades
  gracefully to any locally cached ticket snapshots.

---

### §D — Execution & State Management (The Bridge)

The agentic IDE executes tasks and reports back to the ticketing system,
maintaining the strict Risk Gates and blast-radius containment of the original
protocol.

**The Event Loop:**

1. **Trigger:** The human operator runs `/start-sprint N` in their agentic IDE.
2. **Fetch:** The Dispatcher (`dispatcher.js`) calls
   `listSprintTickets(N, { label: 'agent::ready' })` via the Ticketing Provider.
3. **Schedule:** The Dispatcher builds the dependency DAG via
   `getTicketDependencies()`, performs a topological sort, and determines which
   tickets can be launched immediately (no unresolved dependencies) vs. queued.
4. **Hydrate:** For each dispatchable ticket, the Context Hydrator assembles the
   virtual playbook.
5. **Execute:** The Execution Adapter spins up an isolated `git worktree`,
   injects the hydrated context, and begins execution on the feature branch.
6. **State Sync:** As the agent completes subtasks, a state utility
   (`update-ticket-state.js`) calls `updateTicketState()` to perform real-time
   mutations:
   - Transitions ticket labels: `agent::ready` → `agent::executing` →
     `agent::review`.
   - Checks off tasklist items (`[x]`) in the ticket body.
   - Calls `postComment()` with structured progress payloads.
7. **Dependency Unblocking:** When a ticket reaches `agent::review`, the
   Dispatcher re-evaluates the DAG and launches any newly-unblocked tickets.
8. **Completion & PR:** Upon passing shift-left validation, the agent calls
   `createPullRequest()` linking the ticket and moves it to `agent::review`.

**Scripts to Build or Refactor:**

- `dispatcher.js` — **[NEW]** Replaces the playbook-parsing entry point. Handles
  DAG scheduling.
- `context-hydrator.js` — **[NEW]** Assembles virtual playbook via Ticketing
  Provider.
- `update-ticket-state.js` — **[REFACTOR]** Rewrites `update-task-state.js` to
  route state mutations through the Ticketing Provider interface.
- `providers/github.js` — **[NEW]** Reference `ITicketingProvider`
  implementation.
- `generate-playbook.js` — **[DEPRECATED]** Superseded by ticketing-native board
  views.

---

### §E — Human-In-The-Loop (HITL) & Error Handling

Moving to an external ticketing system makes HITL significantly cleaner and
native to standard engineering practices.

- **Blocked State:** If the agent hits an unresolvable error (friction threshold
  breached), it calls `postComment()` with the `agent-friction-log.json`
  payload, tags the human operator, and calls `updateTicketState()` to apply the
  `status::blocked` label. No more silent local file failures.
- **Review Gate:** The existing `/sprint-integration` workflow is augmented by
  platform-native CI/CD (e.g., GitHub Actions, GitLab CI). The agent cannot
  merge its own PR/MR unless platform checks pass and a human or architect-agent
  approves via the native review system.
- **Risk Gates (Preserved):** The semantic `riskGates.heuristics` framework from
  v3/v4 is preserved. High-risk tickets are flagged during planning with a
  `risk::high` label, which the Dispatcher enforces as a mandatory HITL gate
  before execution begins.

---

### §F — Phased Implementation & Cutover Strategy

A four-phase migration plan to transition without breaking the current SDLC.

#### Phase 1 — Read-Only Mapping (Shadow Mode)

- Continue generating `playbook.md` via the existing pipeline.
- Build a script that parses the playbook and automatically generates **mirrored
  tickets** via the Ticketing Provider.
- Run agents locally against the playbook as usual; validate that the ticket
  mirror accurately reflects execution state.
- **Exit Criteria:** 100% fidelity between local task-state JSON and ticket
  labels/state for one full sprint.

#### Phase 2 — Context Hydration (Read from Ticketing)

- Build the Context Hydration Engine (`context-hydrator.js`).
- Stop feeding agents the local `playbook.md` and force context assembly via the
  Ticketing Provider API.
- Continue writing state locally as a safety net.
- **Exit Criteria:** Agents complete a sprint using only hydrated ticket context
  with zero context-related friction log entries.

#### Phase 3 — State Mutation (Write to Ticketing)

- Deprecate `temp/task-state/`.
- Rewrite `update-task-state.js` → `update-ticket-state.js` to route all state
  mutations through the Ticketing Provider interface.
- **Exit Criteria:** No local state files are written during sprint execution;
  all state is queryable via the ticketing platform.

#### Phase 4 — Full Cutover

- Deprecate `/sprint-generate-playbook`.
- Planning agents write directly to the project board via the Ticketing Provider
  API.
- `playbook.md` is no longer generated; the filtered board view is the single
  source of truth.
- Archive `generate-playbook.js` and legacy state scripts.
- **Exit Criteria:** End-to-end sprint (plan → execute → integrate → retro)
  completes with zero local markdown artifacts outside of `docs/`.

---

## Future Horizons

### MCP-Native Tooling Layer

- **MCP Standardization:** Refactor the Context Hydrator, Dispatcher, and
  state-sync utilities into standardized local **Model Context Protocol (MCP)
  servers**, replacing brittle script execution with dynamic tool discovery.
  Platform-specific MCP servers (e.g., GitHub MCP) become first-class
  dependencies.
- **Deep Skill Ecosystem Integration:** Implement a repository structure and
  installer interface to load role-based skill bundles (e.g., "Production
  Hardening", "SaaS MVP") directly into agent environments.

### Observability & Real-Time Telemetry

- **Companion Dashboard:** With sprint state living in the ticketing platform,
  the dashboard concept evolves into a **companion view** that augments the
  platform's native boards with agent-specific metrics (token spend, friction
  density, cycle time per ticket).
- **Automated Maintainability Scoring:** Integrate static code analysis tools
  via an MCP Server to provide real-time maintainability and security feedback
  as CI check annotations on PRs/MRs.

### Autonomous Quality Assurance

- **Event-Driven Headless CI/CD:** Containerize the agentic execution interface
  as a self-hosted CI runner (e.g., GitHub Actions runner, GitLab Runner).
  Agents asynchronously resolve broken pipelines and issue verified PRs without
  human initiation—triggered directly by webhook events.
- **Autonomous Micro-Sprints:** Deploy specialized refactoring agents that parse
  Abstract Syntax Trees (ASTs) in the background, filing tickets for detected
  code smells and systematically reducing technical debt via automated PRs.
- **Living Documentation (Metadata Agents):** Background agents continuously
  scan for redundant patterns and automatically generate Architecture Decision
  Records (ADRs) as wiki pages upon feature merges.
- **Autonomous Red vs. Blue Teaming:** Deploy adversarial security protocols
  during pre-release hardening, with Red Team findings filed as security
  advisories and Blue Team containment tracked as linked tickets.

### Multimodal Visual Verification

- **Concept:** Introduce native multimodal testing into the QA workflows. Equip
  agents with vision models to compare application rendering states against
  baseline mockups, posting visual diff screenshots as PR/MR review comments.
  This catches regressions that text-only DOM parsing misses.

### Autonomous Protocol Evolution

- **Concept:** Implement a self-healing protocol immune system. Through
  continuous analysis of execution friction logs (posted as ticket comments),
  the orchestration system autonomously drafts PRs to adjust its own prompt
  specifications, routing logic, and skill libraries—operating via a continuous
  reinforcement learning loop with the ticketing platform as the audit trail.
