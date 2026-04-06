# Project Roadmap

This document outlines the strategic priorities, upcoming feature developments,
and future architectural evolution for the Agent Protocols framework.

> **Note:** Version history for v1.x through v4.x has been archived to
> [docs/CHANGELOG-v4.md](./CHANGELOG-v4.md).

## Guiding Principles

- **Framework Flexibility**: Avoid overengineering that creates rigid or
  restrictive protocols. The framework must remain lightweight enough to take
  advantage of native model and tool improvements (e.g., larger context windows,
  improved reasoning, new system capabilities).
- **Self-Contained Architecture**: Minimize or eliminate external dependencies.
  Core functionality should reside within the protocol itself to maximize
  portability and security.

---

## Current: Version 5.0.0 (Epic-Centric GitHub Orchestration)

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

> **Design Note:** The execution environment is abstracted behind an
> `IExecutionAdapter` interface, enabling the same Dispatcher to drive manual
> IDE sessions (HITL), headless subprocess workers, or cloud-hosted agent
> runtimes. The v5.0.0 reference implementation is the
> `ManualDispatchAdapter` — future adapters for Antigravity CLI, Claude Code,
> Codex, and MCP dispatch are planned.

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
1. **Traverse Up:** `getEpic(epicId)` → fetch the Epic description, then the
   linked PRD and Tech Spec issue bodies via their `context::` labels.
1. **Traverse Back:** `getTicketDependencies(ticketId)` → fetch the PR/diff of
   the immediate blocking predecessor to understand the current codebase state.
1. **Inject Global Rules:** Prepend `.agents/instructions.md` and any
   persona-specific directives derived from ticket labels (e.g.,
   `persona::fullstack`).
1. **Compile:** Assemble a high-density context string respecting
   `maxTokenBudget` from `.agentrc.json`, truncating lower-priority context
   (stale sibling diffs) when approaching limits.

**Design Constraints:**

- The Hydrator is **idempotent** — running it twice on the same ticket produces
  identical output if no upstream state has changed.
- Token budget awareness via `maxTokenBudget` from `.agentrc.json`.

---

### §D — Execution & State Management

The `/sprint-execute [Epic ID]` command triggers a DAG-scheduled execution loop.

**The Event Loop:**

1. **Trigger:** The human runs `/sprint-execute [Epic ID]` in their agentic IDE.
1. **Fetch:** The Dispatcher calls
   `getTickets(epicId, { label: 'agent::ready' })` via the Ticketing Provider.
1. **Schedule:** The Dispatcher builds the dependency DAG via
   `getTicketDependencies()`, performs a topological sort, and determines which
   tickets can launch immediately vs. which are queued.
1. **HITL Gate:** Tickets with `risk::high` are held for explicit human approval
   before dispatch. The Notification Engine (§E) fires an `approval-required`
   event.
1. **Hydrate:** For each dispatchable ticket, the Context Hydrator assembles the
   virtual context.
1. **Execute:** The agent creates an isolated feature branch
   (`task/epic-[ID]/[ticket-number]`), injects the hydrated context, and
   executes the ticket instructions.
1. **State Sync:** As the agent progresses, `update-ticket-state.js` performs
   real-time mutations via the provider:
   - Label transitions: `agent::ready` → `agent::executing` → `agent::review`.
   - Tasklist checkboxes: `- [ ]` → `- [x]` in the ticket body.
   - Structured progress comments via `postComment()`.
1. **Dependency Unblocking:** When a ticket reaches `agent::review` or
   `agent::done`, the Dispatcher re-evaluates the DAG and dispatches any
   newly-unblocked tickets.
1. **Completion & PR:** Upon passing shift-left validation, the agent calls
   `createPullRequest()` linking the ticket and transitions it to
   `agent::review`.
1. **Epic Completion:** When all tickets reach `agent::done`, the Notification
    Engine fires an `epic-complete` event.

---

### §E — Notifications & Human-In-The-Loop (HITL)

Notifications are dispatched through two channels with distinct purposes:

1. **GitHub Issue Comment + @mention** — informational updates posted on the
   relevant ticket. The operator's GitHub handle (from
   `orchestration.github.operatorHandle`) is mentioned for visibility. These
   rely on GitHub's native notification system for delivery.
1. **Webhook** — the `orchestration.notifications.webhookUrl` fires with a JSON
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

---

### §F — Phased Implementation

v5.0.0 is developed on a dedicated `v5` branch as a clean break from v4.x.
There is no backward compatibility requirement.

#### Phase 1 — Foundation (`v5.0.0-alpha.1`)

- Build the `ITicketingProvider` interface and the GitHub reference
  implementation (`providers/github.js`).
- Add the `orchestration` configuration block to `.agentrc.json`.
- Build the idempotent bootstrap script (`bootstrap-agent-protocols.js`) that
  creates labels, validates config, and ensures Project board custom fields.
- **Exit Criteria:** Bootstrap runs successfully against
  `dsj1984/agent-protocols`. All labels and fields are created.

#### Phase 2 — Planning Pipeline (`v5.0.0-beta.1`)

- Build the Epic Planner (`epic-planner.js`) — reads an Epic, generates PRD +
  Tech Spec as linked GitHub Issues.
- Build the Ticket Decomposer — decomposes into Features → Stories → Tasks with
  dependencies, agent prompts, labels, and tasklists.
- Ship the `/sprint-plan [Epic ID]` workflow.
- **Exit Criteria:** `/sprint-plan` creates a fully structured Epic → Feature →
  Story → Task graph from a plain-English Epic.

#### Phase 3 — Execution Engine (`v5.0.0-rc.1` → `v5.0.0`)

- Build the Dispatcher (`dispatcher.js`) — DAG scheduling from Task
  dependencies.
- Build the Context Hydrator (`context-hydrator.js`) — virtual context assembly.
- Build state sync (`update-ticket-state.js`) and notifications (`notify.js`).
- Ship the `/sprint-execute [Epic ID]` workflow.
- Replace all v4 workflows with ticketing-native equivalents.
- Build automated roadmap generation (`generate-roadmap.js`).
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

### Observability & Real-Time Telemetry

- **Automated Maintainability Scoring:** Integrate static code analysis tools
  via an MCP Server to provide real-time maintainability and security feedback
  as CI check annotations on PRs/MRs.

### Autonomous Quality Assurance

- **Event-Driven Headless CI/CD:** Containerize the agentic execution interface
  as a self-hosted CI runner (e.g., GitHub Actions runner, GitLab Runner).
  Agents asynchronously resolve broken pipelines and issue verified PRs without
  human initiation—triggered directly by webhook events.

### Multimodal Visual Verification

- **Concept:** Introduce native multimodal testing into the QA workflows. Equip
  agents with vision models to compare application rendering states against
  baseline mockups, posting visual diff screenshots as PR/MR review comments.
  This catches regressions that text-only DOM parsing misses.

### Autonomous Protocol Evolution

- **Concept:** Implement a self-healing protocol that analyzes execution
  friction logs (posted as ticket comments) to autonomously propose PRs that
  refine its own prompt specifications and routing logic based on real-world
  performance.

### Post-v5 Backlog (Under Consideration)

- **Complexity Estimator as Validation Pass:** The v4 `ComplexityEstimator.js`
  is removed in v5.0.0. If dogfooding reveals that the LLM-based decomposer
  produces over-complex Tasks, re-introduce complexity scoring as a validation
  pass inside `ticket-decomposer.js`.
