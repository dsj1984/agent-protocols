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
- [ ] `notify.js` dispatches INFO via @mention and ACTION via webhook.
- [x] Dogfood: a real Epic on this repo is fully planned via the command.
- [ ] Tagged as `v5.0.0-beta.1`.

---

## Phase 3 — Execution Engine

> **Goal:** Build the `/sprint-execute [Epic ID]` workflow. The agent
> autonomously executes all Tasks under an Epic, syncing state to GitHub in
> real-time and sending webhook notifications when HITL action is needed.
>
> **Tag:** `v5.0.0-rc.1` → `v5.0.0`

### Sprint 3A: Dispatcher & DAG Scheduling

**Scope:** Build the dispatcher that fetches Tasks, builds the dependency DAG,
and determines execution order.

| Task                                                                          | Type   | File(s)                         | Depends On               |
| ----------------------------------------------------------------------------- | ------ | ------------------------------- | ------------------------ |
| Build `dispatcher.js` — fetch Tasks, build DAG, topological sort              | NEW    | `.agents/scripts/dispatcher.js` | Provider, `lib/Graph.js` |
| Extend `lib/Graph.js` with topological sort if not present                    | MODIFY | `.agents/scripts/lib/Graph.js`  | —                        |
| DAG scheduling logic — concurrent vs. sequential dispatch                     | MODIFY | `.agents/scripts/dispatcher.js` | Graph                    |
| Focus area conflict detection — prevent concurrent dispatch of same `focus::` | MODIFY | (same file)                     | Graph                    |
| HITL gate — hold `risk::high` Tasks; fire webhook for approval                | MODIFY | (same file)                     | Notify                   |
| Unit tests for dispatcher DAG scheduling                                      | NEW    | `tests/dispatcher.test.js`      | Dispatcher               |

### Sprint 3B: Context Hydration Engine

**Scope:** Build the hydrator that assembles a "virtual context" from the GitHub
work breakdown hierarchy before execution.

| Task                                                                                   | Type   | File(s)                               | Depends On           |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------- | -------------------- |
| Build `context-hydrator.js` — implements the 5-step hydration sequence from roadmap §C | NEW    | `.agents/scripts/context-hydrator.js` | Phase 1              |
| Token budget integration — respect `maxTokenBudget` and truncate low-priority context  | MODIFY | (same file)                           | `config-resolver.js` |
| Unit tests for hydrator (mocked provider)                                              | NEW    | `tests/context-hydrator.test.js`      | Hydrator             |

### Sprint 3C: State Sync & Ticket Mutations

**Scope:** Build the state writer that syncs agent progress to GitHub in
real-time.

| Task                                                                                     | Type   | File(s)                                  | Depends On |
| ---------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Build `update-ticket-state.js` — wraps `updateTicket()` and `postComment()`              | NEW    | `.agents/scripts/update-ticket-state.js` | Phase 1    |
| Label transitions: `agent::ready` → `agent::executing` → `agent::review` → `agent::done` | MODIFY | (same file)                              | Provider   |
| Tasklist checkbox mutations: `- [ ]` → `- [x]` in ticket body                            | MODIFY | (same file)                              | Provider   |
| Structured progress comments via `postComment()`                                         | MODIFY | (same file)                              | Provider   |
| Friction log posting — post `agent-friction-log.json` payloads as ticket comments        | MODIFY | (same file)                              | Provider   |
| Unit tests for state writer                                                              | NEW    | `tests/update-ticket-state.test.js`      | Writer     |

### Sprint 3D: `/sprint-execute` Workflow

**Scope:** Wire everything into the `/sprint-execute [Epic ID]` orchestrator.

| Task                                                                              | Type   | File(s)                                     | Depends On   |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------ |
| Build `/sprint-execute` workflow — the main execution entry point                 | NEW    | `.agents/workflows/sprint-execute.md`       | Sprints 3A-C |
| Epic completion detection — all tickets `agent::done` → notify operator           | NEW    | `.agents/scripts/dispatcher.js`             | Notify       |
| Integration with existing `/sprint-finalize-task` — call `update-ticket-state.js` | MODIFY | `.agents/workflows/sprint-finalize-task.md` | State writer |

**`/sprint-execute [Epic ID]` Workflow:**

```text
/sprint-execute [Epic ID]

Step 0 — Resolve Configuration
  Read orchestration config from .agentrc.json.
  Instantiate provider via provider factory.

Step 1 — Fetch & Schedule
  Call provider.getTickets(epicId, { label: 'type::task' }).
  Filter to Tasks with agent::ready label.
  For each Task, call provider.getTicketDependencies(ticketId).
  Build the dependency DAG via dispatcher.js.
  Perform topological sort.
  Identify immediately dispatchable Tasks (no unresolved deps).

Step 2 — HITL Gate
  For each dispatchable Task with risk::high label:
    Fire webhook with approval-required payload (ACTION).
    Hold Task until human approves (via label change or comment).

Step 3 — Execute Dispatchable Tasks
  For each Task ready for execution:
    a. Hydrate context via context-hydrator.js (traverse
       Task → Story → Feature → Epic → PRD + Tech Spec).
    b. Create feature branch: task/epic-[ID]/[task-number].
    c. Update Task label: agent::ready → agent::executing.
    d. Execute the agent prompt from the Task body.
    e. As subtasks complete, check off tasklist items via
       update-ticket-state.js.
    f. Run shift-left validation (configured testCommand + lintCommand).
    g. On success: create PR via provider.createPullRequest(),
       transition to agent::review.
       Fire @mention (INFO: task-complete).
       If PR requires human review: fire webhook (ACTION: review-needed).
    h. On failure: post friction log, apply status::blocked,
       fire webhook (ACTION: blocked).

Step 4 — DAG Re-evaluation
  When a Task reaches agent::review or agent::done:
    Re-evaluate the dependency DAG.
    Dispatch any newly-unblocked Tasks (return to Step 2).
    If all Tasks under a Story are done, post @mention (INFO:
      feature-complete) on the parent Story and Feature.

Step 5 — Epic Completion
  When all Tasks under the Epic reach agent::done:
    Post summary comment on the Epic issue.
    @mention the operator (INFO) + fire webhook (INFO: epic-complete).
```

### Sprint 3E: Workflow Replacement

**Scope:** Replace existing v4 workflows with ticketing-native equivalents.
Since v5 is a clean break, these are full rewrites rather than incremental
updates.

| Task                                                                                  | Type   | File(s)                                     | Depends On   |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------ |
| Rewrite `/sprint-finalize-task` to call `update-ticket-state.js`                      | MODIFY | `.agents/workflows/sprint-finalize-task.md` | State writer |
| Rewrite `/sprint-integration` to use ticket labels and `provider.createPullRequest()` | MODIFY | `.agents/workflows/sprint-integration.md`   | Provider     |
| Rewrite `/sprint-hotfix` to apply `status::blocked` and fire webhook                  | MODIFY | `.agents/workflows/sprint-hotfix.md`        | Provider     |
| Rewrite `/sprint-retro` to read data from the ticket graph                            | MODIFY | `.agents/workflows/sprint-retro.md`         | Provider     |
| Rewrite `/sprint-close-out` to close the Epic issue via provider                      | MODIFY | `.agents/workflows/sprint-close-out.md`     | Provider     |
| Rewrite `verify-prereqs.js` to check ticket state exclusively                         | MODIFY | `.agents/scripts/verify-prereqs.js`         | Provider     |
| Rewrite `diagnose-friction.js` to post friction logs as ticket comments               | MODIFY | `.agents/scripts/diagnose-friction.js`      | Provider     |

### Sprint 3F: Cleanup & Documentation

**Scope:** Remove deprecated scripts, deprecate `docs/sprints/`, update all
documentation, and ship the final release.

| Task                                                               | Type   | File(s)                                         | Depends On |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------- | ---------- |
| Remove `generate-playbook.js`                                      | DELETE | `.agents/scripts/generate-playbook.js`          | Sprint 3E  |
| Remove `update-task-state.js`                                      | DELETE | `.agents/scripts/update-task-state.js`          | Sprint 3E  |
| Remove `playbook-to-tickets.js`                                    | DELETE | `.agents/scripts/playbook-to-tickets.js`        | Sprint 3E  |
| Deprecate `docs/sprints/` directory (add DEPRECATED.md notice)     | NEW    | `docs/sprints/DEPRECATED.md`                    | All        |
| Rewrite `SDLC.md` — full v5 architecture                           | MODIFY | `.agents/SDLC.md`                               | All        |
| Rewrite `README.md` — document v5 architecture and provider config | MODIFY | `README.md`, `.agents/README.md`                | All        |
| Rewrite `instructions.md` — ticketing-native execution rules       | MODIFY | `.agents/instructions.md`                       | All        |
| Update `default-agentrc.json` — document `orchestration` block     | MODIFY | `.agents/default-agentrc.json`                  | All        |
| Remove `/sprint-generate-playbook` workflow                        | DELETE | `.agents/workflows/sprint-generate-playbook.md` | All        |
| Bump `VERSION` to `5.0.0`                                          | MODIFY | `.agents/VERSION`                               | All        |
| Update `CHANGELOG.md` with v5.0.0 release notes                    | MODIFY | `CHANGELOG.md`                                  | All        |
| Final `npm test` / `npm run lint` validation                       | CHECK  | —                                               | All        |

### Sprint 3G: Dogfood — End-to-End Epic Lifecycle

**Scope:** Run a complete Epic lifecycle entirely through GitHub tickets.

| Task                                                                         | Type   | File(s)             | Depends On |
| ---------------------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Create an Epic issue for a real v5 deliverable                               | MANUAL | GitHub UI           | —          |
| Run `/sprint-plan [Epic ID]` — tickets created on GitHub                     | MANUAL | Antigravity session | Sprint 2C  |
| Run `/sprint-execute [Epic ID]` — dispatcher fetches, hydrates, and executes | MANUAL | Antigravity session | Sprint 3D  |
| Verify state sync — ticket labels transition correctly in GitHub             | MANUAL | GitHub UI           | —          |
| Verify notifications — @mention for INFO, webhook for ACTION events          | MANUAL | GitHub UI / webhook | —          |
| Run `/sprint-integration` — PRs created and linked to Tasks                  | MANUAL | Antigravity session | Sprint 3E  |
| Run `/sprint-retro` — reads sprint data from ticket graph                    | MANUAL | Antigravity session | Sprint 3E  |
| Run `/sprint-close-out` — closes the Epic                                    | MANUAL | Antigravity session | Sprint 3E  |
| Verify zero local playbook or `docs/sprints/` artifacts generated            | CHECK  | CLI check           | —          |

### Phase 3 Exit Criteria

- [ ] `/sprint-execute [Epic ID]` autonomously executes all Tasks under an Epic.
- [ ] Dispatcher correctly resolves sequential/concurrent ordering from the Task
      DAG.
- [ ] Context Hydrator assembles virtual context from Task → Story → Feature →
      Epic → PRD + Tech Spec.
- [ ] State sync updates Task labels and tasklists in real-time.
- [ ] INFO notifications fire via @mention (task-complete, feature-complete,
      epic-complete).
- [ ] ACTION notifications fire via webhook (review-needed, approval-required,
      blocked).
- [ ] All deprecated scripts are removed (not archived).
- [ ] `docs/sprints/` is deprecated with a notice.
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
| `.agents/scripts/context-hydrator.js`            | 3     | Virtual context assembly         |
| `.agents/scripts/dispatcher.js`                  | 3     | DAG scheduler                    |
| `.agents/scripts/update-ticket-state.js`         | 3     | Ticketing state writer           |
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
| `tests/context-hydrator.test.js`                 | 3     | Hydrator unit tests              |
| `tests/dispatcher.test.js`                       | 3     | Dispatcher unit tests            |
| `tests/update-ticket-state.test.js`              | 3     | State writer unit tests          |

### Modified Files

| File                                        | Phase | Change                          |
| ------------------------------------------- | ----- | ------------------------------- |
| `.agents/default-agentrc.json`              | 1     | Add `orchestration` schema      |
| `.agents/scripts/lib/config-resolver.js`    | 1     | Parse `orchestration` block     |
| `tests/structure.test.js`                   | 1     | Validate new locations          |
| `.agents/scripts/lib/Graph.js`              | 3     | Add topological sort            |
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

| File                                            | Reason                      |
| ----------------------------------------------- | --------------------------- |
| `.agents/scripts/generate-playbook.js`          | Replaced by ticket-native   |
| `.agents/scripts/update-task-state.js`          | Replaced by ticket-state.js |
| `.agents/scripts/playbook-to-tickets.js`        | No longer needed            |
| `.agents/workflows/sprint-generate-playbook.md` | No longer needed            |
