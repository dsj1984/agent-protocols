# Version 5.0.0 Implementation Plan

> **Dogfooding Strategy:** This project (`dsj1984/agent-protocols`) serves as
> both the codebase being developed **and** the first consumer of the v5
> ticketing integration. As each phase lands, the project's own SDLC will
> progressively migrate from local playbooks to GitHub-native orchestration—
> proving the architecture on itself before external consumers adopt it.

---

## Guiding Constraints

- **Backwards Compatibility:** The v4.x flat-file pipeline must remain fully
  functional until Phase 5 is complete. No existing workflow may break during
  the migration.
- **Ship Incrementally:** Each phase is a tagged pre-release (`v5.0.0-alpha.N`,
  `v5.0.0-beta.N`, `v5.0.0-rc.N`) so consumers on the `dist` branch can opt-in
  gradually.
- **Test-Driven:** Every new module ships with co-located unit tests in
  `tests/`. Integration tests run against the live GitHub API using this repo's
  own issues and project board.
- **Provider-First:** All code is written against the `ITicketingProvider` /
  `IExecutionAdapter` interfaces from day one. No direct GitHub API calls
  outside of `providers/github.js`.

---

## Phase 1 — Bootstrap & Provider Foundations

> **Goal:** Build the provider abstraction layer, the GitHub reference
> implementation, and the automated bootstrap script. By the end of this phase
> any consumer can run `/bootstrap-project` to initialize their ticketing
> platform from a single command.
>
> **Tag:** `v5.0.0-alpha.1`

### Why Bootstrap First

Before any orchestration code can be validated, the target ticketing platform
must be initialized with the required project board, labels, milestones, and
epic issues. Making this **Phase 1** ensures:

1. **Consumers get a one-command onboarding experience** (`/bootstrap-project`)
   instead of a manual checklist.
2. The bootstrap script doubles as the **first integration test** of the
   provider's write APIs.
3. The setup is **idempotent** — running it again skips resources that already
   exist.
4. The interfaces are battle-tested on real API calls before the more complex
   hydration and state-sync code builds on top of them.

### What the Bootstrap Creates

**Project Board:**

- A Project (V2) named "[Repo Name] — Sprint Board" with custom fields:
  - `Sprint` (Iteration) — maps to sprint numbers.
  - `Execution` (Single Select) — values: `sequential`, `concurrent`.
  - `Focus Area` (Single Select) — values: `core`, `scripts`, `docs`, `ci`,
    `tests`.

**Label Taxonomy** (created via REST API / MCP):

| Category    | Labels                                                                      | Color                  |
| ----------- | --------------------------------------------------------------------------- | ---------------------- |
| Agent State | `agent::ready`, `agent::executing`, `agent::review`, `agent::done`          | `#0E8A16` (green)      |
| Status      | `status::blocked`                                                           | `#D93F0B` (red)        |
| Risk        | `risk::high`, `risk::medium`                                                | `#FBCA04` (yellow)     |
| Persona     | `persona::fullstack`, `persona::architect`, `persona::qa`                   | `#C5DEF5` (blue)       |
| Context     | `context::prd`, `context::tech-spec`                                        | `#D4C5F9` (purple)     |
| Execution   | `execution::sequential`, `execution::concurrent`                            | `#F9D0C4` (peach)      |
| Focus       | `focus::core`, `focus::scripts`, `focus::docs`, `focus::ci`, `focus::tests` | `#BFD4F2` (light blue) |

**Milestones & Epics:**

- A milestone for the target version (e.g., `v5.0.0`).
- One epic issue per implementation phase, assigned to the milestone.

### Sprint 1A: Provider Abstraction Layer

**Scope:** Define the abstract interfaces and build the GitHub provider's core
read and write methods.

| Task                                                                                                                                           | Type   | File(s)                                            | Depends On  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- | ----------- |
| Define `ITicketingProvider` interface (including optional setup methods: `createProject`, `createLabel`, `createMilestone`, `createEpicIssue`) | NEW    | `.agents/scripts/lib/ITicketingProvider.js`        | —           |
| Define `IExecutionAdapter` interface                                                                                                           | NEW    | `.agents/scripts/lib/IExecutionAdapter.js`         | —           |
| Add `orchestration` schema to `.agentrc.json`                                                                                                  | MODIFY | `.agents/default-agentrc.json`, `.agents/schemas/` | —           |
| Update `config-resolver.js` to parse `orchestration` block                                                                                     | MODIFY | `.agents/scripts/lib/config-resolver.js`           | Schema      |
| Build `providers/github.js` — `getTicket()`, `listSprintTickets()` (read)                                                                      | NEW    | `.agents/scripts/providers/github.js`              | Interface   |
| Build `providers/github.js` — `getTicketDependencies()`                                                                                        | NEW    | (same file)                                        | `getTicket` |
| Build `providers/github.js` — `getParentContext()`                                                                                             | NEW    | (same file)                                        | `getTicket` |
| Build `providers/github.js` — `updateTicketState()`, `postComment()` (write)                                                                   | NEW    | (same file)                                        | Interface   |
| Build `providers/github.js` — `createProject()`, `createLabel()`, `createMilestone()`, `createEpicIssue()` (setup)                             | NEW    | (same file)                                        | Interface   |
| Unit tests for GitHub provider                                                                                                                 | NEW    | `tests/providers-github.test.js`                   | Provider    |
| Unit tests for interface contracts                                                                                                             | NEW    | `tests/ticketing-provider.test.js`                 | Interface   |

### Sprint 1B: Bootstrap Script & Workflow

**Scope:** Build the idempotent bootstrap script and its workflow entry point.

| Task                                                                                                                        | Type   | File(s)                                  | Depends On |
| --------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Build `bootstrap-project.js` — idempotent setup that creates project board, labels, milestone, and epic issues via provider | NEW    | `.agents/scripts/bootstrap-project.js`   | Provider   |
| Add `/bootstrap-project` workflow                                                                                           | NEW    | `.agents/workflows/bootstrap-project.md` | Script     |
| Unit tests for bootstrap (mocked provider)                                                                                  | NEW    | `tests/bootstrap-project.test.js`        | Bootstrap  |
| Integration test: run bootstrap against this repo's own GitHub Project                                                      | NEW    | `tests/bootstrap-project.integration.js` | All above  |
| Update `tests/structure.test.js` to validate new file locations                                                             | MODIFY | `tests/structure.test.js`                | —          |

### Sprint 1C: Dogfood — Bootstrap This Project

**Scope:** Run `/bootstrap-project` against `dsj1984/agent-protocols` to create
the v5 project board, labels, and milestone that all subsequent phases will
target.

| Task                                                                       | Type   | File(s)             | Depends On |
| -------------------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Configure `.agentrc.json` with `orchestration` block pointing to this repo | MODIFY | `.agentrc.json`     | Sprint 1A  |
| Run `/bootstrap-project --provider github --milestone v5.0.0`              | MANUAL | Antigravity session | Sprint 1B  |
| Verify project board exists with correct custom fields                     | MANUAL | GitHub UI           | —          |
| Verify all labels created with correct colors                              | MANUAL | GitHub UI / API     | —          |
| Verify milestone and 5 epic issues created                                 | MANUAL | GitHub UI           | —          |

**API Surface:**

The bootstrap extends `ITicketingProvider` with optional setup methods:

- `createProject(name, fields)` — Create a project board with custom fields.
  Uses the GraphQL API for GitHub Projects V2 (`gh api graphql` / Octokit
  GraphQL). Falls back to a no-op with a warning for providers that don't
  support programmatic project creation.
- `createLabel(name, color, description)` — Create a repository label. Uses the
  REST API (fully supported by GitHub, GitLab, Jira, Linear).
- `createMilestone(title, description)` — Create a milestone/iteration.
- `createEpicIssue(title, body, milestone)` — Create a parent issue.

Providers that don't support a specific primitive (e.g., Jira projects are
created via admin UI) log a warning and return a skip result, allowing the
bootstrap to complete partially.

**Workflow:**

```text
/bootstrap-project [--provider github] [--milestone v5.0.0]
```

Reads `orchestration.providerConfig` from `.agentrc.json`, instantiates the
correct provider, and runs the idempotent setup sequence. On completion, prints
a summary of created vs. skipped resources.

### Phase 1 Exit Criteria

- [ ] `ITicketingProvider` and `IExecutionAdapter` interfaces defined with full
      method signatures.
- [ ] `providers/github.js` implements all read, write, and setup methods.
- [ ] `bootstrap-project.js` is idempotent and creates all required resources.
- [ ] This repo's own GitHub Project board, labels, milestone, and epic issues
      are created via the bootstrap script (not manually).
- [ ] All existing `npm test` and `npm run lint` checks pass.
- [ ] Tagged as `v5.0.0-alpha.1`.

---

## Phase 2 — Shadow Mode

> **Goal:** Build a script that mirrors a generated playbook to GitHub Issues,
> then validate fidelity by comparing local task-state JSON to ticket labels.
> This proves the data ontology mapping before any workflow changes.
>
> **Tag:** `v5.0.0-alpha.2`

### Sprint 2A: Shadow Sync

**Scope:** Mirror the existing playbook pipeline to GitHub issues and validate
data fidelity.

| Task                                                                                                         | Type | File(s)                                  | Depends On |
| ------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------- | ---------- |
| Build `playbook-to-tickets.js` — parses `task-manifest.json` and creates mirrored GitHub Issues via provider | NEW  | `.agents/scripts/playbook-to-tickets.js` | Phase 1    |
| Build `validate-shadow.js` — compares `temp/task-state/*.json` to ticket label state and reports drift       | NEW  | `.agents/scripts/validate-shadow.js`     | Provider   |
| Add `/shadow-sync` workflow                                                                                  | NEW  | `.agents/workflows/shadow-sync.md`       | Scripts    |
| Integration test: run shadow sync on this repo's own Sprint board                                            | NEW  | `tests/shadow-sync.integration.js`       | All above  |

### Sprint 2B: Dogfood — Shadow a Real Sprint

**Scope:** Run agents locally against the playbook as usual while the shadow
sync mirrors state to GitHub. Validate fidelity at sprint end.

| Task                                                       | Type   | File(s)             | Depends On |
| ---------------------------------------------------------- | ------ | ------------------- | ---------- |
| Generate a playbook for a real sprint of this project      | MANUAL | Existing pipeline   | —          |
| Run `/shadow-sync` to mirror tickets to GitHub             | MANUAL | Antigravity session | Sprint 2A  |
| Execute the sprint using the existing flat-file pipeline   | MANUAL | Existing pipeline   | —          |
| Run `validate-shadow.js` at sprint end — verify zero drift | MANUAL | CLI                 | —          |

### Phase 2 Exit Criteria

- [ ] `playbook-to-tickets.js` generates GitHub Issues matching 100% of a
      `task-manifest.json`.
- [ ] `validate-shadow.js` reports zero drift after a full sprint execution.
- [ ] All existing `npm test` and `npm run lint` checks pass.
- [ ] Tagged as `v5.0.0-alpha.2`.

---

## Phase 3 — Context Hydration

> **Goal:** Build the Context Hydrator. Agents read context from GitHub tickets
> instead of the local `playbook.md`. Local state files are still written as a
> safety net.
>
> **Tag:** `v5.0.0-beta.1`

### Sprint 3A: Context Hydration Engine

**Scope:** Build the hydrator that assembles a "virtual playbook" from the
GitHub ticket graph.

| Task                                                                                   | Type   | File(s)                               | Depends On           |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------- | -------------------- |
| Build `context-hydrator.js` — implements the 5-step hydration sequence from roadmap §C | NEW    | `.agents/scripts/context-hydrator.js` | Phase 1              |
| Token budget integration — respect `maxTokenBudget` and truncate low-priority context  | MODIFY | (same file)                           | `config-resolver.js` |
| Offline fallback — local cache read/write for ticket snapshots                         | NEW    | `.agents/scripts/lib/ticket-cache.js` | —                    |
| Unit tests for hydrator (mocked provider)                                              | NEW    | `tests/context-hydrator.test.js`      | Hydrator             |
| Unit tests for ticket cache                                                            | NEW    | `tests/ticket-cache.test.js`          | Cache                |

### Sprint 3B: Dispatcher (Read Path)

**Scope:** Build the dispatcher that fetches tickets and builds the dependency
DAG, replacing the playbook-parsing entry point.

| Task                                                                          | Type   | File(s)                             | Depends On               |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------- | ------------------------ |
| Build `dispatcher.js` — fetch tickets, build DAG, topological sort            | NEW    | `.agents/scripts/dispatcher.js`     | Provider, `lib/Graph.js` |
| Extend `lib/Graph.js` with topological sort if not present                    | MODIFY | `.agents/scripts/lib/Graph.js`      | —                        |
| DAG scheduling logic — concurrent vs. sequential dispatch                     | MODIFY | `.agents/scripts/dispatcher.js`     | Graph                    |
| Focus area conflict detection — prevent concurrent dispatch of same `focus::` | MODIFY | (same file)                         | Graph                    |
| Unit tests for dispatcher DAG scheduling                                      | NEW    | `tests/dispatcher.test.js`          | Dispatcher               |
| Add `/start-sprint` workflow (read-only: fetch + hydrate + display plan)      | NEW    | `.agents/workflows/start-sprint.md` | Dispatcher, Hydrator     |

### Sprint 3C: Dogfood — Run a Sprint on Hydrated Context

**Scope:** Use this repo's own project board to run a real sprint where agents
consume hydrated ticket context instead of `playbook.md`.

| Task                                                                               | Type   | File(s)                              | Depends On |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------ | ---------- |
| Create Sprint issues on the GitHub Project board for a real sprint of this project | MANUAL | GitHub UI / `playbook-to-tickets.js` | Phase 2    |
| Execute the sprint using `/start-sprint` to hydrate context                        | MANUAL | Antigravity session                  | Sprint 3B  |
| Continue writing state to `temp/task-state/` as safety net                         | —      | Existing scripts                     | —          |
| Capture friction log entries related to context quality                            | MANUAL | `agent-friction-log.json`            | —          |
| Retrospective: document context quality findings                                   | MANUAL | `docs/sprints/`                      | —          |

### Phase 3 Exit Criteria

- [ ] Agents complete a sprint using only hydrated GitHub ticket context.
- [ ] Zero context-fragmentation friction log entries.
- [ ] `dispatcher.js` correctly resolves sequential/concurrent ordering from the
      ticket DAG.
- [ ] Offline fallback produces usable cached context when GitHub API is
      unreachable.
- [ ] Tagged as `v5.0.0-beta.1`.

---

## Phase 4 — State Mutation

> **Goal:** Agents write state to GitHub instead of local JSON files. The
> `temp/task-state/` directory is deprecated.
>
> **Tag:** `v5.0.0-rc.1`

### Sprint 4A: State Writer

**Scope:** Refactor `update-task-state.js` to route mutations through the
Ticketing Provider.

| Task                                                                                         | Type   | File(s)                                  | Depends On |
| -------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Build `update-ticket-state.js` — wraps `updateTicketState()` and `postComment()`             | NEW    | `.agents/scripts/update-ticket-state.js` | Phase 1    |
| Add `createPullRequest()` to `providers/github.js`                                           | MODIFY | `.agents/scripts/providers/github.js`    | —          |
| Refactor `sprint-integrate.js` to call `createPullRequest()` via provider                    | MODIFY | `.agents/scripts/sprint-integrate.js`    | Provider   |
| Refactor `diagnose-friction.js` to post friction logs as ticket comments via `postComment()` | MODIFY | `.agents/scripts/diagnose-friction.js`   | Provider   |
| Unit tests for state writer                                                                  | NEW    | `tests/update-ticket-state.test.js`      | Writer     |
| Update `verify-prereqs.js` to check ticket state instead of (or in addition to) local JSON   | MODIFY | `.agents/scripts/verify-prereqs.js`      | Provider   |
| Update `tests/verify-prereqs.test.js` for dual-source verification                           | MODIFY | `tests/verify-prereqs.test.js`           | Above      |

### Sprint 4B: Workflow Updates

**Scope:** Update existing workflows to consume the ticketing-backed state
utilities instead of local file paths.

| Task                                                                                  | Type   | File(s)                                     | Depends On   |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------ |
| Update `/sprint-finalize-task` to call `update-ticket-state.js`                       | MODIFY | `.agents/workflows/sprint-finalize-task.md` | State writer |
| Update `/sprint-integration` to check ticket labels for gate decisions                | MODIFY | `.agents/workflows/sprint-integration.md`   | Provider     |
| Update `/sprint-hotfix` to apply `status::blocked` via provider                       | MODIFY | `.agents/workflows/sprint-hotfix.md`        | Provider     |
| Update `/sprint-retro` to read sprint data from the project board                     | MODIFY | `.agents/workflows/sprint-retro.md`         | Provider     |
| Update `/sprint-close-out` to close the milestone via provider                        | MODIFY | `.agents/workflows/sprint-close-out.md`     | Provider     |
| Deprecation notice in `update-task-state.js` — warn if called, delegate to new script | MODIFY | `.agents/scripts/update-task-state.js`      | State writer |

### Sprint 4C: Dogfood — Full Read/Write Sprint

**Scope:** Run a sprint on this project where both context hydration AND state
mutation go through GitHub. No local state files should be written.

| Task                                                              | Type   | File(s)             | Depends On |
| ----------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Execute a full sprint against the GitHub Project board            | MANUAL | Antigravity session | Sprint 4B  |
| Verify zero files created in `temp/task-state/`                   | MANUAL | CLI check           | —          |
| Verify all ticket labels transition correctly via `gh issue list` | MANUAL | CLI check           | —          |
| Validate friction log comments appear on correct tickets          | MANUAL | GitHub UI           | —          |

### Phase 4 Exit Criteria

- [ ] No local JSON state files are written during sprint execution.
- [ ] All state is queryable via `gh issue list --label "agent::*"`.
- [ ] `verify-prereqs.js` correctly gates on ticket state.
- [ ] Friction logs are posted as structured ticket comments.
- [ ] Tagged as `v5.0.0-rc.1`.

---

## Phase 5 — Full Cutover

> **Goal:** Deprecate the playbook generation pipeline entirely. Planning agents
> write directly to the GitHub Project board. The filtered board view is the
> single source of truth.
>
> **Tag:** `v5.0.0`

### Sprint 5A: Planning Pipeline Migration

**Scope:** Replace the playbook generation pipeline with direct ticket creation
on the project board.

| Task                                                                                                                                      | Type   | File(s)                                          | Depends On |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ | ---------- |
| Build `plan-to-tickets.js` — planning agents create tickets directly on the Project board with proper dependencies, labels, and tasklists | NEW    | `.agents/scripts/plan-to-tickets.js`             | Phase 1    |
| Update `/plan-sprint` workflow to call `plan-to-tickets.js` instead of triggering PRD → Tech Spec → Playbook chain                        | MODIFY | `.agents/workflows/plan-sprint.md`               | Above      |
| Update `/sprint-generate-prd` to write to an epic-level ticket body                                                                       | MODIFY | `.agents/workflows/sprint-generate-prd.md`       | Provider   |
| Update `/sprint-generate-tech-spec` to write to a linked ticket                                                                           | MODIFY | `.agents/workflows/sprint-generate-tech-spec.md` | Provider   |
| Deprecate `/sprint-generate-playbook` — add deprecation warning, point to project board                                                   | MODIFY | `.agents/workflows/sprint-generate-playbook.md`  | —          |
| Unit tests for `plan-to-tickets.js`                                                                                                       | NEW    | `tests/plan-to-tickets.test.js`                  | Script     |

### Sprint 5B: Cleanup & Documentation

**Scope:** Archive deprecated scripts, update all documentation, and ship the
final release.

| Task                                                                   | Type   | File(s)                                  | Depends On |
| ---------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Archive `generate-playbook.js` to `.agents/scripts/archive/`           | MOVE   | `.agents/scripts/generate-playbook.js`   | Phase 5A   |
| Archive `update-task-state.js` to `.agents/scripts/archive/`           | MOVE   | `.agents/scripts/update-task-state.js`   | Phase 4    |
| Archive `playbook-to-tickets.js` (shadow mode no longer needed)        | MOVE   | `.agents/scripts/playbook-to-tickets.js` | Phase 5A   |
| Update `SDLC.md` — replace playbook references with ticketing workflow | MODIFY | `.agents/SDLC.md`                        | All        |
| Update `README.md` — document v5 architecture and provider config      | MODIFY | `README.md`, `.agents/README.md`         | All        |
| Update `instructions.md` — add ticketing-aware execution rules         | MODIFY | `.agents/instructions.md`                | All        |
| Update `default-agentrc.json` — document `orchestration` block         | MODIFY | `.agents/default-agentrc.json`           | All        |
| Bump `VERSION` to `5.0.0`                                              | MODIFY | `.agents/VERSION`                        | All        |
| Update `CHANGELOG.md` with v5.0.0 release notes                        | MODIFY | `CHANGELOG.md`                           | All        |
| Final `npm test` / `npm run lint` validation                           | CHECK  | —                                        | All        |

### Sprint 5C: Dogfood — End-to-End Cutover Sprint

**Scope:** Run a complete sprint lifecycle (plan → execute → integrate → retro)
entirely through GitHub tickets, with zero local playbook artifacts.

| Task                                                                           | Type   | File(s)             | Depends On |
| ------------------------------------------------------------------------------ | ------ | ------------------- | ---------- |
| Run `/plan-sprint` — tickets are created directly on the Project board         | MANUAL | Antigravity session | Sprint 5A  |
| Run `/start-sprint` — dispatcher fetches, hydrates, and schedules from tickets | MANUAL | Antigravity session | Phase 3    |
| Execute all tasks — state syncs to GitHub in real-time                         | MANUAL | Antigravity session | Phase 4    |
| Run `/sprint-integration` — PRs are created and linked to tickets              | MANUAL | Antigravity session | Sprint 4B  |
| Run `/sprint-retro` — reads sprint data from the project board                 | MANUAL | Antigravity session | Sprint 4B  |
| Run `/sprint-close-out` — closes the milestone                                 | MANUAL | Antigravity session | Sprint 4B  |
| Verify zero local markdown artifacts were generated outside `docs/`            | CHECK  | CLI check           | —          |

### Phase 5 Exit Criteria

- [ ] End-to-end sprint completes with zero local playbook artifacts.
- [ ] The GitHub Project board is the single source of truth for sprint state.
- [ ] All deprecated scripts are archived.
- [ ] All documentation reflects the v5 architecture.
- [ ] `VERSION` reads `5.0.0`.
- [ ] Tagged and released as `v5.0.0`.

---

## File Impact Summary

### New Files

| File                                        | Phase | Purpose                       |
| ------------------------------------------- | ----- | ----------------------------- |
| `.agents/scripts/lib/ITicketingProvider.js` | 1     | Abstract interface            |
| `.agents/scripts/lib/IExecutionAdapter.js`  | 1     | Abstract interface            |
| `.agents/scripts/providers/github.js`       | 1     | Reference provider            |
| `.agents/scripts/bootstrap-project.js`      | 1     | Automated project setup       |
| `.agents/scripts/playbook-to-tickets.js`    | 2     | Shadow mode bridge            |
| `.agents/scripts/validate-shadow.js`        | 2     | Shadow fidelity check         |
| `.agents/scripts/context-hydrator.js`       | 3     | Virtual playbook assembly     |
| `.agents/scripts/lib/ticket-cache.js`       | 3     | Offline fallback cache        |
| `.agents/scripts/dispatcher.js`             | 3     | DAG scheduler                 |
| `.agents/scripts/update-ticket-state.js`    | 4     | Ticketing state writer        |
| `.agents/scripts/plan-to-tickets.js`        | 5     | Direct ticket planning        |
| `.agents/workflows/bootstrap-project.md`    | 1     | Automated project setup       |
| `.agents/workflows/shadow-sync.md`          | 2     | Shadow validation workflow    |
| `.agents/workflows/start-sprint.md`         | 3     | Ticketing-native sprint start |
| `tests/providers-github.test.js`            | 1     | Provider unit tests           |
| `tests/ticketing-provider.test.js`          | 1     | Interface contract tests      |
| `tests/bootstrap-project.test.js`           | 1     | Bootstrap unit tests          |
| `tests/bootstrap-project.integration.js`    | 1     | Bootstrap integration test    |
| `tests/shadow-sync.integration.js`          | 2     | Shadow integration test       |
| `tests/context-hydrator.test.js`            | 3     | Hydrator unit tests           |
| `tests/ticket-cache.test.js`                | 3     | Cache unit tests              |
| `tests/dispatcher.test.js`                  | 3     | Dispatcher unit tests         |
| `tests/update-ticket-state.test.js`         | 4     | State writer unit tests       |
| `tests/plan-to-tickets.test.js`             | 5     | Planning unit tests           |

### Modified Files

| File                                            | Phase | Change                      |
| ----------------------------------------------- | ----- | --------------------------- |
| `.agents/default-agentrc.json`                  | 1     | Add `orchestration` schema  |
| `.agents/scripts/lib/config-resolver.js`        | 1     | Parse `orchestration` block |
| `tests/structure.test.js`                       | 1     | Validate new locations      |
| `.agents/scripts/lib/Graph.js`                  | 3     | Add topological sort        |
| `.agents/scripts/sprint-integrate.js`           | 4     | Route through provider      |
| `.agents/scripts/diagnose-friction.js`          | 4     | Post to tickets             |
| `.agents/scripts/verify-prereqs.js`             | 4     | Dual-source state checks    |
| `.agents/scripts/update-task-state.js`          | 4     | Deprecation wrapper         |
| `.agents/workflows/sprint-finalize-task.md`     | 4     | Use ticket state            |
| `.agents/workflows/sprint-integration.md`       | 4     | Check ticket labels         |
| `.agents/workflows/sprint-hotfix.md`            | 4     | Apply blocked label         |
| `.agents/workflows/sprint-retro.md`             | 4     | Read from board             |
| `.agents/workflows/sprint-close-out.md`         | 4     | Close milestone             |
| `tests/verify-prereqs.test.js`                  | 4     | Dual-source tests           |
| `.agents/workflows/plan-sprint.md`              | 5     | Direct ticket creation      |
| `.agents/workflows/sprint-generate-playbook.md` | 5     | Deprecation notice          |
| `.agents/SDLC.md`                               | 5     | Full rewrite for v5         |
| `README.md`                                     | 5     | Document v5 architecture    |
| `.agents/instructions.md`                       | 5     | Ticketing execution rules   |
| `.agents/VERSION`                               | 5     | Bump to `5.0.0`             |
| `CHANGELOG.md`                                  | 5     | v5.0.0 release notes        |

### Archived Files (Phase 5)

| File                                     | Destination                |
| ---------------------------------------- | -------------------------- |
| `.agents/scripts/generate-playbook.js`   | `.agents/scripts/archive/` |
| `.agents/scripts/update-task-state.js`   | `.agents/scripts/archive/` |
| `.agents/scripts/playbook-to-tickets.js` | `.agents/scripts/archive/` |
