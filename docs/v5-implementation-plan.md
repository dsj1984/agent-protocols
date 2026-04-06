# Version 5.0.0 Implementation Plan

> **Dogfooding Strategy:** This project (`dsj1984/agent-protocols`) serves as
> both the codebase being developed **and** the first consumer of the v5
> Epic-centric orchestration. v5 is developed on a dedicated `v5` branch as a
> clean break from v4.x — proving the architecture on itself before release.

---

## Guiding Constraints

- **Clean Break:** v5 is built on a `v5` branch. There is no backward
  compatibility requirement with v4.x. The flat-file pipeline (`playbook.md`,
  `temp/task-state/`, `docs/sprints/`) is fully replaced, not incrementally
  migrated.
- **Ship Incrementally:** Each phase is a tagged pre-release (`v5.0.0-alpha.1`,
  `v5.0.0-beta.1`, `v5.0.0-rc.1`) so early adopters can opt-in.
- **Test-Driven:** Every new module ships with co-located unit tests in
  `tests/`. Integration tests run against the live GitHub API using this repo's
  own issues and project board.
- **GitHub-Pragmatic:** All code is written against the `ITicketingProvider`
  interface for extensibility, but the design prioritizes a clean GitHub
  developer experience over hypothetical multi-provider parity. No direct GitHub
  API calls outside of `providers/github.js`.

---

## Phase 1 — Foundation

> **Goal:** Build the provider abstraction layer, the GitHub reference
> implementation, and the automated bootstrap script. By the end of this phase,
> any consumer can run `/bootstrap-agent-protocols` to initialize their GitHub
> repo with the required labels and project board fields.
>
> **Tag:** `v5.0.0-alpha.1`

### Sprint 1A: Provider Abstraction Layer

**Scope:** Define the abstract interface and add the `orchestration`
configuration schema.

| Task                                                             | Type   | File(s)                                            | Depends On | Status |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------- | ---------- | ------ |
| Define `ITicketingProvider` interface with all method signatures | NEW    | `.agents/scripts/lib/ITicketingProvider.js`        | —          | [x]    |
| Add `orchestration` schema to `.agentrc.json`                    | MODIFY | `.agents/default-agentrc.json`, `.agents/schemas/` | —          | [x]    |
| Update `config-resolver.js` to parse `orchestration` block       | MODIFY | `.agents/scripts/lib/config-resolver.js`           | Schema     | [x]    |
| Unit tests for interface contracts (method signature validation) | NEW    | `tests/ticketing-provider.test.js`                 | Interface  | [x]    |

**Interface Definition (`ITicketingProvider`):**

```js
class ITicketingProvider {
  // --- Read Operations ---
  async getEpic(epicId) {}
  async getTickets(epicId, filters = {}) {}
  async getTicket(ticketId) {}
  async getTicketDependencies(ticketId) {}

  // --- Write Operations ---
  async createTicket(epicId, ticketData) {}
  async updateTicket(ticketId, mutations) {}
  async postComment(ticketId, payload) {}
  async createPullRequest(branchName, ticketId) {}

  // --- Setup Operations (used by bootstrap) ---
  async ensureLabels(labelDefs) {}
  async ensureProjectFields(fieldDefs) {}
}
```

> **Design Note:** There is no `IExecutionAdapter` interface. The agentic IDE is
> the runtime environment — the agent already has native access to Git, the
> filesystem, and the shell. Abstracting IDE operations behind an interface adds
> complexity without practical value.

**Configuration Schema (`orchestration` block):**

```json
{
  "orchestration": {
    "provider": "github",
    "github": {
      "owner": "dsj1984",
      "repo": "agent-protocols",
      "projectNumber": null,
      "operatorHandle": "@dsj1984"
    },
    "notifications": {
      "mentionOperator": true,
      "webhookUrl": ""
    }
  }
}
```

Key decisions:

- `provider` selects the concrete implementation. Only `"github"` ships in
  v5.0.0.
- `github.projectNumber` is a manual config value — the user creates the GitHub
  Project manually and enters the number here. This allows multiple projects per
  repo if desired. If `null`, the bootstrap and dispatcher skip
  project-board-level operations.
- `github.operatorHandle` is the GitHub username to @mention in informational
  notifications.
- Future providers (GitLab, Jira, Linear) would add their own config block
  alongside `github` and set `provider` accordingly.

### Sprint 1B: GitHub Provider

**Scope:** Build the GitHub reference implementation of `ITicketingProvider`.

| Task                                                                            | Type | File(s)                                   | Depends On  | Status |
| ------------------------------------------------------------------------------- | ---- | ----------------------------------------- | ----------- | ------ |
| Build `providers/github.js` — `getEpic()`, `getTickets()` (read)                | NEW  | `.agents/scripts/providers/github.js`     | Interface   | [x]    |
| Build `providers/github.js` — `getTicket()` (read)                              | NEW  | (same file)                               | Interface   | [x]    |
| Build `providers/github.js` — `getTicketDependencies()` (read)                  | NEW  | (same file)                               | `getTicket` | [x]    |
| Build `providers/github.js` — `createTicket()` (write)                          | NEW  | (same file)                               | Interface   | [x]    |
| Build `providers/github.js` — `updateTicket()`, `postComment()` (write)         | NEW  | (same file)                               | Interface   | [x]    |
| Build `providers/github.js` — `createPullRequest()` (write)                     | NEW  | (same file)                               | Interface   | [x]    |
| Build `providers/github.js` — `ensureLabels()`, `ensureProjectFields()` (setup) | NEW  | (same file)                               | Interface   | [x]    |
| Build provider factory — resolves `orchestration.provider` to class             | NEW  | `.agents/scripts/lib/provider-factory.js` | Config      | [x]    |
| Unit tests for GitHub provider (mocked API responses)                           | NEW  | `tests/providers-github.test.js`          | Provider    | [x]    |

**API Strategy:**

The GitHub provider uses:

- **REST API** (`@octokit/rest` or raw `fetch`) for Issues, Labels, Milestones,
  Pull Requests — these are well-supported and straightforward.
- **GraphQL API** (`@octokit/graphql` or raw `fetch`) for Projects V2 custom
  fields — the REST API does not support Projects V2 mutations.
- **GitHub MCP Server** — when running inside an MCP-capable IDE, the provider
  can optionally delegate to the `github-mcp-server` tools for read operations.
  This is an optimization, not a requirement — the provider must work standalone
  via API calls.

**Authentication:**

The provider reads the GitHub token from:

1. `GITHUB_TOKEN` environment variable (standard in CI/CD and most IDEs)
2. `gh auth token` CLI fallback (for local development with GitHub CLI)
3. Fails with a clear error message if neither is available

**Dependency Decision:**

The GitHub provider should use raw `fetch()` (available in Node 20+) to avoid
adding `@octokit/*` as a dependency. This aligns with the project's
"Self-Contained Architecture" guiding principle. GraphQL queries are handwritten
template strings.

### Sprint 1C: Bootstrap

**Scope:** Build the idempotent bootstrap script and its workflow entry point.

| Task                                                                               | Type   | File(s)                                          | Depends On | Status |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------ | ---------- | ------ |
| Build `bootstrap-agent-protocols.js` — idempotent label + field setup via provider | NEW    | `.agents/scripts/bootstrap-agent-protocols.js`   | Provider   | [x]    |
| Add `/bootstrap-agent-protocols` workflow                                          | NEW    | `.agents/workflows/bootstrap-agent-protocols.md` | Script     | [x]    |
| Unit tests for bootstrap (mocked provider)                                         | NEW    | `tests/bootstrap.test.js`                        | Bootstrap  | [x]    |
| Integration test: run bootstrap against this repo's own GitHub repo                | NEW    | `tests/bootstrap.integration.js`                 | All above  | [x]    |
| Update `tests/structure.test.js` to validate new file locations                    | MODIFY | `tests/structure.test.js`                        | —          | [x]    |

**What the Bootstrap Creates:**

1. **Label Taxonomy** (idempotent — skips existing labels):

| Category    | Labels                                                                      | Color                  |
| ----------- | --------------------------------------------------------------------------- | ---------------------- |
| Type        | `type::epic`, `type::feature`, `type::story`, `type::task`                  | `#7057FF` (purple)     |
| Agent State | `agent::ready`, `agent::executing`, `agent::review`, `agent::done`          | `#0E8A16` (green)      |
| Status      | `status::blocked`                                                           | `#D93F0B` (red)        |
| Risk        | `risk::high`, `risk::medium`                                                | `#FBCA04` (yellow)     |
| Persona     | `persona::fullstack`, `persona::architect`, `persona::qa`                   | `#C5DEF5` (blue)       |
| Context     | `context::prd`, `context::tech-spec`                                        | `#D4C5F9` (purple)     |
| Execution   | `execution::sequential`, `execution::concurrent`                            | `#F9D0C4` (peach)      |
| Focus       | `focus::core`, `focus::scripts`, `focus::docs`, `focus::ci`, `focus::tests` | `#BFD4F2` (light blue) |

1. **Project Board Custom Fields** (if `projectNumber` is configured):
   - `Sprint` (Iteration) — maps to sprint/epic numbers
   - `Execution` (Single Select) — values: `sequential`, `concurrent`
   - `Focus Area` (Single Select) — values: `core`, `scripts`, `docs`, `ci`,
     `tests`

2. **Validation:**
   - Verify GitHub API access (token permissions: `repo`, `project`)
   - Verify `orchestration.github.owner` and `repo` are accessible
   - Print summary of created vs. skipped resources

**NOT in Bootstrap** (human responsibility):

- Creating the GitHub repository (already exists)
- Creating the GitHub Project (manual — the user references it via
  `orchestration.github.projectNumber` in config)
- Creating Epics (this is the human's creative act)

**Workflow:**

```text
/bootstrap-agent-protocols [--provider github]
```

Reads `orchestration` from `.agentrc.json`, instantiates the correct provider
via the provider factory, and runs the idempotent setup sequence.

### Sprint 1D: Dogfood — Bootstrap This Project

**Scope:** Run `/bootstrap-agent-protocols` against `dsj1984/agent-protocols` to
create the labels and custom fields that all subsequent phases will target.

| Task                                                                        | Type   | File(s)             | Depends On | Status |
| --------------------------------------------------------------------------- | ------ | ------------------- | ---------- | ------ |
| Configure `.agentrc.json` with `orchestration` block pointing to this repo  | MODIFY | `.agentrc.json`     | Sprint 1A  | [x]    |
| Run `/bootstrap-agent-protocols --provider github`                          | MANUAL | Antigravity session | Sprint 1C  | [x]\*  |
| Verify all labels created with correct colors                               | MANUAL | GitHub UI / API     | —          | [x]    |
| Verify project board fields (if projectNumber configured)                   | MANUAL | GitHub UI           | —          | [x]    |
| **(\*) Initial run hit auth issues; re-run with GITHUB_TOKEN to finalize.** |        |                     |            |        |

### Phase 1 Exit Criteria

- [x] `ITicketingProvider` interface defined with full method signatures.
- [x] `providers/github.js` implements all read, write, and setup methods.
- [x] Provider factory resolves `orchestration.provider` to the correct class.
- [x] `bootstrap-agent-protocols.js` is idempotent and creates all required
      labels.
- [x] This repo's own GitHub labels are created via the bootstrap script
      (Agent-authenticated).
- [x] All existing `npm test` and `npm run lint` checks pass (263/263).
- [ ] Tagged as `v5.0.0-alpha.1`. (Pending final commit)

---

## Phase 2 — Planning Pipeline

> **Goal:** Build the `/sprint-plan [Epic ID]` workflow. A human writes a
> plain-English Epic in GitHub, runs one command, and gets a fully structured
> work breakdown (Features → Stories → Tasks) with PRD, Tech Spec, dependencies,
> agent prompts, and labels — all living in GitHub.
>
> **Tag:** `v5.0.0-beta.1`

### Sprint 2A: Epic Planner — PRD & Tech Spec Generation

**Scope:** Build the planner that reads an Epic and generates PRD + Tech Spec as
linked GitHub Issues.

| Task                                                                                 | Type   | File(s)                           | Depends On |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------- | ---------- |
| Build `epic-planner.js` — reads Epic body, generates PRD content                     | NEW    | `.agents/scripts/epic-planner.js` | Phase 1    |
| Extend `epic-planner.js` — generates Tech Spec content from PRD + project docs       | MODIFY | (same file)                       | PRD gen    |
| Create PRD as linked GitHub Issue with `context::prd` label via provider             | MODIFY | (same file)                       | Provider   |
| Create Tech Spec as linked GitHub Issue with `context::tech-spec` label via provider | MODIFY | (same file)                       | Provider   |
| Unit tests for epic planner (mocked provider + mocked LLM output)                    | NEW    | `tests/epic-planner.test.js`      | Planner    |

**PRD + Tech Spec Storage Model:**

PRD and Tech Spec are stored as **dedicated GitHub Issues linked to the Epic**:

- The Epic issue body contains the human-authored goal description
- The PRD issue is created with label `context::prd` and body
  `blocked by #[Epic ID]`
- The Tech Spec issue is created with label `context::tech-spec` and body
  `blocked by #[PRD ID]`
- Both issues are cross-linked to the Epic via GitHub's task list syntax in the
  Epic body: `- [ ] #[PRD ID]` and `- [ ] #[Tech Spec ID]`

The PRD and Tech Spec follow standardized templates adapted for the GitHub Issue
body format (no frontmatter, adjusted heading levels). The local `docs/sprints/`
directory is deprecated in v5.

### Sprint 2B: Work Breakdown Decomposition

**Scope:** Build the decomposer that reads a PRD + Tech Spec and creates the
full Epic → Feature → Story → Task hierarchy with execution metadata.

| Task                                                                                 | Type   | File(s)                                | Depends On |
| ------------------------------------------------------------------------------------ | ------ | -------------------------------------- | ---------- |
| Build `ticket-decomposer.js` — reads PRD + Tech Spec, creates Features/Stories/Tasks | NEW    | `.agents/scripts/ticket-decomposer.js` | Phase 1    |
| Feature template — groups related Stories under a functional area                    | NEW    | `.agents/templates/feature-body.md`    | —          |
| Story template — user-facing capability with acceptance criteria                     | NEW    | `.agents/templates/story-body.md`      | —          |
| Task template — atomic agent work unit with prompt and subtasks                      | NEW    | `.agents/templates/task-body.md`       | —          |
| Dependency wiring — `blocked by #NNN` in ticket bodies, DAG validation               | MODIFY | (same file)                            | Provider   |
| Label assignment — type, persona, execution mode, focus area, risk level per ticket  | MODIFY | (same file)                            | Provider   |
| Complexity scoring — apply `riskGates.heuristics` to flag `risk::high` Tasks         | MODIFY | (same file)                            | Config     |
| Unit tests for ticket decomposer (mocked provider)                                   | NEW    | `tests/ticket-decomposer.test.js`      | Decomposer |

**Ticket Body Templates:**

Each level of the hierarchy uses a standardized template:

**Feature (`type::feature`):**

```markdown
## Context

> Epic: #[EPIC_ID] — [Epic Title] PRD: #[PRD_ID] | Tech Spec: #[TECH_SPEC_ID]

## Scope

[Description of this functional area and what it encompasses.]

## Stories

- [ ] #[STORY_ID_1] — [Story title]
- [ ] #[STORY_ID_2] — [Story title]
```

**Story (`type::story`):**

```markdown
## Context

> Epic: #[EPIC_ID] | Feature: #[FEATURE_ID] PRD: #[PRD_ID] | Tech
> Spec: #[TECH_SPEC_ID]

## User Story

As a [persona], I want [capability] so that [benefit].

## Acceptance Criteria

- [ ] [AC 1]
- [ ] [AC 2]

## Tasks

- [ ] #[TASK_ID_1] — [Task title]
- [ ] #[TASK_ID_2] — [Task title]
```

**Task (`type::task`):**

```markdown
## Context

> Epic: #[EPIC_ID] | Feature: #[FEATURE_ID] | Story: #[STORY_ID] PRD: #[PRD_ID]
> | Tech Spec: #[TECH_SPEC_ID]

blocked by #[DEPENDENCY_TASK_IDS]

## Agent Prompt

[Detailed implementation instructions for the agent, including:]

- Files to create/modify
- Acceptance criteria from the parent Story
- Technical approach from the Tech Spec
- Persona and skill requirements

## Subtasks

- [ ] [Atomic subtask 1]
- [ ] [Atomic subtask 2]
- [ ] [Atomic subtask 3]

## Metadata

- **Persona:** `persona::fullstack`
- **Model:** Claude Sonnet 4.6 (Thinking)
- **Skills:** `core/git-workflow-and-versioning`, `stack/backend/...`
- **Focus Area:** `focus::core`
- **Execution:** `execution::sequential`
- **Estimated Files:** 5
```

These templates replace the `task-manifest.json` + `playbook.md` generation
pipeline. The structured ticket body **is** the playbook entry for that work
item.

### Sprint 2C: `/sprint-plan` Workflow

**Scope:** Wire everything together into the `/sprint-plan [Epic ID]`
orchestrator workflow.

| Task                                                                           | Type   | File(s)                            | Depends On   |
| ------------------------------------------------------------------------------ | ------ | ---------------------------------- | ------------ |
| Build `/sprint-plan` workflow — orchestrates Epic Planner + Ticket Decomposer  | NEW    | `.agents/workflows/sprint-plan.md` | Sprints 2A-B |
| Cross-validation step — every PRD feature → tech spec → Feature → Story → Task | MODIFY | `.agents/scripts/epic-planner.js`  | Decomposer   |
| Operator notification — "Planning complete, review tickets" (INFO: @mention)   | MODIFY | (same file)                        | Notify       |
| Build `notify.js` — dual-channel notification (INFO=@mention, ACTION=webhook)  | NEW    | `.agents/scripts/notify.js`        | Provider     |
| Unit tests for notify                                                          | NEW    | `tests/notify.test.js`             | Notify       |

**`/sprint-plan [Epic ID]` Workflow:**

```text
/sprint-plan [Epic ID]

Step 0 — Resolve Configuration
  Read orchestration config from .agentrc.json.
  Instantiate provider via provider factory.

Step 1 — Fetch Epic
  Call provider.getEpic(epicId).
  Validate the Epic has a type::epic label and a non-empty body.

Step 2 — Generate PRD
  Adopt the product persona.
  Read the Epic body + project docs (architecture.md, data-dictionary.md, etc.).
  Generate the PRD content.
  Create a linked GitHub Issue with context::prd label via provider.createTicket().
  Update the Epic body with a task list reference to the PRD issue.

Step 3 — Generate Tech Spec
  Adopt the architect persona.
  Read the PRD issue body + project docs.
  Generate the Tech Spec content.
  Create a linked GitHub Issue with context::tech-spec label via provider.createTicket().
  Update the Epic body with a task list reference to the Tech Spec issue.

Step 4 — Decompose into Features → Stories → Tasks
  Read the PRD + Tech Spec issue bodies.
  Identify functional areas (Features) from the PRD.
  For each Feature:
    Create a GitHub Issue with type::feature label.
    Derive user Stories from PRD acceptance criteria.
    For each Story:
      Create a GitHub Issue with type::story label.
      Generate atomic Tasks with agent prompts from the Tech Spec.
      For each Task:
        Create a GitHub Issue with type::task label, structured body,
        labels, and dependencies.
  Update the Epic body with a task list of all Feature references.

Step 5 — Cross-Validation
  Adopt the architect persona.
  Verify: every PRD feature → Feature issue → at least one Story → at
    least one Task.
  Verify: dependency DAG across Tasks is acyclic (no circular deps).
  Verify: risk::high Tasks are flagged correctly.
  Fix any gaps by creating additional issues or updating existing ones.

Step 6 — Notify Operator (INFO)
  Post a summary comment on the Epic issue with work breakdown stats.
  @mention the operator (informational — no webhook for planning).
```

### Sprint 2D: Dogfood — Plan a Real Epic

**Scope:** Create a real Epic on this repo and run `/sprint-plan [Epic ID]`
end-to-end.

| Task                                                             | Type   | File(s)             | Depends On |
| ---------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Create an Epic issue on `dsj1984/agent-protocols` for a v5 phase | MANUAL | GitHub UI           | —          |
| Run `/sprint-plan [Epic ID]` in Antigravity                      | MANUAL | Antigravity session | Sprint 2C  |
| Verify PRD + Tech Spec issues created with correct labels/links  | MANUAL | GitHub UI           | —          |
| Verify Feature → Story → Task hierarchy with correct labels      | MANUAL | GitHub UI           | —          |
| Verify Task dependencies + prompts are correct                   | MANUAL | GitHub UI           | —          |
| Verify DAG is valid (no circular deps, correct ordering)         | MANUAL | GitHub UI / script  | —          |

### Phase 2 Exit Criteria

- [x] `epic-planner.js` generates PRD + Tech Spec as linked GitHub Issues.
- [x] `ticket-decomposer.js` creates the full Feature → Story → Task hierarchy
      with dependencies, labels, prompts, and tasklists.
- [x] `/sprint-plan [Epic ID]` orchestrates the full pipeline end-to-end.
- [x] `notify.js` dispatches INFO via @mention and ACTION via webhook.
- [x] Dogfood: a real Epic on this repo is fully planned via the command.
- [ ] Tagged as `v5.0.0-beta.1`.

---

## Phase 3 — Execution Engine

> **Goal:** Build the `/sprint-execute [Epic ID]` workflow. The agent
> autonomously executes all Tasks under an Epic, syncing state to GitHub in
> real-time and sending webhook notifications when HITL action is needed. The
> execution environment is abstracted behind an `IExecutionAdapter` interface,
> enabling the same Dispatcher to drive manual IDE sessions, headless subprocess
> workers, or cloud-hosted agent runtimes.
>
> **Tag:** `v5.0.0-rc.1` → `v5.0.0`

### Execution Adapter Abstraction

The execution environment is a **swappable component**, just like the ticketing
system. A new `IExecutionAdapter` interface sits alongside `ITicketingProvider`
as a first-class abstraction, enabling support for Antigravity, Claude Code,
Codex, or any future agentic IDE without code changes.

**Interface Definition (`IExecutionAdapter`):**

```js
class IExecutionAdapter {
  /**
   * Returns the capabilities of this execution environment.
   * The Dispatcher uses this to validate model/mode selections.
   *
   * @returns {{
   *   name: string,                    // e.g. "antigravity", "claude-code"
   *   supportsParallelism: boolean,    // Can run multiple tasks concurrently?
   *   supportedModels: string[],       // Models available in this environment
   *   supportedModes: string[],        // e.g. ["planning", "fast"]
   *   maxConcurrency: number | null,   // Hard limit, or null for unlimited
   *   requiresOperator: boolean        // Does a human need to act on dispatch?
   * }}
   */
  async getCapabilities() {}

  /**
   * Dispatch a task for execution. What this means depends on the adapter:
   *   - ManualDispatchAdapter: adds to the manifest, prints operator instructions
   *   - SubprocessAdapter: spawns a child process with AgentLoopRunner
   *   - CLIAdapter: invokes `antigravity --new-chat` or `claude-code open`
   *
   * @param {object} taskConfig
   * @param {number} taskConfig.taskId       - GitHub Issue number
   * @param {string} taskConfig.title        - Human-readable task title
   * @param {string} taskConfig.branch       - Git branch to create
   * @param {string} taskConfig.model        - Recommended model name
   * @param {string} taskConfig.mode         - "planning" | "fast"
   * @param {string} taskConfig.persona      - Persona to adopt
   * @param {string[]} taskConfig.skills     - Skills to activate
   * @param {string} taskConfig.prompt       - Hydrated agent prompt
   * @param {object} taskConfig.metadata     - Full ticket metadata
   *
   * @returns {{ dispatched: boolean, handle: string | null, message: string }}
   */
  async dispatchTask(taskConfig) {}

  /**
   * Check the execution status of a previously dispatched task.
   * For adapters that delegate to external systems (IDE, human), this
   * typically polls the ticketing provider for label state changes.
   *
   * @param {string} handle - The handle returned by dispatchTask()
   * @returns {{ status: "pending"|"executing"|"completed"|"failed"|"cancelled",
   *             exitReason?: string }}
   */
  async getTaskStatus(handle) {}

  /**
   * Request cancellation of a running task. Best-effort — not all adapters
   * can force-stop an executing agent.
   *
   * @param {string} handle
   * @returns {{ cancelled: boolean, message: string }}
   */
  async cancelTask(handle) {}

  /**
   * Called once after all tasks in a wave have been dispatched.
   * Adapters use this for batch-level operations:
   *   - ManualDispatchAdapter: prints the manifest table, fires webhook
   *   - CLIAdapter: might open a monitoring dashboard
   *
   * @param {object[]} dispatchedTasks - Array of taskConfigs that were dispatched
   * @returns {void}
   */
  async onWaveDispatched(dispatchedTasks) {}
}
```

> **Design Note:** The `IExecutionAdapter` separates **what to run**
> (Dispatcher's responsibility) from **how to run it** (adapter's
> responsibility). The adapter receives a fully hydrated prompt from the Context
> Hydrator — it dispatches, it does not execute. Execution happens in the target
> environment.

**Reference Implementation — `ManualDispatchAdapter`:**

The HITL adapter for v5.0.0. The Dispatcher generates a structured **Dispatch
Manifest** — a table of Tasks ready for execution, each annotated with the
recommended model, mode, branch name, and command. The operator opens one IDE
chat per Task, selects the recommended model, and runs
`/sprint-execute #[Task ID]`. Webhook notifications fire at each wave
transition so the operator knows when to return for the next batch.

**Configuration (`orchestration` block):**

```json
{
  "orchestration": {
    "provider": "github",
    "executor": "manual",
    "github": { "..." },
    "execution": {
      "maxConcurrentTasks": 4,
      "modelSelection": "cascade",
      "focusAreaConflicts": "hard-block",
      "waveAdvancement": "webhook-and-wait"
    },
    "notifications": { "..." }
  }
}
```

| Field                | Values                                   | Description                                             |
| -------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `executor`           | `"manual"`, `"subprocess"`, `"cli"`      | Selects the `IExecutionAdapter` implementation          |
| `maxConcurrentTasks` | number                                   | Hard limit on wave size enforced by Dispatcher          |
| `modelSelection`     | `"cascade"`, `"global-only"`, `"ticket"` | Which tiers of the model cascade to use                 |
| `focusAreaConflicts` | `"hard-block"`, `"warn"`                 | Dispatcher behavior for overlapping `focus::` labels    |
| `waveAdvancement`    | `"webhook-and-wait"`, `"auto-compute"`   | What happens when a wave completes                      |

**Model Selection Cascade:**

Model recommendations follow a three-tier override cascade. For the
`ManualDispatchAdapter`, the resolved model is a **recommendation** — the
operator has final say when opening the IDE session. For future autonomous
adapters, the resolved model is **binding**.

```text
┌─────────────────────────────────────┐
│ 1. Task-Level (ticket body)         │  ← highest priority
│    **Model:** Claude Opus 4.6       │
├─────────────────────────────────────┤
│ 2. Type-Level (bookendRequirements) │  ← role-based defaults
│    isQA → Sonnet 4.6 (Thinking)    │
│    isCodeReview → Sonnet 4.6       │
├─────────────────────────────────────┤
│ 3. Global Default (defaultModels)   │  ← floor
│    planningFallback / fastFallback  │
└─────────────────────────────────────┘
```

**Future Adapter Roadmap:**

| Adapter                  | `executor` value | How It Dispatches                          | Status                      |
| ------------------------ | ---------------- | ------------------------------------------ | --------------------------- |
| `ManualDispatchAdapter`  | `"manual"`       | Prints manifest, fires webhook             | **v5.0.0**                  |
| `AntigravityCLIAdapter`  | `"antigravity"`  | `antigravity --new-chat` CLI               | Future (pending CLI support) |
| `ClaudeCodeAdapter`      | `"claude-code"`  | `claude-code` CLI session                  | Future                      |
| `CodexAdapter`           | `"codex"`        | OpenAI Codex API                           | Future                      |
| `SubprocessAdapter`      | `"subprocess"`   | `child_process.fork(AgentLoopRunner)`      | Future                      |
| `MCPAdapter`             | `"mcp"`          | MCP tool dispatch                          | Future (pending MCP spec)   |

### Agent Execution Protocol Template

In v4, the `Renderer.js` embedded a rich Agent Execution Protocol (pre-flight
verification, branching instructions, close-out procedure, error recovery, HITL
gates) directly into the playbook markdown for each task. In v5, this protocol
is split between **ticket metadata** and a **universal protocol template**
using the **Hybrid** approach:

**Ticket Body** carries task-specific data:

- Instructions (implementation steps)
- Verification criteria (acceptance checklist)
- Metadata section: persona, model, mode, skills, focus area, blocked-by refs
- Protocol version used during generation

**`agent-protocol.md` Template** carries universal execution rules:

- Pre-flight verification (check all blocked-by tickets are resolved)
- Branching convention (with `{{BRANCH_NAME}}` placeholder)
- Close-out protocol (finalize via `/sprint-finalize-task`)
- Error recovery (apply `status::blocked`, alert operator)
- HITL gate rules (stop for `risk::high` labels)
- Protocol version stamp for the execution session

**Context Hydrator** assembles the full prompt at dispatch time:

1. Read `agent-protocol.md`, substitute `{{BRANCH_NAME}}`, `{{TASK_ID}}`,
   `{{EPIC_BRANCH}}` with runtime values from the Dispatcher
2. Read the persona file from `.agents/personas/{{PERSONA}}.md`
3. Read each skill file from `.agents/skills/{{SKILL}}/SKILL.md`
4. Traverse ticket hierarchy for context (Task → Story → Feature → Epic → PRD +
   Tech Spec)
5. Read the Task body (instructions + verification criteria)
6. Assemble all sections into a single hydrated prompt string
7. Pass to `adapter.dispatchTask({ ..., prompt })`

> **Design Note — Metadata in Prompt Text:** Persona and skill directives are
> NOT stored only as GitHub labels — they are included in the **hydrated prompt
> text** so the agent can load and follow them. Labels provide machine-readable
> indexing; the prompt provides the actual behavioral instructions.

**Protocol Version Tracking:**

Each ticket records the protocol version at two lifecycle points:

- **Generation-time:** The `ticket-decomposer.js` stamps `protocol-version::
  X.Y.Z` (from `.agents/VERSION`) in the ticket metadata when creating the
  Task during `/sprint-plan`.
- **Execution-time:** The Context Hydrator stamps the current runtime protocol
  version into the hydrated prompt. If there is a version mismatch between
  generation and execution, a warning is emitted in the Dispatch Manifest.

This enables post-hoc auditing of which protocol version governed each task's
planning and execution.

### Bookend Lifecycle Phases

In v4, bookend tasks (Integration, QA, Code Review, Retro, Close Sprint) were
discrete tasks in the playbook with deterministic ordering. In v5, **bookends
are lifecycle phases** orchestrated by `/sprint-execute` — they are NOT
individual GitHub tickets.

After all Task waves complete (all Tasks under the Epic reach `agent::done`),
`/sprint-execute` automatically transitions into the bookend lifecycle:

```text
All Tasks agent::done
  │
  ├─→ Phase: Integration
  │     Run sprint-integration workflow (merge PRs, resolve conflicts)
  │     Uses persona/skills from bookendRequirements.isIntegration
  │
  ├─→ Phase: QA
  │     Run sprint-testing workflow (validation suite)
  │     Uses persona/skills from bookendRequirements.isQA
  │
  ├─→ Phase: Code Review (optional)
  │     Run sprint-code-review workflow (architectural audit)
  │     Uses persona/skills from bookendRequirements.isCodeReview
  │
  ├─→ Phase: Retrospective
  │     Run sprint-retro workflow (data from ticket graph)
  │     Uses persona/skills from bookendRequirements.isRetro
  │
  └─→ Phase: Close-Out
        Run sprint-close-out workflow (close Epic, tag release)
        Uses persona/skills from bookendRequirements.isCloseSprint
```

The `bookendRequirements` config block in `.agentrc.json` provides the persona,
skills, and model for each lifecycle phase — the same data that v4 stored per
bookend task in the manifest.

### Branch Creation Strategy

In v4, `sprint-setup.md` created the sprint branch before planning and each
task's feature branch was created during execution. In v5, **the Dispatcher
creates all branches at dispatch time:**

1. **Epic base branch:** Created by `/sprint-execute` on first invocation if it
   doesn't already exist: `epic/[Epic_ID]` (branched from `main`).
2. **Task feature branches:** Created by the Dispatcher when dispatching each
   wave: `task/epic-[Epic_ID]/[Task_Number]` (branched from the Epic base).
3. **Lint baseline capture:** The Dispatcher captures the lint baseline on the
   Epic base branch before dispatching the first wave.

The `sprint-setup.md` workflow is **deprecated** in v5 — its responsibilities
are absorbed by the Dispatcher.

### Sprint 3A: Execution Adapter Interface & Dispatcher

**Scope:** Define the execution adapter abstraction, build the HITL reference
implementation, and build the dispatcher that fetches Tasks, builds the
dependency DAG, creates branches, and determines execution order.

| Task                                                                          | Type   | File(s)                                    | Depends On               |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------ | ------------------------ |
| Define `IExecutionAdapter` interface with all method signatures               | NEW    | `.agents/scripts/lib/IExecutionAdapter.js` | —                        |
| Build adapter factory — resolves `orchestration.executor` to class            | NEW    | `.agents/scripts/lib/adapter-factory.js`   | Interface                |
| Build `ManualDispatchAdapter` — HITL reference implementation                 | NEW    | `.agents/scripts/adapters/manual.js`       | Interface                |
| Build `dispatcher.js` — fetch Tasks, build DAG, topological sort              | NEW    | `.agents/scripts/dispatcher.js`            | Provider, `lib/Graph.js` |
| Extend `lib/Graph.js` with topological sort + wave grouping                   | MODIFY | `.agents/scripts/lib/Graph.js`             | —                        |
| DAG scheduling logic — concurrent vs. sequential wave dispatch                | MODIFY | `.agents/scripts/dispatcher.js`            | Graph                    |
| Focus area conflict detection — auto-serialize overlapping `focus::` labels   | MODIFY | (same file)                                | Graph                    |
| HITL gate — hold `risk::high` Tasks; fire webhook for approval                | MODIFY | (same file)                                | Notify                   |
| Branch creation — Epic base branch + task feature branches at dispatch time   | MODIFY | (same file)                                | Provider                 |
| Lint baseline capture on Epic base branch before first wave                   | MODIFY | (same file)                                | `lint-baseline.js`       |
| Dispatch Manifest schema                                                      | NEW    | `.agents/schemas/dispatch-manifest.json`   | —                        |
| Unit tests for interface + adapter + dispatcher                               | NEW    | `tests/execution-adapter.test.js`, `tests/dispatcher.test.js` | All above |

### Sprint 3B: Context Hydration Engine [COMPLETED]

**Scope:** Build the hydrator that assembles a "virtual context" from the GitHub
work breakdown hierarchy before execution. The hydrator produces a fully
self-contained prompt string that includes the agent execution protocol,
persona directives, skill instructions, hierarchy context, and task
instructions.

| Task                                                                                        | Status | File(s)                                      | Depends On           |
| ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- | -------------------- |
| Create `agent-protocol.md` template with placeholder substitution points                    | DONE   | `.agents/templates/agent-protocol.md`        | —                    |
| Build `context-hydrator.js` — implements the 7-step hydration sequence (see above)           | DONE   | `.agents/scripts/context-hydrator.js`        | Phase 1, Template    |
| Protocol template rendering — substitute `{{BRANCH_NAME}}`, `{{TASK_ID}}`, version stamps   | DONE   | (same file)                                  | Template             |
| Persona injection — read `.agents/personas/{{PERSONA}}.md` into prompt text                  | DONE   | (same file)                                  | Config               |
| Skill injection — read each `.agents/skills/{{SKILL}}/SKILL.md` into prompt text             | DONE   | (same file)                                  | Config               |
| Protocol version mismatch detection — warn if generation ≠ execution version                 | DONE   | (same file)                                  | Version stamp        |
| Token budget integration — respect `maxTokenBudget` and truncate low-priority context        | DONE   | (same file)                                  | `config-resolver.js` |
| Unit tests for hydrator (mocked provider)                                                    | DONE   | `tests/context-hydrator.test.js`             | Hydrator             |

### Sprint 3C: State Sync & Ticket Mutations [COMPLETED]

**Scope:** Build the state writer that syncs agent progress to GitHub in
real-time, including bottom-up parent completion cascading.

| Task                                                                                     | Status | File(s)                                  | Depends On |
| ---------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Build `update-ticket-state.js` — wraps `updateTicket()` and `postComment()`              | DONE   | `.agents/scripts/update-ticket-state.js` | Phase 1    |
| Label transitions: `agent::ready` → `agent::executing` → `agent::review` → `agent::done` | DONE   | (same file)                              | Provider   |
| Tasklist checkbox mutations: `- [ ]` → `- [x]` in ticket body                            | DONE   | (same file)                              | Provider   |
| Structured progress comments via `postComment()`                                         | DONE   | (same file)                              | Provider   |
| Friction log posting — post `agent-friction-log.json` payloads as ticket comments        | DONE   | (same file)                              | Provider   |
| Parent auto-completion cascade (see below)                                               | DONE   | (same file)                              | Provider   |
| Unit tests for state writer (including cascade tests)                                    | DONE   | `tests/update-ticket-state.test.js`      | Writer     |

**Parent Auto-Completion Cascade:**

When a Task reaches `agent::done`, the state writer automatically checks whether
all sibling tickets under the same parent are also done, and cascades completion
up the hierarchy:

```text
Task reaches agent::done
  │
  ├─→ Check: all sibling Tasks under the same Story also agent::done?
  │     → Yes: transition Story to agent::done, post summary comment
  │
  ├─→ Check: all Stories under the same Feature also agent::done?
  │     → Yes: transition Feature to agent::done, post summary comment
  │
  └─→ Check: all Features under the same Epic also agent::done?
        → Yes: transition Epic to agent::done
        → Post summary comment on Epic
        → Fire webhook (INFO: epic-complete)
```

This recursive cascade uses `provider.getSubTickets(parentId)` (already in
`ITicketingProvider`) and label-based status checks on each sibling. Each
parent transition includes a summary comment listing the completed children.

### Sprint 3D: `/sprint-execute` Workflow [COMPLETED]

**Scope:** Wire everything into the `/sprint-execute [Epic ID]` orchestrator,
operating in two modes: Epic-level (outputs Dispatch Manifest) and Task-level
(executes a single Task). After all Task waves complete, the workflow
automatically transitions into bookend lifecycle phases (Integration → QA →
Code Review → Retro → Close-Out) without requiring separate tickets.

| Task                                                                              | Status | File(s)                                     | Depends On   |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------ |
| Build `/sprint-execute` workflow — Epic-level Dispatch Manifest mode              | DONE   | `.agents/workflows/sprint-execute.md`       | Sprints 3A-C |
| Build `/sprint-execute` workflow — Task-level single-task execution mode          | DONE   | (same file)                                 | Sprints 3A-C |
| Bookend lifecycle phase orchestration — auto-run post all Tasks `agent::done`     | DONE   | (same file)                                 | Sprints 3A-C |
| Epic completion detection — all tickets `agent::done` → notify operator           | DONE   | `.agents/scripts/dispatcher.js`             | Notify       |
| Integration with existing `/sprint-finalize-task` — call `update-ticket-state.js` | DONE   | `.agents/workflows/sprint-finalize-task.md` | State writer |

**`/sprint-execute [Epic ID]` Workflow (Epic-Level — Dispatch Manifest):**

```text
/sprint-execute [Epic ID]

Step 0 — Resolve Configuration
  Read orchestration config from .agentrc.json.
  Instantiate provider via provider factory.
  Instantiate adapter via adapter factory (orchestration.executor).

Step 1 — Fetch & Schedule
  Call provider.getTickets(epicId, { label: 'type::task' }).
  Filter to Tasks with agent::ready label.
  For each Task, call provider.getTicketDependencies(ticketId).
  Build the dependency DAG via dispatcher.js.
  Perform topological sort.
  Identify the current dispatch wave (no unresolved deps).
  Apply maxConcurrentTasks limit — split large waves into sub-waves.
  Auto-serialize tasks sharing a focus:: label (hard-block mode).

Step 2 — HITL Gate
  For each dispatchable Task with risk::high label:
    Fire webhook with approval-required payload (ACTION).
    Hold Task until human approves (via label change or comment).

Step 3 — Model Resolution
  For each dispatchable Task, resolve the model via the 3-tier cascade:
    1. Task body metadata (**Model:** field) — highest priority
    2. bookendRequirements match (isQA, isCodeReview, etc.)
    3. defaultModels.planningFallback / fastFallback — floor

Step 4 — Dispatch Wave
  For each Task in the wave:
    a. Hydrate context via context-hydrator.js.
    b. Call adapter.dispatchTask({ taskId, title, branch, model,
       mode, persona, skills, prompt, metadata }).
  Call adapter.onWaveDispatched(dispatchedTasks).
  For ManualDispatchAdapter: prints the Dispatch Manifest table,
    writes wave-N.json, fires webhook (ACTION: wave-ready).

Step 5 — Wave Completion & Re-evaluation
  When the operator re-runs /sprint-execute [Epic ID]:
    Poll adapter.getTaskStatus() for all dispatched tasks.
    Re-evaluate the dependency DAG.
    Compute the next wave (return to Step 1).
    If all Tasks under the Epic reach agent::done:
      Transition to Step 6 (Bookend Lifecycle).

Step 6 — Bookend Lifecycle Phases
  Execute bookend phases sequentially (not as tickets):
    a. Integration — run sprint-integration workflow
       (persona/skills/model from bookendRequirements.isIntegration)
    b. QA — run sprint-testing workflow
       (persona/skills/model from bookendRequirements.isQA)
    c. Code Review (optional) — run sprint-code-review workflow
       (persona/skills/model from bookendRequirements.isCodeReview)
    d. Retrospective — run sprint-retro workflow
       (persona/skills/model from bookendRequirements.isRetro)
    e. Close-Out — run sprint-close-out workflow
       (persona/skills/model from bookendRequirements.isCloseSprint)
  On final completion:
    Post summary comment on the Epic issue.
    Fire webhook (INFO: epic-complete).
```

**`/sprint-execute #[Task ID]` Workflow (Task-Level — Single Execution):**

```text
/sprint-execute #[Task ID]

Step 0 — Context Gathering
  Fetch the ticket. Verify all blocked-by issues are resolved.
  Trace the hierarchy: Task → Story → Feature → Epic → PRD + Tech Spec.

Step 1 — Branch & Implement
  Create feature branch: task/epic-[ID]/[task-number].
  Update Task label: agent::ready → agent::executing.
  Execute the agent prompt from the Task body.
  As subtasks complete, check off tasklist items via update-ticket-state.js.

Step 2 — Validate
  Run shift-left validation (configured testCommand + lintCommand).

Step 3 — Finalize
  On success: create PR via provider.createPullRequest(),
    transition to agent::review.
    Fire @mention (INFO: task-complete).
  On failure: post friction log, apply status::blocked,
    fire webhook (ACTION: blocked).
```

### Sprint 3E: Workflow Replacement [COMPLETED]

**Scope:** Replace existing v4 workflows with ticketing-native equivalents.
Since v5 is a clean break, these are full rewrites rather than incremental
updates. The core `sprint-integrate.js` candidate verification logic is
retained (ephemeral branch merge, validation, rollback) — only the playbook
state sync (checkbox/Mermaid updates) is replaced with ticket label transitions
via `update-ticket-state.js`.

| Task                                                                                     | Status | File(s)                                     | Depends On   |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------ |
| Rewrite `/sprint-finalize-task` to call `update-ticket-state.js`                         | DONE   | `.agents/workflows/sprint-finalize-task.md` | State writer |
| Rewrite `/sprint-integration` — retain candidate verification, swap state sync to labels | DONE   | `.agents/workflows/sprint-integration.md`   | Provider     |
| Refactor `sprint-integrate.js` — replace playbook sync with `update-ticket-state.js`     | DONE   | `.agents/scripts/sprint-integrate.js`       | State writer |
| Rewrite `/sprint-hotfix` to apply `status::blocked` and fire webhook                     | DONE   | `.agents/workflows/sprint-hotfix.md`        | Provider     |
| Rewrite `/sprint-retro` to read data from the ticket graph                               | DONE   | `.agents/workflows/sprint-retro.md`         | Provider     |
| Rewrite `/sprint-close-out` to close the Epic issue via provider                         | DONE   | `.agents/workflows/sprint-close-out.md`     | Provider     |
| Rewrite `verify-prereqs.js` to check ticket state exclusively                            | DONE   | `.agents/scripts/verify-prereqs.js`         | Provider     |
| Rewrite `diagnose-friction.js` to post friction logs as ticket comments                  | DONE   | `.agents/scripts/diagnose-friction.js`      | Provider     |

### Sprint 3F: Cleanup, Documentation & Automated Roadmap

**Scope:** Remove deprecated scripts and workflows, deprecate `docs/sprints/`,
update all documentation, build the automated roadmap generation pipeline, and
ship the final release. This includes removing the v4 event stream protocol,
golden path harvesting system, speculative cache, playbook generation pipeline,
and local sprint setup workflow.

| Task                                                                    | Type   | File(s)                                         | Depends On |
| ----------------------------------------------------------------------- | ------ | ----------------------------------------------- | ---------- |
| Remove `generate-playbook.js` + `PlaybookOrchestrator.js` + `Renderer.js` | DELETE | `.agents/scripts/generate-playbook.js`, `lib/PlaybookOrchestrator.js`, `lib/Renderer.js` | Sprint 3E |
| Remove `update-task-state.js`                                           | DELETE | `.agents/scripts/update-task-state.js`          | Sprint 3E  |
| Remove `playbook-to-tickets.js`                                         | DELETE | `.agents/scripts/playbook-to-tickets.js`        | Sprint 3E  |
| Remove `run-agent-loop.js` + `AgentLoopRunner.js` (event stream)        | DELETE | `.agents/scripts/run-agent-loop.js`, `lib/AgentLoopRunner.js` | Sprint 3E |
| Remove `atomic-action-schema.json` (event stream schema)                | DELETE | `.agents/schemas/atomic-action-schema.json`     | Sprint 3E  |
| Remove `task-manifest.schema.json` (replaced by dispatch-manifest)      | DELETE | `.agents/schemas/task-manifest.schema.json`     | Sprint 3E  |
| Remove `harvest-golden-path.js` + `CacheManager.js` (golden path)       | DELETE | `.agents/scripts/harvest-golden-path.js`, `lib/CacheManager.js` | Sprint 3E |
| Remove `ComplexityEstimator.js` (replaced by LLM prompt constraints)    | DELETE | `.agents/scripts/lib/ComplexityEstimator.js`    | Sprint 3E  |
| Remove `/sprint-generate-playbook` workflow                             | DELETE | `.agents/workflows/sprint-generate-playbook.md` | Sprint 3E  |
| Remove `/sprint-setup` workflow (absorbed by Dispatcher)                | DELETE | `.agents/workflows/sprint-setup.md`             | Sprint 3E  |
| Remove `/sprint-gather-context` workflow (replaced by Context Hydrator) | DELETE | `.agents/workflows/sprint-gather-context.md`    | Sprint 3B  |
| Remove `sprint-playbook-template.md` (v4 template)                      | DELETE | `.agents/templates/sprint-playbook-template.md` | Sprint 3E  |
| Deprecate `docs/sprints/` directory (add DEPRECATED.md notice)          | NEW    | `docs/sprints/DEPRECATED.md`                    | All        |
| Build `generate-roadmap.js` — GitHub Issue → markdown roadmap generator | NEW    | `.agents/scripts/generate-roadmap.js`           | Phase 1    |
| Create `update-roadmap.yml` workflow template for consumer CI           | NEW    | `.agents/templates/update-roadmap.yml`          | Generator  |
| Add `--install-workflows` flag to `bootstrap-agent-protocols.js`        | MODIFY | `.agents/scripts/bootstrap-agent-protocols.js`  | Template   |
| Add `roadmap-exclude` to `LABEL_TAXONOMY` in bootstrap script           | MODIFY | `.agents/scripts/bootstrap-agent-protocols.js`  | —          |
| Add `agentSettings.roadmap` config block to `default-agentrc.json`      | MODIFY | `.agents/default-agentrc.json`                  | Generator  |
| Add agent immutability rule for generated `roadmap.md`                  | MODIFY | `.agents/instructions.md`                       | —          |
| Document Automated Roadmap in `.agents/README.md` (setup + usage)       | MODIFY | `.agents/README.md`                             | All        |
| Unit tests for `generate-roadmap.js` (mock provider)                    | NEW    | `tests/generate-roadmap.test.js`                | Generator  |
| Rewrite `SDLC.md` — full v5 architecture                                | MODIFY | `.agents/SDLC.md`                               | All        |
| Rewrite `README.md` — document v5 architecture and provider config      | MODIFY | `README.md`, `.agents/README.md`                | All        |
| Rewrite `instructions.md` — ticketing-native execution rules            | MODIFY | `.agents/instructions.md`                       | All        |
| Update `default-agentrc.json` — document `orchestration` block          | MODIFY | `.agents/default-agentrc.json`                  | All        |
| Bump `VERSION` to `5.0.0`                                               | MODIFY | `.agents/VERSION`                               | All        |
| Update `CHANGELOG.md` with v5.0.0 release notes                         | MODIFY | `CHANGELOG.md`                                  | All        |
| Final `npm test` / `npm run lint` validation                             | CHECK  | —                                               | All        |

#### Automated Roadmap Architecture

GitHub Issues are the Single Source of Truth (SSOT) for project work. The
`roadmap.md` file in consumer projects is a **read-only, auto-generated
artifact** that reflects the real-time state of Epics and Features. Neither
humans nor AI agents should manually edit it.

> **Note — Agent-Protocols Repo:** The `docs/roadmap.md` in this repository
> remains manually authored until all v5 features are shipped. This feature is
> for consuming projects adopting the v5 architecture.

**Issue Hierarchy in Roadmap:**

Work is organized in a parent-child relationship. Only Epics and Features are
included in the generated roadmap (Stories and Tasks are execution-level detail
that would add noise).

```text
Epic (type::epic)
├── Feature (type::feature)  → rendered as checklist item
├── Feature (type::feature)
└── Feature (type::feature)
```

**Filtering Strategy — Black-Label Exclusion:**

The generation script uses a `roadmap-exclude` label to separate public-facing
features from internal engineering work:

- **Default:** All Epics and Features are included.
- If an **Epic** has `roadmap-exclude`, it and all child Features are omitted.
- If a **Feature** has `roadmap-exclude`, only that Feature is omitted.
- Closed Epics are included with a `✅` prefix (unless excluded by label).

**`generate-roadmap.js` Script:**

Lives in `.agents/scripts/` — ships with the submodule.

```text
Inputs:
  - Orchestration config from .agentrc.json (owner, repo)
  - ITicketingProvider (reuses existing v5 infrastructure)
  - Output path (configurable: default docs/roadmap.md)

Algorithm:
  1. Fetch all issues with label type::epic
  2. Filter out Epics bearing roadmap-exclude label
  3. For each surviving Epic, fetch child issues with type::feature
  4. Filter out Features bearing roadmap-exclude
  5. Generate markdown:
     - Header: <!-- AUTO-GENERATED — DO NOT EDIT --> banner
     - Timestamp + link to GitHub Issues
     - Per-Epic section: title, first-paragraph excerpt (≤300 chars),
       link to GitHub issue, status (open/closed prefix)
     - Per-Feature checklist: - [ ] or - [x], title, link to issue
  6. Ordering: open Epics first, then closed; by issue number within groups
  7. Write to output path

CLI:
  node .agents/scripts/generate-roadmap.js           # Generate and write
  node .agents/scripts/generate-roadmap.js --check    # Diff only (CI mode)
  node .agents/scripts/generate-roadmap.js --stdout   # Print without writing
```

**Configuration (`.agentrc.json`):**

```json
{
  "agentSettings": {
    "roadmap": {
      "enabled": true,
      "outputPath": "docs/roadmap.md",
      "includeClosedEpics": true,
      "excludeLabel": "roadmap-exclude",
      "maxDescriptionLength": 300
    }
  }
}
```

**Efficiency — Avoiding Costly Full Re-renders:**

The GitHub Actions workflow (see below) triggers on every `issues` event. To
avoid expensive full regenerations when nothing has changed:

1. **Conditional event filtering:** The workflow template uses GitHub Action's
   `if:` conditional to skip runs when the changed issue does not have a
   `type::epic` or `type::feature` label. This eliminates the majority of
   noise from Task/Story events.
2. **Content hash comparison:** `generate-roadmap.js` reads the existing
   `roadmap.md`, generates the new content in memory, and compares a SHA-256
   hash. If the hashes match → exit 0, skip the commit step. This makes the
   GH Action idempotent and effectively free when the roadmap content hasn't
   actually changed.
3. **Git no-op detection:** The workflow's commit step uses
   `git diff --cached --quiet` to skip the commit+push when the file is
   unchanged, as a secondary guard.

**CI Distribution — Hybrid Approach:**

The `.github/workflows/` directory cannot be distributed via the `.agents/`
submodule. The solution uses a dual-path approach:

- **Primary (Manual):** The workflow template ships in
  `.agents/templates/update-roadmap.yml`. The README documents the copy step:
  `cp .agents/templates/update-roadmap.yml .github/workflows/`.
- **Convenience (Bootstrap):** `bootstrap-agent-protocols.js` gains an
  `--install-workflows` flag that copies all templates from
  `.agents/templates/*.yml` to `.github/workflows/`, creating the directory if
  needed. Idempotent — skips files that already exist.

**Workflow Template (`.agents/templates/update-roadmap.yml`):**

```yaml
name: Update Roadmap
on:
  issues:
    types: [opened, edited, closed, reopened, labeled, unlabeled, deleted]
  workflow_dispatch:  # Manual trigger

concurrency:
  group: update-roadmap
  cancel-in-progress: true

jobs:
  generate:
    runs-on: ubuntu-latest
    # Skip if the issue doesn't have a roadmap-relevant label
    if: >
      github.event_name == 'workflow_dispatch' ||
      contains(toJSON(github.event.issue.labels.*.name), 'type::epic') ||
      contains(toJSON(github.event.issue.labels.*.name), 'type::feature')
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: node .agents/scripts/generate-roadmap.js
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit roadmap
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add docs/roadmap.md
          git diff --cached --quiet || git commit -m "docs: auto-update roadmap [skip ci]"
          git push
```

**Agent Immutability Rule:**

Added to `instructions.md` under System Guardrails:

> If a `docs/roadmap.md` (or configured `agentSettings.roadmap.outputPath`)
> file exists and contains the header `<!-- AUTO-GENERATED — DO NOT EDIT -->`,
> you MUST NOT edit, write to, or commit changes to that file. To update the
> roadmap, update the corresponding GitHub Issue status or labels. The
> automation pipeline will regenerate the file automatically.

### Sprint 3G: Dogfood — End-to-End Epic Lifecycle

**Scope:** Run a complete Epic lifecycle entirely through GitHub tickets.

| Task                                                                         | Type   | File(s)             | Depends On |
| ---------------------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Create an Epic issue for a real v5 deliverable                               | MANUAL | GitHub UI           | —          |
| Run `/sprint-plan [Epic ID]` — tickets created on GitHub                     | MANUAL | Antigravity session | Sprint 2C  |
| Run `/sprint-execute [Epic ID]` — Dispatch Manifest generated                | MANUAL | Antigravity session | Sprint 3D  |
| Open parallel IDE sessions per Dispatch Manifest                             | MANUAL | Multiple IDE chats  | Manifest   |
| Verify state sync — ticket labels transition correctly in GitHub             | MANUAL | GitHub UI           | —          |
| Verify notifications — @mention for INFO, webhook for ACTION events          | MANUAL | GitHub UI / webhook | —          |
| Run `/sprint-integration` — PRs created and linked to Tasks                  | MANUAL | Antigravity session | Sprint 3E  |
| Run `/sprint-retro` — reads sprint data from ticket graph                    | MANUAL | Antigravity session | Sprint 3E  |
| Run `/sprint-close-out` — closes the Epic                                    | MANUAL | Antigravity session | Sprint 3E  |
| Verify zero local playbook or `docs/sprints/` artifacts generated            | CHECK  | CLI check           | —          |

### Phase 3 Exit Criteria

- [ ] `IExecutionAdapter` interface defined with all method signatures.
- [ ] `ManualDispatchAdapter` ships as the HITL reference implementation.
- [ ] Adapter factory resolves `orchestration.executor` to the correct class.
- [ ] `agent-protocol.md` template created with placeholder substitution.
- [ ] Protocol version stamped at both generation and execution time.
- [ ] Context Hydrator assembles full prompt: protocol + persona text + skill
      text + hierarchy context + task instructions.
- [ ] `/sprint-execute [Epic ID]` generates a Dispatch Manifest via the adapter.
- [ ] `/sprint-execute #[Task ID]` autonomously executes a single Task.
- [ ] Dispatcher creates Epic base branch + task feature branches at dispatch.
- [ ] Dispatcher correctly resolves sequential/concurrent ordering from the Task
      DAG, including focus-area conflict auto-serialization.
- [ ] Model selection cascade resolves correctly (ticket → bookend → default).
- [ ] State sync updates Task labels and tasklists in real-time.
- [ ] Parent auto-completion cascade works: Task → Story → Feature → Epic.
- [ ] Bookend lifecycle phases execute automatically after all Tasks complete.
- [ ] INFO notifications fire via @mention (task-complete, feature-complete,
      epic-complete).
- [ ] ACTION notifications fire via webhook (review-needed, approval-required,
      blocked, wave-ready).
- [ ] `sprint-integrate.js` candidate verification retained with ticket-native
      state sync.
- [ ] All deprecated scripts removed: `generate-playbook.js`,
      `PlaybookOrchestrator.js`, `Renderer.js`, `run-agent-loop.js`,
      `AgentLoopRunner.js`, `harvest-golden-path.js`, `CacheManager.js`,
      `ComplexityEstimator.js`, `update-task-state.js`, `playbook-to-tickets.js`.
- [ ] All deprecated schemas removed: `task-manifest.schema.json`,
      `atomic-action-schema.json`.
- [ ] All deprecated workflows removed: `sprint-generate-playbook.md`,
      `sprint-setup.md`, `sprint-gather-context.md`.
- [ ] `docs/sprints/` is deprecated with a notice.
- [ ] `generate-roadmap.js` produces correct markdown from GitHub Issues.
- [ ] `roadmap-exclude` label in the bootstrap taxonomy.
- [ ] `update-roadmap.yml` workflow template ships in `.agents/templates/`.
- [ ] `bootstrap-agent-protocols.js` supports `--install-workflows` flag.
- [ ] Agent immutability rule for `<!-- AUTO-GENERATED -->` files documented.
- [ ] Roadmap generation uses hash-based skip to avoid unnecessary commits.
- [ ] All documentation reflects the v5 architecture.
- [ ] End-to-end Epic lifecycle completes with zero local artifacts.
- [ ] `VERSION` reads `5.0.0`.
- [ ] Tagged and released as `v5.0.0`.

---

## File Impact Summary

### New Files

| File                                             | Phase | Purpose                          |
| ------------------------------------------------ | ----- | -------------------------------- |
| `.agents/scripts/lib/ITicketingProvider.js`      | 1     | Abstract interface               |
| `.agents/scripts/lib/provider-factory.js`        | 1     | Provider resolution              |
| `.agents/scripts/providers/github.js`            | 1     | Reference provider               |
| `.agents/scripts/bootstrap-agent-protocols.js`   | 1     | Automated label/field setup      |
| `.agents/scripts/epic-planner.js`                | 2     | PRD + Tech Spec generation       |
| `.agents/scripts/ticket-decomposer.js`           | 2     | Work breakdown decomposition     |
| `.agents/scripts/notify.js`                      | 2     | Dual-channel notification engine |
| `.agents/scripts/lib/IExecutionAdapter.js`       | 3     | Execution adapter interface      |
| `.agents/scripts/lib/adapter-factory.js`         | 3     | Adapter resolution               |
| `.agents/scripts/adapters/manual.js`             | 3     | HITL reference adapter           |
| `.agents/scripts/context-hydrator.js`            | 3     | Virtual context assembly         |
| `.agents/scripts/dispatcher.js`                  | 3     | DAG scheduler + branch creation  |
| `.agents/scripts/update-ticket-state.js`         | 3     | Ticketing state writer + cascade |
| `.agents/scripts/generate-roadmap.js`            | 3     | GitHub Issue → roadmap generator |
| `.agents/schemas/dispatch-manifest.json`         | 3     | Dispatch manifest schema         |
| `.agents/templates/agent-protocol.md`            | 3     | Universal execution protocol     |
| `.agents/templates/update-roadmap.yml`           | 3     | GH Actions workflow template     |
| `.agents/templates/feature-body.md`              | 2     | Feature issue template           |
| `.agents/templates/story-body.md`                | 2     | Story issue template             |
| `.agents/templates/task-body.md`                 | 2     | Task issue template              |
| `.agents/workflows/bootstrap-agent-protocols.md` | 1     | Bootstrap workflow               |
| `.agents/workflows/sprint-plan.md`               | 2     | Epic planning workflow           |
| `.agents/workflows/sprint-execute.md`            | 3     | Epic execution workflow          |
| `tests/ticketing-provider.test.js`               | 1     | Interface contract tests         |
| `tests/providers-github.test.js`                 | 1     | Provider unit tests              |
| `tests/bootstrap.test.js`                        | 1     | Bootstrap unit tests             |
| `tests/bootstrap.integration.js`                 | 1     | Bootstrap integration test       |
| `tests/epic-planner.test.js`                     | 2     | Planner unit tests               |
| `tests/ticket-decomposer.test.js`                | 2     | Decomposer unit tests            |
| `tests/notify.test.js`                           | 2     | Notification unit tests          |
| `tests/execution-adapter.test.js`                | 3     | Adapter interface tests          |
| `tests/context-hydrator.test.js`                 | 3     | Hydrator unit tests              |
| `tests/dispatcher.test.js`                       | 3     | Dispatcher unit tests            |
| `tests/update-ticket-state.test.js`              | 3     | State writer unit tests          |
| `tests/generate-roadmap.test.js`                 | 3     | Roadmap generator unit tests     |

### Modified Files

| File                                        | Phase | Change                          |
| ------------------------------------------- | ----- | ------------------------------- |
| `.agents/default-agentrc.json`              | 1, 3  | Add `orchestration` + `executor`|
| `.agents/scripts/lib/config-resolver.js`    | 1     | Parse `orchestration` block     |
| `tests/structure.test.js`                   | 1     | Validate new locations          |
| `.agents/scripts/lib/Graph.js`              | 3     | Add topological sort + waves    |
| `.agents/scripts/sprint-integrate.js`       | 3     | Swap playbook sync for labels   |
| `.agents/scripts/verify-prereqs.js`         | 3     | Ticket-native state checks      |
| `.agents/scripts/diagnose-friction.js`      | 3     | Post to tickets                 |
| `.agents/workflows/sprint-finalize-task.md` | 3     | Use ticket state                |
| `.agents/workflows/sprint-integration.md`   | 3     | Check ticket labels, create PRs |
| `.agents/workflows/sprint-hotfix.md`        | 3     | Apply blocked + webhook         |
| `.agents/workflows/sprint-retro.md`         | 3     | Read from ticket graph          |
| `.agents/workflows/sprint-close-out.md`     | 3     | Close Epic                      |
| `.agents/SDLC.md`                           | 3     | Full rewrite for v5             |
| `README.md`                                 | 3     | Document v5 architecture        |
| `.agents/README.md`                         | 3     | Document v5 architecture        |
| `.agents/instructions.md`                   | 3     | Ticketing execution rules       |
| `.agents/VERSION`                           | 3     | Bump to `5.0.0`                 |
| `CHANGELOG.md`                              | 3     | v5.0.0 release notes            |

### Deleted Files (Phase 3)

| File                                              | Reason                                    |
| ------------------------------------------------- | ----------------------------------------- |
| `.agents/scripts/generate-playbook.js`            | Replaced by ticket-native pipeline        |
| `.agents/scripts/lib/PlaybookOrchestrator.js`     | Part of playbook pipeline                 |
| `.agents/scripts/lib/Renderer.js`                 | Part of playbook pipeline                 |
| `.agents/scripts/update-task-state.js`            | Replaced by `update-ticket-state.js`      |
| `.agents/scripts/playbook-to-tickets.js`          | No longer needed                          |
| `.agents/scripts/run-agent-loop.js`               | Event stream deprecated                   |
| `.agents/scripts/lib/AgentLoopRunner.js`          | Event stream deprecated                   |
| `.agents/scripts/harvest-golden-path.js`          | Deferred to post-v5 roadmap               |
| `.agents/scripts/lib/CacheManager.js`             | Deferred to post-v5 roadmap               |
| `.agents/scripts/lib/ComplexityEstimator.js`      | Replaced by LLM prompt constraints        |
| `.agents/schemas/task-manifest.schema.json`       | Replaced by `dispatch-manifest.json`      |
| `.agents/schemas/atomic-action-schema.json`       | Event stream deprecated                   |
| `.agents/workflows/sprint-generate-playbook.md`   | Replaced by ticket-native pipeline        |
| `.agents/workflows/sprint-setup.md`               | Absorbed by Dispatcher branch creation    |
| `.agents/workflows/sprint-gather-context.md`      | Replaced by Context Hydrator              |
| `.agents/templates/sprint-playbook-template.md`   | Part of playbook pipeline                 |
