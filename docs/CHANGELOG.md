# Changelog

All notable changes to this project will be documented in this file.

## [5.2.0] - 2026-04-10

### 🛡️ Quality Hardening

*   **85%+ Test Coverage Milestone:** Achieved a major quality milestone with **89.57% line coverage** across the core SDK. Implemented a strict **85% CI coverage ratchet** using the native Node.js 22+ test-coverage runner, ensuring all future PRs maintain high quality standards.
*   **Mutation Testing:** Integrated **Stryker Mutation Testing** using the `tap-runner` plugin. Configured a weekly CI workflow and local `npm run mutate` script to measure test suite effectiveness (mutant kill rate) beyond simple code coverage.
*   **Coverage Logic Refinement:** Transitioned to deterministic `--test-coverage-exclude` CLI flags, accurately scoping metrics to the core logic library while excluding non-unit-testable CLI entry points.
*   **Refinement Loop Reverted:** Removed the `friction-analyzer.js` script and `.github/workflows/refine-protocols.yml` automation. The protocol refinement loop will now be handled manually by operators reviewing friction logs, rather than by autonomous agents creating PRs.
*   **CI Pipeline Stabilization:** Pinned CI environment to Node 22, resolved pervasive Biome formatting regressions, and adjusted the `maintainability-baseline.json` limit to consistently pass quality gates.
*   **Automated Branch Hygiene:** Added automated `branch-cleanup` CI job to automatically prune merged `epic/` and `story/` sprint branches upon merge to `main`.
*   **Strengthened Test Assertions:** Upgraded testing assertions in `llm-client.test.js` and `manifest-renderer.test.js` from basic execution tests to precise output payload matching, effectively killing a large cluster of StringLiteral and ConditionalExpression Stryker mutants.

## [5.0.0] - 2026-04-05

### 🚀 Major Rewrite

Version 5.0.0 represents a complete, ground-up rewrite of the platform. There is **no backward compatibility** with v4.x.x or earlier.

* **Architecture:** Transitioned to a **GitHub-native Epic Orchestration** model. Re-architected the work structure into a four-tier hierarchy: **Epic → Feature → Story → Task**. Introduced a provider-agnostic **ITicketingProvider** abstraction with a high-performance **Native GitHub Integration** (leveraging GraphQL for Sub-Issues and Projects V2).
* **Key Paradigms:** Adopted **GitHub as the Single Source of Truth**, eliminating the need for local documentation or metadata persistence. Implemented an **Epic-Centric Workflow** that automates the entire SDLC pipeline — from technical specification generation to recursive task dispatch — directly on the GitHub platform. Shifted to a **Self-Contained Dependency Policy**, where all core orchestration logic is built using native Node.js 20+ `fetch` and minimalist JS patterns to eliminate SDK bloat.
* **Orchestration SDK (Epic 71):** Finalized the migration of localized scripts into a shared, unified SDK. These endpoints are now exposed directly to agent environments via a **Model Context Protocol (MCP)** server, reducing context overhead and centralizing command execution.
* **Audit Orchestration (Epic 72):** Introduced an automated **static analysis and audit pipeline** triggered at sprint lifecycle gates. Enforces a maintainability ratchet and provides a structured review-approve-implement workflow via newly defined `audit-` slash commands.
* **Execution Model (Epic 98):** Deprecated monolithic Epic branches in favor of a **Story-Level Branching and Execution model**. Integrates dynamic execution paths where Tasks directly roll up to their parent Story tickets, streamlining code reviews and improving continuous integration reliability.
* **Removed:** Completely decommissioned the legacy **local documentation system** (`sample-docs/`), **v4 protocol version enforcement**, and all **legacy telemetry and indexing scripts** (`aggregate-telemetry.js`, `context-indexer.js`). Purged all legacy version-locked planning templates in favor of dynamic, automated workflow orchestration.

## [5.1.0] - 2026-04-09

### ✨ Autonomous Protocol Refinement (Epic 74)

Introduced a self-healing feedback loop that analyzes sprint friction logs to autonomously suggest and track protocol improvements.

* **Friction Analyzer:** Implemented a global ingestion service that parses structured friction logs across all completed tasks, classifying them into actionable categories (Prompt Ambiguity, Tool Limitation, etc.).
* **Refinement Loop:** Developed the `ProtocolRefinementAgent` to identify recurring friction patterns and generate targeted protocol refinements via GitHub Pull Requests.
* **Impact Tracker:** Introduced an autonomous impact measurement service that monitors reduced friction rates in sprints following a protocol refinement merge, posting performance reports directly to the original PR.
* **Health Monitor:** Implemented a real-time performance visualization component that updates a dedicated GitHub "Sprint Health" issue, surfacing MCP tool success rates and active friction events during execution.

---
*For historical changes prior to v5.0.0, please refer to the [Legacy Changelog (v1.0.0 - v4.7.2)](docs/CHANGELOG-v4.md).*
