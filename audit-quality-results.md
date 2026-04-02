# Testing & Quality Assurance Audit

## Executive Summary

The `agent-protocols` repository currently utilizes the native Node.js test
runner (`node --test`) to validate structural invariants and core DAG parsing
logic. The test suite is extremely fast (~135ms execution), deterministic, and
free of flaky asynchronous assertions. However, as the framework has evolved
into Version 3.0.0 with the addition of sophisticated telemetry, FinOps, and
local RAG scripts, the unit test coverage has fallen behind. The newly
introduced Node.js utility scripts (`aggregate-telemetry.js`,
`context-indexer.js`, `diagnose-friction.js`, `verify-prereqs.js`) currently
lack dedicated unit tests, exposing the framework to potential regressions.

## Test Strategy Assessment

| Layer               | Status     | Notes                                                                                                                                                            |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit Testing        | Needs Work | `generate-playbook.js` is robustly tested, but new v2.x and v3.x utilities are completely untested.                                                              |
| Integration Testing | Missing    | No pipeline tests simulating sequential script executions (e.g., plan -> track state -> compile telemetry).                                                      |
| E2E Testing         | Missing    | Validating prompts against actual LLM outputs is out-of-scope, but E2E simulation of script executions on mock repos is absent.                                  |
| Test Plans          | Healthy    | As a protocol framework, there are no project-specific sprint test plans, but the structural self-validation (`structure.test.js`) acts as an internal baseline. |

## Detailed Findings

### Missing Unit Coverage for Version 3.0 Telemetry & RAG Scripts

- **Category:** Coverage
- **Impact:** High
- **Current State:** The tests inside the `tests/` directory only cover
  `generate-playbook.js` and structural invariants. The newly introduced scripts
  in `.agents/scripts/` (`aggregate-telemetry.js`, `context-indexer.js`,
  `diagnose-friction.js`, and `verify-prereqs.js`) have no unit test coverage,
  risking hidden regressions during future SDLC automation enhancements.
- **Recommendation & Rationale:** Implement dedicated unit test files (e.g.,
  `tests/aggregate-telemetry.test.js`, `tests/verify-prereqs.test.js`) testing
  edge cases such as budget limits, missing files, and semantic ranking
  extraction.
- **Agent Prompt:**
  `Please create unit tests using 'node:test' for the '.agents/scripts/aggregate-telemetry.js' and '.agents/scripts/context-indexer.js' files to ensure robust coverage for Version 3.0.0 features.`

### Missing Integration Test for Decoupled State

- **Category:** Coverage
- **Impact:** Medium
- **Current State:** Version 2.x introduced decoupled task state tracking
  (`/task-state/*.json`), replacing Git-based updates in the playbook. There are
  no tests verifying that `verify-prereqs.js` correctly correlates the
  manifest's dependency graph with the decoupled state files.
- **Recommendation & Rationale:** Create a mock project environment in a local
  temporary directory within the test suite, write test state files, and assert
  that `verify-prereqs.js` successfully evaluates DAG boundaries.
- **Agent Prompt:**
  `Please implement an integration test for 'verify-prereqs.js' within 'tests/verify-prereqs.test.js'. The test should set up a mock 'temp/task-state' directory, write dummy JSON state files simulating concurrent agent execution, and verify the script correctly blocks or unblocks downstream tasks.`

### Hardcoded File Paths in Test Suite

- **Category:** Fragility
- **Impact:** Low
- **Current State:** `structure.test.js` hardcodes paths to specific `.md` files
  under `personas/` (e.g., `personas/architect.md`). While acceptable, if new
  core personas are added or renamed, this structural test will either fail or
  miss them.
- **Recommendation & Rationale:** Refactor `structure.test.js` to dynamically
  read from a single source of truth configurations or dynamically validate all
  files discovered in the directory against expected schemas, rather than
  maintaining a hardcoded inclusion list.
- **Agent Prompt:**
  `Refactor the 'Core .agents/ files' suite in 'tests/structure.test.js' to minimize hardcoded persona file paths and instead validate the structural integrity of all discovered persona markdown files.`
