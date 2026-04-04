# Version 5.0.0 Implementation Plan

> **Dogfooding Strategy:** This project (`dsj1984/agent-protocols`) serves as
> both the codebase being developed **and** the first consumer of the v5
> ticketing integration. As each phase lands, the project's own SDLC will
> progressively migrate from local playbooks to GitHub-native orchestration—
> proving the architecture on itself before external consumers adopt it.

---

## Guiding Constraints

- **Backwards Compatibility:** The v4.x flat-file pipeline must remain fully
  functional until Phase 4 is complete. No existing workflow may break during
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

## GitHub Project Setup (Pre-Work)

Before any code is written, set up the GitHub infrastructure that v5 will
target. This is a one-time manual setup that creates the "other side" of the
integration.

- [ ] Create a **GitHub Project (V2)** on `dsj1984/agent-protocols` named "Agent
      Protocols — Sprint Board".
- [ ] Add custom fields to the project:
  - `Sprint` (Iteration) — maps to sprint numbers.
  - `Execution` (Single Select) — values: `sequential`, `concurrent`.
  - `Focus Area` (Single Select) — values: `core`, `scripts`, `docs`, `ci`,
    `tests`.
- [ ] Define label taxonomy on the repository:
  - State labels: `agent::ready`, `agent::executing`, `agent::review`,
    `agent::done`.
  - Dependency labels: `status::blocked`.
  - Risk labels: `risk::high`, `risk::medium`.
  - Persona labels: `persona::fullstack`, `persona::architect`, `persona::qa`.
  - Context labels: `context::prd`, `context::tech-spec`.
  - Execution labels: `execution::sequential`, `execution::concurrent`.
  - Focus labels: `focus::core`, `focus::scripts`, `focus::docs`, `focus::ci`,
    `focus::tests`.
- [ ] Create a **Milestone** for `v5.0.0`.
- [ ] Create an **Epic issue** for each phase (Phase 1–4) and assign them to the
      `v5.0.0` milestone.

---

## Phase 1 — Foundations & Shadow Mode

> **Goal:** Build the provider abstraction layer and the GitHub reference
> implementation. Run it in "shadow mode" alongside the existing flat-file
> pipeline to validate data fidelity.
>
> **Tag:** `v5.0.0-alpha.1` through `v5.0.0-alpha.N`

### Sprint 1A: Provider Abstraction Layer

**Scope:** Define the interfaces and build the GitHub provider.

| Task                                                                           | Type   | File(s)                                            | Depends On  |
| ------------------------------------------------------------------------------ | ------ | -------------------------------------------------- | ----------- |
| Define `ITicketingProvider` interface                                          | NEW    | `.agents/scripts/lib/ITicketingProvider.js`        | —           |
| Define `IExecutionAdapter` interface                                           | NEW    | `.agents/scripts/lib/IExecutionAdapter.js`         | —           |
| Add `orchestration` schema to `.agentrc.json`                                  | MODIFY | `.agents/default-agentrc.json`, `.agents/schemas/` | —           |
| Update `config-resolver.js` to parse `orchestration` block                     | MODIFY | `.agents/scripts/lib/config-resolver.js`           | Schema      |
| Build `providers/github.js` — `getTicket()`, `listSprintTickets()` (read-only) | NEW    | `.agents/scripts/providers/github.js`              | Interface   |
| Build `providers/github.js` — `getTicketDependencies()`                        | NEW    | (same file)                                        | `getTicket` |
| Build `providers/github.js` — `getParentContext()`                             | NEW    | (same file)                                        | `getTicket` |
| Unit tests for GitHub provider (read methods)                                  | NEW    | `tests/providers-github.test.js`                   | Provider    |
| Unit tests for interface contracts                                             | NEW    | `tests/ticketing-provider.test.js`                 | Interface   |

### Sprint 1B: Shadow Mode Script

**Scope:** Build a script that mirrors a generated playbook to GitHub Issues,
then validate fidelity by comparing local task-state JSON to ticket labels.

| Task                                                                                                         | Type   | File(s)                                  | Depends On            |
| ------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------- | --------------------- |
| Build `playbook-to-tickets.js` — parses `task-manifest.json` and creates mirrored GitHub Issues via provider | NEW    | `.agents/scripts/playbook-to-tickets.js` | Provider (read+write) |
| Add write methods to `providers/github.js` — `updateTicketState()`, `postComment()`                          | MODIFY | `.agents/scripts/providers/github.js`    | Sprint 1A             |
| Build `validate-shadow.js` — compares `temp/task-state/*.json` to ticket label state and reports drift       | NEW    | `.agents/scripts/validate-shadow.js`     | Provider              |
| Add `/shadow-sync` workflow                                                                                  | NEW    | `.agents/workflows/shadow-sync.md`       | Scripts               |
| Integration test: run shadow sync on this repo's own Sprint board                                            | NEW    | `tests/shadow-sync.integration.js`       | All above             |
| Update `tests/structure.test.js` to validate new file locations                                              | MODIFY | `tests/structure.test.js`                | —                     |

### Phase 1 Exit Criteria

- [ ] `playbook-to-tickets.js` generates GitHub Issues matching 100% of a
      `task-manifest.json`.
- [ ] `validate-shadow.js` reports zero drift after a simulated sprint
      execution.
- [ ] All existing `npm test` and `npm run lint` checks pass.
- [ ] Tagged as `v5.0.0-alpha.1`.

---

## Phase 2 — Context Hydration

> **Goal:** Build the Context Hydrator. Agents read context from GitHub tickets
> instead of the local `playbook.md`. Local state files are still written as a
> safety net.
>
> **Tag:** `v5.0.0-alpha.2` through `v5.0.0-beta.1`

### Sprint 2A: Context Hydration Engine

**Scope:** Build the hydrator that assembles a "virtual playbook" from the
GitHub ticket graph.

| Task                                                                                   | Type   | File(s)                               | Depends On           |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------- | -------------------- |
| Build `context-hydrator.js` — implements the 5-step hydration sequence from roadmap §C | NEW    | `.agents/scripts/context-hydrator.js` | Provider             |
| Token budget integration — respect `maxTokenBudget` and truncate low-priority context  | MODIFY | (same file)                           | `config-resolver.js` |
| Offline fallback — local cache read/write for ticket snapshots                         | NEW    | `.agents/scripts/lib/ticket-cache.js` | —                    |
| Unit tests for hydrator (mocked provider)                                              | NEW    | `tests/context-hydrator.test.js`      | Hydrator             |
| Unit tests for ticket cache                                                            | NEW    | `tests/ticket-cache.test.js`          | Cache                |

### Sprint 2B: Dispatcher (Read Path)

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

### Sprint 2C: Dogfood — Run a Sprint on Hydrated Context

**Scope:** Use this repo's own project board to run a real sprint where agents
consume hydrated ticket context instead of `playbook.md`.

| Task                                                                               | Type   | File(s)                              | Depends On |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------ | ---------- |
| Create Sprint issues on the GitHub Project board for a real sprint of this project | MANUAL | GitHub UI / `playbook-to-tickets.js` | Phase 1    |
| Execute the sprint using `/start-sprint` to hydrate context                        | MANUAL | Antigravity session                  | Sprint 2B  |
| Continue writing state to `temp/task-state/` as safety net                         | —      | Existing scripts                     | —          |
| Capture friction log entries related to context quality                            | MANUAL | `agent-friction-log.json`            | —          |
| Retrospective: document context quality findings                                   | MANUAL | `docs/sprints/`                      | —          |

### Phase 2 Exit Criteria

- [ ] Agents complete a sprint using only hydrated GitHub ticket context.
- [ ] Zero context-fragmentation friction log entries.
- [ ] `dispatcher.js` correctly resolves sequential/concurrent ordering from the
      ticket DAG.
- [ ] Offline fallback produces usable cached context when GitHub API is
      unreachable.
- [ ] Tagged as `v5.0.0-beta.1`.

---

## Phase 3 — State Mutation

> **Goal:** Agents write state to GitHub instead of local JSON files. The
> `temp/task-state/` directory is deprecated.
>
> **Tag:** `v5.0.0-beta.2` through `v5.0.0-rc.1`

### Sprint 3A: State Writer

**Scope:** Refactor `update-task-state.js` to route mutations through the
Ticketing Provider.

| Task                                                                                         | Type   | File(s)                                  | Depends On |
| -------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Build `update-ticket-state.js` — wraps `updateTicketState()` and `postComment()`             | NEW    | `.agents/scripts/update-ticket-state.js` | Provider   |
| Add `createPullRequest()` to `providers/github.js`                                           | MODIFY | `.agents/scripts/providers/github.js`    | —          |
| Refactor `sprint-integrate.js` to call `createPullRequest()` via provider                    | MODIFY | `.agents/scripts/sprint-integrate.js`    | Provider   |
| Refactor `diagnose-friction.js` to post friction logs as ticket comments via `postComment()` | MODIFY | `.agents/scripts/diagnose-friction.js`   | Provider   |
| Unit tests for state writer                                                                  | NEW    | `tests/update-ticket-state.test.js`      | Writer     |
| Update `verify-prereqs.js` to check ticket state instead of (or in addition to) local JSON   | MODIFY | `.agents/scripts/verify-prereqs.js`      | Provider   |
| Update `tests/verify-prereqs.test.js` for dual-source verification                           | MODIFY | `tests/verify-prereqs.test.js`           | Above      |

### Sprint 3B: Workflow Updates

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

### Sprint 3C: Dogfood — Full Read/Write Sprint

**Scope:** Run a sprint on this project where both context hydration AND state
mutation go through GitHub. No local state files should be written.

| Task                                                              | Type   | File(s)             | Depends On |
| ----------------------------------------------------------------- | ------ | ------------------- | ---------- |
| Execute a full sprint against the GitHub Project board            | MANUAL | Antigravity session | Sprint 3B  |
| Verify zero files created in `temp/task-state/`                   | MANUAL | CLI check           | —          |
| Verify all ticket labels transition correctly via `gh issue list` | MANUAL | CLI check           | —          |
| Validate friction log comments appear on correct tickets          | MANUAL | GitHub UI           | —          |

### Phase 3 Exit Criteria

- [ ] No local JSON state files are written during sprint execution.
- [ ] All state is queryable via `gh issue list --label "agent::*"`.
- [ ] `verify-prereqs.js` correctly gates on ticket state.
- [ ] Friction logs are posted as structured ticket comments.
- [ ] Tagged as `v5.0.0-rc.1`.

---

## Phase 4 — Full Cutover

> **Goal:** Deprecate the playbook generation pipeline entirely. Planning agents
> write directly to the GitHub Project board. The filtered board view is the
> single source of truth.
>
> **Tag:** `v5.0.0`

### Sprint 4A: Planning Pipeline Migration

**Scope:** Replace the playbook generation pipeline with direct ticket creation
on the project board.

| Task                                                                                                                                      | Type   | File(s)                                          | Depends On |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ | ---------- |
| Build `plan-to-tickets.js` — planning agents create tickets directly on the Project board with proper dependencies, labels, and tasklists | NEW    | `.agents/scripts/plan-to-tickets.js`             | Provider   |
| Update `/plan-sprint` workflow to call `plan-to-tickets.js` instead of triggering PRD → Tech Spec → Playbook chain                        | MODIFY | `.agents/workflows/plan-sprint.md`               | Above      |
| Update `/sprint-generate-prd` to write to an epic-level ticket body                                                                       | MODIFY | `.agents/workflows/sprint-generate-prd.md`       | Provider   |
| Update `/sprint-generate-tech-spec` to write to a linked ticket                                                                           | MODIFY | `.agents/workflows/sprint-generate-tech-spec.md` | Provider   |
| Deprecate `/sprint-generate-playbook` — add deprecation warning, point to project board                                                   | MODIFY | `.agents/workflows/sprint-generate-playbook.md`  | —          |
| Unit tests for `plan-to-tickets.js`                                                                                                       | NEW    | `tests/plan-to-tickets.test.js`                  | Script     |

### Sprint 4B: Cleanup & Documentation

**Scope:** Archive deprecated scripts, update all documentation, and ship the
final release.

| Task                                                                   | Type   | File(s)                                  | Depends On |
| ---------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------- |
| Archive `generate-playbook.js` to `.agents/scripts/archive/`           | MOVE   | `.agents/scripts/generate-playbook.js`   | Phase 4A   |
| Archive `update-task-state.js` to `.agents/scripts/archive/`           | MOVE   | `.agents/scripts/update-task-state.js`   | Phase 3    |
| Archive `playbook-to-tickets.js` (shadow mode no longer needed)        | MOVE   | `.agents/scripts/playbook-to-tickets.js` | Phase 4A   |
| Update `SDLC.md` — replace playbook references with ticketing workflow | MODIFY | `.agents/SDLC.md`                        | All        |
| Update `README.md` — document v5 architecture and provider config      | MODIFY | `README.md`, `.agents/README.md`         | All        |
| Update `instructions.md` — add ticketing-aware execution rules         | MODIFY | `.agents/instructions.md`                | All        |
| Update `default-agentrc.json` — document `orchestration` block         | MODIFY | `.agents/default-agentrc.json`           | All        |
| Bump `VERSION` to `5.0.0`                                              | MODIFY | `.agents/VERSION`                        | All        |
| Update `CHANGELOG.md` with v5.0.0 release notes                        | MODIFY | `CHANGELOG.md`                           | All        |
| Final `npm test` / `npm run lint` validation                           | CHECK  | —                                        | All        |

### Sprint 4C: Dogfood — End-to-End Cutover Sprint

**Scope:** Run a complete sprint lifecycle (plan → execute → integrate → retro)
entirely through GitHub tickets, with zero local playbook artifacts.

| Task                                                                           | Type   | File(s)             | Depends On |
| ------------------------------------------------------------------------------ | ------ | ------------------- | ---------- |
| Run `/plan-sprint` — tickets are created directly on the Project board         | MANUAL | Antigravity session | Sprint 4A  |
| Run `/start-sprint` — dispatcher fetches, hydrates, and schedules from tickets | MANUAL | Antigravity session | Sprint 2B  |
| Execute all tasks — state syncs to GitHub in real-time                         | MANUAL | Antigravity session | Sprint 3A  |
| Run `/sprint-integration` — PRs are created and linked to tickets              | MANUAL | Antigravity session | Sprint 3B  |
| Run `/sprint-retro` — reads sprint data from the project board                 | MANUAL | Antigravity session | Sprint 3B  |
| Run `/sprint-close-out` — closes the milestone                                 | MANUAL | Antigravity session | Sprint 3B  |
| Verify zero local markdown artifacts were generated outside `docs/`            | CHECK  | CLI check           | —          |

### Phase 4 Exit Criteria

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
| `.agents/scripts/playbook-to-tickets.js`    | 1     | Shadow mode bridge            |
| `.agents/scripts/validate-shadow.js`        | 1     | Shadow fidelity check         |
| `.agents/scripts/context-hydrator.js`       | 2     | Virtual playbook assembly     |
| `.agents/scripts/lib/ticket-cache.js`       | 2     | Offline fallback cache        |
| `.agents/scripts/dispatcher.js`             | 2     | DAG scheduler                 |
| `.agents/scripts/update-ticket-state.js`    | 3     | Ticketing state writer        |
| `.agents/scripts/plan-to-tickets.js`        | 4     | Direct ticket planning        |
| `.agents/workflows/shadow-sync.md`          | 1     | Shadow validation workflow    |
| `.agents/workflows/start-sprint.md`         | 2     | Ticketing-native sprint start |
| `tests/providers-github.test.js`            | 1     | Provider unit tests           |
| `tests/ticketing-provider.test.js`          | 1     | Interface contract tests      |
| `tests/shadow-sync.integration.js`          | 1     | Integration test              |
| `tests/context-hydrator.test.js`            | 2     | Hydrator unit tests           |
| `tests/ticket-cache.test.js`                | 2     | Cache unit tests              |
| `tests/dispatcher.test.js`                  | 2     | Dispatcher unit tests         |
| `tests/update-ticket-state.test.js`         | 3     | State writer unit tests       |
| `tests/plan-to-tickets.test.js`             | 4     | Planning unit tests           |

### Modified Files

| File                                            | Phase | Change                      |
| ----------------------------------------------- | ----- | --------------------------- |
| `.agents/default-agentrc.json`                  | 1     | Add `orchestration` schema  |
| `.agents/scripts/lib/config-resolver.js`        | 1     | Parse `orchestration` block |
| `.agents/scripts/lib/Graph.js`                  | 2     | Add topological sort        |
| `.agents/scripts/sprint-integrate.js`           | 3     | Route through provider      |
| `.agents/scripts/diagnose-friction.js`          | 3     | Post to tickets             |
| `.agents/scripts/verify-prereqs.js`             | 3     | Dual-source state checks    |
| `.agents/scripts/update-task-state.js`          | 3     | Deprecation wrapper         |
| `.agents/workflows/sprint-finalize-task.md`     | 3     | Use ticket state            |
| `.agents/workflows/sprint-integration.md`       | 3     | Check ticket labels         |
| `.agents/workflows/sprint-hotfix.md`            | 3     | Apply blocked label         |
| `.agents/workflows/sprint-retro.md`             | 3     | Read from board             |
| `.agents/workflows/sprint-close-out.md`         | 3     | Close milestone             |
| `.agents/workflows/plan-sprint.md`              | 4     | Direct ticket creation      |
| `.agents/workflows/sprint-generate-playbook.md` | 4     | Deprecation notice          |
| `.agents/SDLC.md`                               | 4     | Full rewrite for v5         |
| `README.md`                                     | 4     | Document v5 architecture    |
| `.agents/instructions.md`                       | 4     | Ticketing execution rules   |
| `.agents/VERSION`                               | 4     | Bump to `5.0.0`             |
| `CHANGELOG.md`                                  | 4     | v5.0.0 release notes        |
| `tests/structure.test.js`                       | 1     | Validate new locations      |
| `tests/verify-prereqs.test.js`                  | 3     | Dual-source tests           |

### Archived Files (Phase 4)

| File                                     | Destination                |
| ---------------------------------------- | -------------------------- |
| `.agents/scripts/generate-playbook.js`   | `.agents/scripts/archive/` |
| `.agents/scripts/update-task-state.js`   | `.agents/scripts/archive/` |
| `.agents/scripts/playbook-to-tickets.js` | `.agents/scripts/archive/` |
