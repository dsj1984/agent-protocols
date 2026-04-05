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

## Planned: Version 5.0.0 (Epic-Centric GitHub Orchestration)

Version 5.0.0 replaces the local, markdown-driven state machine (`playbook.md`,
`temp/task-state/`, `docs/sprints/`) with an **Epic-centric orchestration
layer** powered by GitHub Issues, Projects (V2), and the native GitHub API. The
human user defines an Epic in GitHub, then issues two commands from their
agentic IDE to plan and execute the entire body of work autonomously.

> **Primary Provider:** GitHub Issues + Projects (V2). The consuming project is
> assumed to be a GitHub repository. The GitHub Project board is created
> manually by the user and referenced via `orchestration.github.projectNumber`
> in `.agentrc.json`. All orchestration code is written against an
> `ITicketingProvider` interface to allow future extension to other backends
> (GitLab, Jira, Linear), but the design is **GitHub-pragmatic** — it avoids
> over-abstraction for hypothetical providers at the cost of developer
> experience.

### User Experience

The v5 UX is built around two slash commands:

| Command                     | What It Does                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sprint-plan [Epic ID]`    | Reads the Epic, generates PRD + Tech Spec as linked GitHub Issues, then decomposes into Features → Stories → Tasks with dependencies, agent prompts, and labels. |
| `/sprint-execute [Epic ID]` | Autonomous agentic execution of all Tasks under the Epic. Sends webhook notifications when HITL action is needed. Manages the full DAG lifecycle.                |

### Strategic Objective

- **Single-command planning**: The human writes a plain-English Epic description
  in GitHub. One command produces a fully structured execution plan with PRD,
  Tech Spec, tickets, dependencies, and agent prompts — all living in GitHub.
- **Single-command execution**: One command kicks off autonomous, DAG-scheduled
  agent execution across all tickets, with real-time state sync to GitHub and
  proactive HITL notifications when the human is needed.
- **Native collaboration**: Human reviewers, CI/CD runners, and agents all
  operate on the same GitHub surface — no local artifacts to synchronize.
- **API-driven state**: Ticket labels, tasklist checkboxes, and board columns
  replace fragile local JSON state files.
- **Distributed observability**: Sprint progress is visible on the GitHub
  Project board without running local telemetry scripts.

---

### §A — Provider Abstraction Layer

All ticketing interactions are mediated through a single abstract interface
defined in `.agents/scripts/lib/ITicketingProvider.js`. The concrete
implementation is selected via the `orchestration.provider` field in
`.agentrc.json`.

#### Ticketing Provider Interface (`ITicketingProvider`)

- `getEpic(epicId)` — Fetch the Epic issue with body and linked context issues.
- `getTickets(epicId, filters)` — Fetch all child tickets for an Epic.
- `getTicket(ticketId)` — Retrieve a single ticket with full metadata (title,
  labels, body, assignees).
- `getTicketDependencies(ticketId)` — Return the dependency graph edges (both
  `blocks` and `blocked_by`) as a directed acyclic graph.
- `createTicket(epicId, ticketData)` — Create a child ticket under an Epic with
  body, labels, dependencies, and tasklists.
- `updateTicket(ticketId, mutations)` — Mutate labels, body (tasklist
  checkboxes), and assignees on a ticket.
- `postComment(ticketId, payload)` — Append a structured comment (friction logs,
  progress updates, notifications).
- `createPullRequest(branchName, ticketId)` — Open a PR linking the ticket.
- `ensureLabels(labelDefs[])` — Idempotent label creation (used by bootstrap).
- `ensureProjectFields(fieldDefs[])` — Idempotent custom field creation on the
  Project board (used by bootstrap).

> **Design Note:** There is no `IExecutionAdapter` interface. The agentic IDE is
> the runtime environment, not a swappable component — the agent already has
> native access to Git, the filesystem, and the shell. Abstracting IDE
> operations behind an interface adds complexity without practical value.

**Reference Implementation:**

| Provider                      | Module                | Status                          |
| ----------------------------- | --------------------- | ------------------------------- |
| GitHub (Issues + Projects V2) | `providers/github.js` | **[PRIMARY]** Ships with v5.0.0 |
| GitLab (Issues + Boards)      | `providers/gitlab.js` | Community contribution          |
| Jira (REST v3)                | `providers/jira.js`   | Community contribution          |
| Linear (GraphQL)              | `providers/linear.js` | Community contribution          |

**Configuration (`.agentrc.json`):**

```json
{
  "orchestration": {
    "provider": "github",
    "github": {
      "owner": "my-org",
      "repo": "my-repo",
      "projectNumber": 1,
      "operatorHandle": "@my-username"
    },
    "notifications": {
      "mentionOperator": true,
      "webhookUrl": ""
    }
  }
}
```

---

### §B — Data Ontology & Work Breakdown Structure

Work is organized into a four-level hierarchy modeled entirely in GitHub Issues.
This replaces the local `docs/sprints/sprint-###/` directory structure, which is
**deprecated** in v5.

#### Work Breakdown Hierarchy

```text
Epic (type::epic)
├── PRD (context::prd)           ← generated by /sprint-plan
├── Tech Spec (context::tech-spec) ← generated by /sprint-plan
├── Feature (type::feature)      ← generated by /sprint-plan
│   ├── Story (type::story)      ← generated by /sprint-plan
│   │   ├── Task (type::task)    ← atomic agent work unit
│   │   │   ├── - [ ] subtask 1
│   │   │   └── - [ ] subtask 2
│   │   └── Task (type::task)
│   └── Story (type::story)
└── Feature (type::feature)
```

| Level       | GitHub Primitive                         | Created By     | Details                                                          |
| ----------- | ---------------------------------------- | -------------- | ---------------------------------------------------------------- |
| **Epic**    | GitHub Issue (`type::epic` label)        | Human          | High-level goal. Container for all sub-work.                     |
| **Feature** | GitHub Issue (`type::feature` label)     | `/sprint-plan` | Functional area derived from the PRD. Groups related Stories.    |
| **Story**   | GitHub Issue (`type::story` label)       | `/sprint-plan` | User-facing capability. Maps to PRD user stories / ACs.          |
| **Task**    | GitHub Issue (`type::task` label)        | `/sprint-plan` | Atomic agent work unit with instructions, labels, and tasklists. |
| **Subtask** | Tasklist checkbox (`- [ ]`) in Task body | `/sprint-plan` | Fine-grained step within a Task.                                 |

#### Planning Artifacts

| Artifact      | GitHub Primitive                           | Details                                                   |
| ------------- | ------------------------------------------ | --------------------------------------------------------- |
| **PRD**       | Linked GitHub Issue (`context::prd`)       | Generated by `/sprint-plan`. Full PRD in the issue body.  |
| **Tech Spec** | Linked GitHub Issue (`context::tech-spec`) | Generated by `/sprint-plan`. Full spec in the issue body. |

#### Execution State

| Concept          | GitHub Primitive                 | Details                                                               |
| ---------------- | -------------------------------- | --------------------------------------------------------------------- |
| **Task State**   | Ticket labels                    | `agent::ready` → `agent::executing` → `agent::review` → `agent::done` |
| **Dependencies** | `blocked by #NNN` in ticket body | DAG edges parsed by `getTicketDependencies()`.                        |
| **Friction Log** | Ticket comment                   | Structured JSON posted as a code-fenced comment.                      |
| **Test Receipt** | CI Status Check                  | GitHub Check Runs on the PR.                                          |

#### Dependency Graph & Execution Ordering

The dependency model is preserved from v4 but expressed through GitHub
primitives:

- **`depends_on` edges:** Each ticket declares blocking dependencies via
  `blocked by #NNN` in its body. The `getTicketDependencies()` provider method
  parses these into a DAG.
- **Execution labels:** Tickets carry `execution::sequential` or
  `execution::concurrent` labels to declare scheduling intent.
- **Topological scheduling:** The Dispatcher performs a topological sort of the
  DAG. Tickets with no unresolved dependencies and `execution::concurrent` are
  dispatched in parallel; those with `execution::sequential` or unresolved edges
  are queued.
- **Focus Areas:** Mapped to `focus::` labels (e.g., `focus::core`,
  `focus::scripts`). The Dispatcher prevents concurrent dispatch of tickets
  sharing a focus area to contain blast radius.

---

### §C — Context Hydration Engine

A **Context Hydrator** (`.agents/scripts/context-hydrator.js`) uses the
Ticketing Provider to assemble a "Virtual Playbook" in memory before execution.
This prevents LLM context fragmentation — the agent never reads a ticket in
isolation.

**Hydration Sequence (per ticket):**

1. **Fetch Target Ticket:** `getTicket(ticketId)` — title, labels, body
   (subtasks), assignee metadata.
2. **Traverse Up:** `getEpic(epicId)` → fetch the Epic description, then the
   linked PRD and Tech Spec issue bodies via their `context::` labels.
3. **Traverse Back:** `getTicketDependencies(ticketId)` → fetch the PR/diff of
   the immediate blocking predecessor to understand the current codebase state.
4. **Inject Global Rules:** Prepend `.agents/instructions.md` and any
   persona-specific directives derived from ticket labels (e.g.,
   `persona::fullstack`).
5. **Compile:** Assemble a high-density context string respecting
   `maxTokenBudget` from `.agentrc.json`, truncating lower-priority context
   (stale sibling diffs) when approaching limits.

**Design Constraints:**

- The Hydrator is **idempotent** — running it twice on the same ticket produces
  identical output if no upstream state has changed.
- Token budget awareness via `maxTokenBudget` from `.agentrc.json`.

---

### §D — Execution & State Management

The `/sprint-execute [Epic ID]` command triggers a DAG-scheduled execution loop
that maintains the strict Risk Gates and blast-radius containment of the v4
protocol.

**The Event Loop:**

1. **Trigger:** The human runs `/sprint-execute [Epic ID]` in their agentic IDE.
2. **Fetch:** The Dispatcher calls
   `getTickets(epicId, { label: 'agent::ready' })` via the Ticketing Provider.
3. **Schedule:** The Dispatcher builds the dependency DAG via
   `getTicketDependencies()`, performs a topological sort, and determines which
   tickets can launch immediately vs. which are queued.
4. **HITL Gate:** Tickets with `risk::high` are held for explicit human approval
   before dispatch. The Notification Engine (§E) fires an `approval-required`
   event.
5. **Hydrate:** For each dispatchable ticket, the Context Hydrator assembles the
   virtual context.
6. **Execute:** The agent creates an isolated feature branch
   (`task/epic-[ID]/[ticket-number]`), injects the hydrated context, and
   executes the ticket instructions.
7. **State Sync:** As the agent progresses, `update-ticket-state.js` performs
   real-time mutations via the provider:
   - Label transitions: `agent::ready` → `agent::executing` → `agent::review`.
   - Tasklist checkboxes: `- [ ]` → `- [x]` in the ticket body.
   - Structured progress comments via `postComment()`.
8. **Dependency Unblocking:** When a ticket reaches `agent::review` or
   `agent::done`, the Dispatcher re-evaluates the DAG and dispatches any
   newly-unblocked tickets.
9. **Completion & PR:** Upon passing shift-left validation, the agent calls
   `createPullRequest()` linking the ticket and transitions it to
   `agent::review`.
10. **Epic Completion:** When all tickets reach `agent::done`, the Notification
    Engine fires an `epic-complete` event.

**Scripts to Build or Refactor:**

- `dispatcher.js` — **[NEW]** DAG scheduler replacing the playbook-parsing entry
  point.
- `context-hydrator.js` — **[NEW]** Virtual context assembly via the Ticketing
  Provider.
- `epic-planner.js` — **[NEW]** PRD/Tech Spec generation and ticket
  decomposition for `/sprint-plan`.
- `update-ticket-state.js` — **[REFACTOR]** Rewrites `update-task-state.js` to
  route mutations through the Ticketing Provider.
- `notify.js` — **[NEW]** Unified notification dispatcher (GitHub comments +
  @mentions + webhooks).
- `providers/github.js` — **[NEW]** Reference `ITicketingProvider`
  implementation.
- `generate-playbook.js` — **[DEPRECATED]** Superseded by ticketing-native
  planning.

---

### §E — Notifications & Human-In-The-Loop (HITL)

Moving to GitHub makes HITL significantly cleaner. Notifications are dispatched
through two channels with distinct purposes:

1. **GitHub Issue Comment + @mention** — informational updates posted on the
   relevant ticket. The operator's GitHub handle (from
   `orchestration.github.operatorHandle`) is mentioned for visibility. These
   rely on GitHub's native notification system for delivery.
2. **Webhook** — the `orchestration.notifications.webhookUrl` fires with a JSON
   payload for **action-required** events. This channel is intended for
   high-priority push notifications (e.g., Pushover, Slack, Discord) that demand
   the operator's attention.

#### Notification Categories

| Event               | Type       | Channel            | Trigger                                             | Operator Action         |
| ------------------- | ---------- | ------------------ | --------------------------------------------------- | ----------------------- |
| `task-complete`     | **INFO**   | @mention           | Agent completes a Task and opens a PR               | Review when convenient  |
| `feature-complete`  | **INFO**   | @mention           | All Tasks under a Feature reach `agent::done`       | Informational only      |
| `epic-complete`     | **INFO**   | @mention + webhook | All Tasks under the Epic reach `agent::done`        | Final review            |
| `review-needed`     | **ACTION** | @mention + webhook | PR requires human review to proceed                 | Review and approve PR   |
| `approval-required` | **ACTION** | webhook            | `risk::high` Task is next in the dispatch queue     | Approve to unblock      |
| `blocked`           | **ACTION** | webhook            | Agent hits friction threshold or unresolvable error | Investigate and unblock |

- **Blocked State:** The agent calls `postComment()` with friction log payload,
  applies `status::blocked` label, and fires the webhook with an
  `action-required` payload. No more silent local file failures.
- **Review Gate:** Platform-native CI/CD (GitHub Actions) enforces branch
  protection. The agent cannot merge its own PR unless checks pass and a human
  or architect-agent approves.
- **Risk Gates (Preserved):** The semantic `riskGates.heuristics` framework from
  v3/v4 is preserved. High-risk Tasks are flagged during `/sprint-plan` with
  `risk::high`, which the Dispatcher enforces as a mandatory HITL gate.

---

### §F — Phased Implementation

v5.0.0 is developed on a dedicated `v5` branch as a clean break from v4.x. There
is no backward compatibility requirement — the v4 flat-file pipeline is fully
replaced, not incrementally migrated.

#### Phase 1 — Foundation (`v5.0.0-alpha.1`)

- Build the `ITicketingProvider` interface and the GitHub reference
  implementation (`providers/github.js`).
- Add the `orchestration` configuration block to `.agentrc.json`.
- Build the idempotent bootstrap script (`bootstrap-agent-protocols.js`) that
  creates labels, validates config, and ensures Project board custom fields. The
  GitHub Project board itself is created manually by the user and referenced via
  `orchestration.github.projectNumber`.
- **Exit Criteria:** Bootstrap runs successfully against
  `dsj1984/agent-protocols`. All labels and fields are created.

#### Phase 2 — Planning Pipeline (`v5.0.0-beta.1`)

- Build the Epic Planner (`epic-planner.js`) — reads an Epic, generates PRD +
  Tech Spec as linked GitHub Issues.
- Build the Ticket Decomposer — decomposes into Features → Stories → Tasks with
  dependencies, agent prompts, labels, and tasklists.
- Ship the `/sprint-plan [Epic ID]` workflow.
- **Exit Criteria:** `/sprint-plan` creates a fully structured Epic → Feature →
  Story → Task graph from a plain-English Epic. Dogfood on this repo's own
  development.

#### Phase 3 — Execution Engine (`v5.0.0-rc.1` → `v5.0.0`)

- Build the Dispatcher (`dispatcher.js`) — DAG scheduling from Task
  dependencies.
- Build the Context Hydrator (`context-hydrator.js`) — virtual context assembly.
- Build state sync (`update-ticket-state.js`) and notifications (`notify.js`).
- Ship the `/sprint-execute [Epic ID]` workflow.
- Replace all v4 workflows with ticketing-native equivalents.
- Remove deprecated scripts (`generate-playbook.js`, `update-task-state.js`,
  `playbook-to-tickets.js`).
- Deprecate `docs/sprints/` directory structure.
- Update documentation (SDLC.md, README.md, instructions.md).
- **Exit Criteria:** End-to-end `/sprint-plan` → `/sprint-execute` → integration
  → retro → close completes with zero local playbook artifacts. Tagged as
  `v5.0.0`.

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
