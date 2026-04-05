---
sprint: 001
status: draft
protocolVersion: 4.4.0
---

# Test Plan: Ticket Orchestration Backend (v5 Migration)

This document establishes the Quality Assurance criteria and boundaries for the
"Ticketing Orchestration Backend" components outlined in the v5 Architectural
Roadmap.

## 1. Objectives

The primary goal of Sprint 001 validation is to ensure strict compliance with
the new API-driven execution boundary. The previous iteration of Agent-Protocols
utilized local JSON stores (`task-state.json`), whereas v5 strictly reads and
logs state to the remote DB via `Dispatcher` and `Context Hydration Engine` REST
interfaces.

## 2. Test Scope

### In-Scope

- `generate-playbook.js` remote manifest retrieval.
- `Context Hydration Engine` parsing logic and DB serialization.
- Topology validation inside the `Dispatcher` (verifying cycles, blocking rules,
  etc.).
- `run-agent-loop-e2e.test.js` updates required to leverage the remote ticketing
  DB over the legacy `.agents` local JSON file struct.

### Out-of-Scope

- Frontend/UI dashboard testing.
- Legacy `task-state.json` fallback logic.
- Telemetry aggregation reporting (handled in subsequent sprints).

## 3. Test Environments

All tests mandated to run within standard Node.js native testing via
`node --test` with isolated file systems utilizing `memfs`. We will test `axios`
or equivalent API network interfaces using internal HTTP interceptors (`msw` or
`nock`). No standard production endpoints will be invoked during loop
validation.

## 4. Test Cases

| ID     | Description                                         | Component  | Expected Outcome                                    |
| ------ | --------------------------------------------------- | ---------- | --------------------------------------------------- |
| TC-001 | Topology Validation restricts circular dependencies | Dispatcher | Returns HTTP 400 Bad Request with details           |
| TC-002 | Context Hydration fetches API docs correctly        | Engine     | `libraryIndex` property populates successfully      |
| TC-003 | Dispatcher routes tasks correctly over REPL         | Dispatcher | E2E Memfs REPL simulator fires network state change |
| TC-004 | Failed API commits persist localized retry state    | Engine     | `status: pending-retry` appended to task item       |

## 5. Metrics & Acceptance Criteria

- Code coverage must remain above 95% across `tests/e2e/` and unit boundaries
  for newly modified REST paths.
- E2E memory filesystem leaks should be actively audited and reset
  (`vol.reset()`) per testing initialization step.
