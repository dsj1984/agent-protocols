# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2026-04-02

### Added

- **Exploratory Testing Integration**:
  - Enhanced the `/sprint-testing` workflow with a mandatory **Exploratory
    Testing** step (Step 5) to identify edge cases and regressions outside the
    formal test plan.
  - Mandated a remediation loop where agents must address and verify any issues
    found during exploratory testing before finalizing the task.
  - Introduced the `exploratoryTestCommand` configuration property in
    `config.json` (default: `pnpm test:exploratory`) to ensure the testing suite
    is fully configurable.

## [3.1.3] - 2026-04-02

### Fixed

- **Decoupled Playbook Prompts**: Fixed a regression where consolidated
  phase-based Chat Sessions (e.g., "Merge & Verify") were erroneously rendering
  multiple distinct tasks inside a single `#### Agent Prompt` block.
- Refactored `Renderer.js` to iterate over session tasks and generate distinct
  LLM instruction blocks (`#### Agent Prompt: [Title]`) for each task within a
  consolidated session, ensuring clear, distinct execution bounds.

## [3.1.2] - 2026-04-02

### Fixed

- **ESM Notification Script**: Converted `.agents/scripts/notify.js` to a native
  ES module to resolve `ReferenceError: require is not defined`.
- **Structured Friction Logging**:
  - Replaced brittle shell-based `echo` appending with a robust Node.js utility:
    `.agents/scripts/log-friction.js`.
  - This ensures valid JSONL formatting and eliminates stray characters or
    newlines that caused JSON parsing failures in previous versions.
  - Updated `sprint-setup`, `sprint-finalize-task`, `sprint-integration`, and
    `sprint-close-out` workflows to use the new logging script.

## [3.1.1] - 2026-04-02

### Added

- **Decoupled Task State Management**:
  - Introduced `.agents/scripts/update-task-state.js` utility for standardized
    JSON-based task state tracking.
  - Refactored the `AGENT EXECUTION PROTOCOL` to include a mandatory **Mark
    Executing** step using the new utility.
  - Formally aligned the playbook with the **v2.18.3+ simplified protocol**,
    removing all instructions for manual checkbox editing (`- [ ]` -> `- [/]`).

- **Config-Driven Playbook Generation**:
  - Refactored `generate-playbook.js` and `Renderer.js` to eliminate hardcoded
    `docs/sprints` paths and `3`-digit padding.
  - The generation pipeline now dynamically respects `sprintDocsRoot` and
    `sprintNumberPadding` defined in `config.json`.

- **Intelligent Model Fallbacks**:
  - Restored the dual-model enforcement protocol in `generate-playbook.js`.
  - Every task now guarantees both a **First Choice** and **Second Choice**
    model.
  - Implemented configurable fallbacks (Planning -> Pro Low, Fast -> Flash)
    defined in `.agents/config/config.json`.

- **Enhanced Task Branching Logic**:
  - Updated `Renderer.js` to inject explicit `git checkout -b` commands for
    every task directly into the agent instructions.
  - Standardized the feature branch naming convention:
    `task/sprint-[NUM]/[TASK_ID]`.

- **Conditional Pre-flight Verification**:
  - Refactored the `AGENT EXECUTION PROTOCOL` to conditionally omit the
    pre-flight dependency check for tasks with zero dependencies.
  - This streamlines execution for independent tasks while maintaining strict
    verification for chained work.

### Changed

- **Human-Centric Model Recommendations**:
  - Refactored the playbook layout to move `Mode` and `Model` identifiers above
    the `Agent Prompt` block.
  - This ensures recommendations are clearly visible for human consumption and
    manual model selection while keeping the automated prompt block focused on
    execution logic.

### Fixed

- **Task ID Resolution Bug**: Fixed a logic error where the pre-flight
  verification script was being generated with incorrect internal manifest IDs
  (e.g., `043.1.a`) instead of the required numeric identifiers (e.g.,
  `043.1.1`).

## [3.1.0] - 2026-04-02

### Added

- **Optional Style-Guide Support**:
  - Introduced support for a `docs/style-guide.md` file to house
    project-specific writing standards, aesthetic constraints, and UI
    copywriting rules.
  - Updated all core personas (`technical-writer`, `ux-designer`, `product`,
    `engineer-web`, `engineer-mobile`) and the `Markdown Mastery` skill to
    conditionally defer to the style guide if present.
  - Added a high-fidelity "Golden Sample" style guide to
    `.agents/sample-docs/style-guide.md` based on the KinetixID design system.
  - MARKED `docs/style-guide.md` as an optional artifact in the SDLC
    documentation and global instructions.

- **Context Caching Prompt Architecture**:
  - Restructured the `playbook.md` generation logic in `Renderer.js` to strictly
    separate static framework rules from volatile task state.
  - Implemented a two-layer prompt architecture with an immutable
    `=== SYSTEM PROTOCOL & CAPABILITIES ===` header at the start of every agent
    prompt block.
  - This optimization maximizes character-for-character prefix matching,
    enabling 100% native LLM API token caching for protocol-level instructions.
  - Promoted task-specific "Pre-flight Task Validation" to a clearly labeled
    volatile section to maintain both discoverability and cache consistency.

- **Automated Context Pruning ("Gardener")**:
  - Implemented `run-context-pruning.md` workflow for systematic archiving of
    stale architectural decisions and patterns.
  - Updated `context-indexer.js` to explicitly ignore the `docs/archive/`
    directory, preventing stale context from polluting Local RAG.
  - Integrated the Gardener workflow into `sprint-retro.md` as a mandatory
    close-out step.
  - Updated SDLC and README to reflect the new documentation lifecycle and the
    `docs/archive/` directory standard.

- **Zero-Touch Remediation Loop**:
  - Automates the transition from a failed `/sprint-integration` candidate check
    into an immediate `/sprint-hotfix` loop.
  - Introduced `maxIntegrationRetries` to `.agents/config/config.json`
    (default: 2) to control the automated remediation depth.
  - Integrated diagnostic capturing via `diagnose-friction.js` directly into the
    integration verification step.
  - Mandated recursive integration attempts within `sprint-hotfix.md` until the
    retry threshold is reached, minimizing human-in-the-loop dependencies for
    integration failures.

- **Dynamic Golden-Path Harvesting (Agentic RLHF)**:
  - Created `harvest-golden-path.js` script to automatically extract
    Zero-Friction implementation diffs and instruction pairings into a local
    `.agents/golden-examples/` repository.
  - Updated `diagnose-friction.js` to support `--task` tagging, enabling precise
    association of friction points with specific task IDs.
  - Integrated harvesting into the `/sprint-finalize-task` workflow as a
    standard completion step.
  - Modified `Renderer.js` to dynamically inject harvested golden paths as
    few-shot prompts into new playbooks, facilitating autonomous project
    alignment and reinforcement learning.

- **Semantic Risk & Blast-Radius Gates**:
  - Upgraded static keyword `riskGates.words` in `config.json` to a semantic
    `riskGates.heuristics` framework.
  - Updated `sprint-generate-tech-spec.md` to instruct the AI Architect to act
    as a semantic classifier for blast-radius analysis.
  - Updated `sprint-generate-playbook.md` to enforce Human-In-The-Loop (HITL)
    approval for tasks flagged by semantic security assessments.
  - Refined documentation (SDLC, README) to reflect the transition from brittle
    deterministic checks to contextual AI-driven risk mitigation.

- **Adversarial Red-Teaming (Tribunal)**:
  - Introduced the on-demand `/run-red-team` workflow for cross-examining and
    hardening code via dynamic fuzzing and mutation tests.
  - Assigned the `security-engineer` persona to provide adversarial scrutiny on
    branches or directories before functional QA.

## [3.0.0] - 2026-04-02

### Added

- **Local RAG & Semantic Context Retrieval**:
  - Implemented `.agents/scripts/context-indexer.js`, a zero-dependency TF-IDF
    engine for local documentation indexing and semantic search.
  - Updated `.agents/workflows/sprint-gather-context.md` to prioritize semantic
    retrieval over monolithic file reading.
  - Refined `instructions.md` to mandate Local RAG for efficient context
    gathering, mitigating context window bloat.
  - Added repository-wide Guiding Principles to `docs/roadmap.md` focusing on
    flexibility and self-contained architecture.

- **FinOps & Economic Guardrails**:
  - Added `maxTokenBudget` and `budgetWarningThreshold` properties to
    `.agents/config/config.json`.
  - Updated `instructions.md` (Section 2) with mandatory token tracking,
    soft-warning (80%), and hard-stop (100%) protocols to prevent budget
    overruns.
  - Enriched `models.json` with `finops_recommendations` to guide agents toward
    cost-effective API tiering.

- **HITL Risk Gates for Safe Execution**:
  - Added `riskGates` configuration to `.agents/config/config.json` with default
    trigger keywords (`DROP`, `DELETE`, `IAM`, etc.).
  - Updated the Task Manifest schema with a `requires_approval` property.
  - Automated Tech Spec phase to flag destructive workflows natively in the
    playbook, halting the execution sequence until explicitly human-approved.
  - Solidified the safety guidelines in the core `instructions.md`.

- **Telemetry-Driven Retro Recommendations (Self-Healing)**:
  - Enhanced `.agents/workflows/sprint-retro.md` and the `architect` persona to
    mandate macro-analysis of `agent-friction-log.json`.
  - Modified `.agents/templates/sprint-retro-template.md` to format Protocol
    Optimization Recommendations as "agent-ready" markdown snippets, creating an
    evolving library immune loop.

- **Macroscopic Telemetry Observer**:
  - Created `.agents/scripts/aggregate-telemetry.js`, a script that parses
    structured telemetry across an entire sprint range.
  - Auto-generates `docs/telemetry/observer-report.md` tracking long-term
    efficiency bottlenecks and framework tool failures.

- **Unified Quality Auditing**:
  - Renamed `audit-qa` workflow to `audit-quality` to better reflect its
    comprehensive scope (Infrastructure, Coverage, Fragility, and Strategy).
  - Updated all internal documentation, personas, and file links to the new
    `/audit-quality` standard.

## [2.24.0] - 2026-04-02

### Added

- **Enhanced Diagnostic Tools & Passive Telemetry**:
  - Implemented `.agents/scripts/diagnose-friction.js`, replacing the "honor
    system" for logging tool failures. This script wraps failing commands, logs
    execution details (stdout/stderr) natively to `agent-friction-log.json`, and
    outputs structured remediation steps back to the agent to prevent thrashing.
  - Updated `instructions.md` to formally mandate the use of the new diagnostic
    interceptor for unrecoverable errors.
  - Refined `SDLC.md` to articulate the expanded Observability loop using this
    automated telemetry approach.
  - Shifted the corresponding roadmap item from **Planned** to **Completed**.

## [2.23.0] - 2026-04-02

### Added

- **Persona Specialization & Framework Handshake**:
  - Introduced the mandatory **Framework Handshake** protocol in
    `engineer-web.md`, forcing agents to read framework-specific skills before
    execution.
  - **Astro 5 (Iron) Modernization**: Updated `astro/SKILL.md` to enforce Server
    Islands (`server:defer`), Astro Actions for data mutations, and the new
    Content Layer API.
  - **Tailwind CSS v4 (CSS-First)**: Hardened the `tailwind-v4/SKILL.md` and
    `ux-designer.md` persona to enforce a strict CSS-only configuration using
    the `@theme` directive, banning legacy `tailwind.config.ts/js` files and
    arbitrary utility values.
  - **Task State Tracking**: Created localized task and walkthrough artifacts
    for traceable implementation.

## [2.22.0] - 2026-04-02

### Added

- **Hybrid Integration & Blast-Radius Containment (Option 3)**:
  - Introduced the "Integration Candidate" protocol to ensure the shared
    `sprint-[NUM]` branch never enters a broken state.
  - **Ephemeral Verification**: Merges are now performed on temporary
    `integration-candidate-[TASK_ID]` branches first.
  - **Fail-Safe Rollback**: If tests fail on the candidate branch, the branch is
    purged, and the failure is logged to `agent-friction-log.json` without
    polluting the sprint base.
  - **`sprint-hotfix` Workflow**: Created a dedicated workflow for rapid
    remediation of broken features directly on their original branch, unblocking
    other parallel integrations.
  - **SDLC Documentation**: Updated `SDLC.md` and the `roadmap.md` to reflect
    the completion and adoption of the hybrid containment model.

## [2.21.0] - 2026-04-02

### Added

- **Advanced Concurrency & Merge Conflict Protocols**:
  - Introduced a hybrid concurrency model (Option C) to eliminate complex
    structural merge conflicts during execution.
  - **Schema Update**: Added `focusAreas` property to
    `task-manifest.schema.json` to allow static prediction of high-risk file
    overlaps during the planning phase.
  - **Runtime Rebase Wait-Loop**: Refactored the `sprint-finalize-task` workflow
    to force agents to run `git pull --rebase origin sprint-[NUM]` and manually
    resolve structural conflicts against the remote base branch _before_ running
    validation tests and pushing their feature branch.
  - **SDLC Documentation**: Updated `SDLC.md` to formally outline the new
    Advanced Concurrency Protocols.

## [2.20.0] - 2026-04-02

### Added

- **"Shift-Left" Agentic Testing Protocol**:
  - Introduced a mandatory validation step where agents must run isolated tests
    on their feature branch before finalizing a task.
  - Implemented **Option B (Agentic Test Receipt)**: Agents execute the
    configured `testCommand` and generate a `[TASK_ID]-test-receipt.json` in the
    decoupled state folder as evidence of a green state.
  - Updated the `sprint-integration` workflow to act as a strict gatekeeper,
    blocking the merge of any branch that lacks a valid "passed" test receipt.
  - This protocol eliminates the "happy path" anti-pattern by ensuring only
    verified code enters the shared sprint branch, matching CI-like standards in
    a local-first environment.

### Changed

- **Modernized Validation Commands**:
  - Updated `validationCommand` and `testCommand` in
    `.agents/config/config.json` to leverage **pnpm turbo** for faster, cached
    execution.
  - Default `validationCommand`: `pnpm turbo run lint`.
  - Default `testCommand`: `pnpm turbo run test`.
- **Workflow Hardening**:
  - Updated `sprint-finalize-task` to enforce the new testing requirement and
    receipt generation.
  - Updated `sprint-integration` to verify receipt existence and status before
    commencing merges.
- **SDLC Documentation**:
  - Formally documented the Shift-Left testing requirements and the
    "cryptographic-like" evidence of the test receipt in `SDLC.md`.

## [2.19.0] - 2026-04-02

### Changed

- **Unified Webhook Failure Logging**:
  - Deprecated the legacy `WEBHOOK_FAILURE.md` file requirement.
  - Updated `sprint-finalize-task`, `sprint-integration`, and `sprint-close-out`
    workflows to mandate logging notification failures directly to the
    structured `agent-friction-log.json` file (JSONL format).
  - This change aligns webhook telemetry with the project's broader
    "agent-friction" observability protocol, improving error traceability and
    reducing per-sprint documentation clutter.

## [2.18.3] - 2026-04-02

### Added

- **Configurable Task State Root**:
  - Introduced `taskStateRoot` in `.agents/config/config.json` to allow custom
    paths for decoupled task state files.
  - Set the default path to `temp/task-state/` (in the project root) to keep the
    repository clean and avoid polluting Git history with transient state.
  - Updated `instructions.md`, `SDLC.md`, and the `sprint-finalize-task`
    workflow to dynamically resolve the task state path.
  - Implemented conditional Git tracking: state files in `/temp/` are
    local-only, while those in project directories (e.g., `docs/sprints/`)
    continue to be committed for cross-agent synchronization.

### Changed

- **Simplified Playbook State Tracking**:
  - Removed intermediate `[- [~]]` (Executing) and `[- [/]]` (Committed)
    statuses from the sprint playbook entirely.
  - The playbook now only tracks `[- [ ]]` (Not Started) and `[- [x]]`
    (Complete).
  - All intermediate states are now exclusively managed by decoupled JSON state
    files located in `taskStateRoot`.
  - Refactored `verify-prereqs.js` to parse both the playbook `[x]` markers and
    the decoupled `committed` state files when evaluating dependencies, ensuring
    concurrent feature branches don't prematurely block execution.
  - Simplified the visually generated Mermaid DAG, condensing it to only
    `⬜ Not Started` and `🟩 Complete` nodes.

## [2.18.2] - 2026-04-02

### Fixed

- **Parallel Task Generation**:
  - Overhauled `groupRegularTasks` in `generate-playbook.js` to correctly emit
    independent, parallelizable tasks as distinct Chat Sessions.
  - Removed logic that inadvertently grouped same-layer tasks into single
    sequential windows based on shared scope (e.g., `root`), which was falsely
    representing parallel work as sequential in the Mermaid graph and execution
    prompts.

## [2.18.1] - 2026-04-02

### Added

- **Automated Manifest Enrichment**:
  - Introduced `enrichManifest` function to `generate-playbook.js` to
    automatically inject required personas and skills for bookend tasks.
  - Reduces boilerplate in `task-manifest.json` and prevents validation errors
    for missing mandatory fields in Integration, QA, Code Review, Retro, and
    Close Sprint tasks.

## [2.18.0] - 2026-04-02

### Changed

- **Extracted Base Branch Configuration**:
  - Centralized the primary development branch (default: `main`) into
    `.agents/config/config.json`.
  - Extracted the sprint documentation root (`sprintDocsRoot`: `docs/sprints`),
    sprint number padding (`sprintNumberPadding`: 3), validation command
    (`validationCommand`: `npm run lint`), and notification webhook
    (`webhookUrl`) into the configuration.
  - Updated all core workflows (sprint planning, setup, execution, and closure)
    to dynamically resolve paths using these configuration variables.
- **Improved Branch Naming Consistency**:
  - Updated `sprint-integration` and `sprint-close-out` workflows to expect and
    manage branches with the `task/` prefix (e.g.,
    `task/sprint-[SPRINT_NUMBER]/[TASK_ID]`), aligning with the established
    conventions in `instructions.md`.
- **Introduced Cross-Platform Execution Scripts**:
  - Created `.agents/scripts/notify.js` to handle webhook JSON payloads
    programmatically, replacing OS-dependent `curl` commands.
  - Created `.agents/scripts/detect-merges.js` to ensure reliable conflict
    marker detection across all files, replacing `git grep`.
  - Updated `sprint-integration`, `sprint-close-out`, and `sprint-finalize-task`
    to execute these local Node.js scripts.
  - Created `.agents/scripts/verify-prereqs.js` to deterministically evaluate
    task dependencies and chat predecessors by parsing the `playbook.md`.
- **Decoupled Task State Management**:
  - Refactored `sprint-finalize-task.md` to exclusively use
    `task-state/[TASK_ID].json` files for status tracking, removing manual
    `playbook.md` editing to eliminate race conditions during concurrent
    execution.
- **Clarified Testing Responsibilities**:
  - Updated `sprint-testing.md` and `audit-quality.md` to explicitly demarcate
    that Software Engineers (SWEs) are responsible for unit and integration
    testing during development, while the QA persona focuses exclusively on E2E
    automation and documentation during integration.
- **Hardened Final Sprint Integration**:
  - Added a mandatory **Final Integration Audit** (Step 3) to the
    `sprint-close-out` workflow. This step enforces a check for unmerged task
    branches and prevents sprint closure if remediation work is detected.
  - Updated the `sprint-integration` workflow to explicitly recommend rerunning
    the integration process whenever new feature or remediation branches are
    created after the initial integration.

## [2.17.3] - 2026-04-02

### Added

- **Configurable Friction Thresholds**:
  - Extracted hardcoded agent-friction and anti-thrashing thresholds into
    `.agents/config/config.json` under `frictionThresholds`.
  - Thresholds for consecutive errors, stagnation steps, and repetitive command
    detection are now fully configurable.
  - Updated `instructions.md`, `SDLC.md`, and project READMEs to reference the
    dynamic configuration values.

## [2.17.2] - 2026-04-01

### Changed

- **Standardized QA Workflow Naming**:
  - Renamed the `plan-qa-testing` workflow to `sprint-testing` across all
    protocols, documentation, and tooling.
  - Aligned the QA phase with the `sprint-[action]` naming convention used by
    other core workflows.
  - Updated the `project-manager` and `qa-engineer` personas, SDLC
    documentation, and the playbook generation script to utilize the new
    workflow command.

## [2.17.1] - 2026-04-01

### Added

- **Workspace & File Hygiene Protocol**:
  - Introduced a mandatory global instruction in `instructions.md` to store all
    temporary files, scratch scripts, and intermediate outputs in a root
    `/temp/` directory.
  - Automatically excluded the `/temp/` directory from Git to prevent repository
    pollution and history bloat.

## [2.17.0] - 2026-04-01

### Added

- **Architecture Decisions & Code Patterns Context**:
  - Elevated `docs/decisions.md` (ADRs) and `docs/patterns.md` to core context
    requirements in `instructions.md`.
  - Added sample references for these files in `.agents/sample-docs/`.
  - Updated `sprint-gather-context` to explicitly read these artifacts before
    sprint execution.
  - Updated `sprint-code-review` to verify new code against established
    patterns.
  - Updated `sprint-retro` to close the feedback loop by formally documenting
    newly emerged rulings and architectural decisions into these files.

## [2.16.0] - 2026-04-01

### Added

- **Roadmap Review Workflow**:
  - Introduced the `/sprint-roadmap-review` workflow (formerly `scope-roadmap`)
    to assist Product Managers with sprint grooming and feature decomposition in
    `docs/roadmap.md`.
  - Updated the `product` persona and SDLC documentation to integrate the new
    roadmap scoping command into Phase 1 of the development lifecycle.
  - Renamed all audit-related workflows from `[feature]-audit.md` to
    `audit-[feature].md` for better discoverability and sorting.
  - Renamed all sprint-related workflows to follow the `sprint-[action]` pattern
    (e.g., `close-sprint.md` → `sprint-close-out.md`, `generate-prd.md` →
    `sprint-generate-prd.md`).
  - Updated internal artifact filenames, headers, and slash commands across the
    entire protocol to ensure consistency.

## [2.15.0] - 2026-04-01

### Added

- **Configurable Efficiency Guardrails**:
  - Introduced **Instruction Density** as the core complexity metric, replacing
    file counts. Configurable via `maxInstructionSteps` in
    `.agents/config/config.json` (default: 5 logical steps).
  - Updated the **Anti-Thrashing Protocol** with clear error and research
    thresholds to prevent agent stagnation.
  - Added a dedicated **🛡️ Efficiency & Guardrails** section to all project
    READMEs and SDLC documentation to improve protocol transparency.

### Changed

- **Version Bump**: Incremented project version to `2.15.0`.

## [2.14.0] - 2026-04-01

### Added

- **Repetitive Task Capture & Automation Recommendations**:
  - Introduced the `AutomationCandidate` telemetry type in
    `agent-friction-log.json` to identify boilerplate and repetitive agent
    tasks.
  - Updated the **Sprint Retrospective** template and workflow to systematically
    analyze execution logs for automation opportunities.
  - Provided a dedicated **Protocol Automation & Optimization Recommendations**
    section in the retro report to surface protocol improvements without
    polluting the project roadmap.

### Changed

- **Version Bump**: Incremented project version to `2.14.0`.

## [2.13.0] - 2026-04-01

### Added

- **Master Planning Alignment Audit**:
  - Introduced a mandatory **Alignment & Consistency Audit** (Step 4) in the
    `plan-sprint` orchestrator.
  - The `architect` persona now performs cross-artifact reviews of the PRD, Tech
    Spec, and Playbook to ensure logical unity, strict 3-digit padding
    adherence, and mandatory bookend protocol compliance.

### Changed

- **Hardened Git & Sprint Protocols**:
  - **Strict Branch Naming**: Mandated the `task/sprint-[XXX]/[ID]` branch
    naming convention in global `instructions.md` and `finalize-sprint-task` to
    eliminate graph visual clutter.
  - **Standardized Status Commits**: Enforced the
    `chore(sprint): update task [ID] status to [STATUS]` commit template for all
    lifecycle events.
  - **Decoupled State Tracking**: Implemented a "decoupled" status tracking
    mechanism. Agents now write lifecycle updates to individual
    `task-state/[ID].json` files to prevent merge conflicts and history
    pollution on the primary sprint branch.
- **Version Bump**: Incremented project version to `2.13.0`.

## [2.12.0] - 2026-03-31

### Added

- **Agent Friction Telemetry**:
  - Introduced a mandatory **Agent Friction Logging** protocol to capture
    consecutive tool validation errors, command execution failures, and prompt
    ambiguities in a per-sprint `agent-friction-log.json` file.
  - Updated the `sprint-setup` workflow to automatically initialize an empty
    JSONL telemetry file during sprint directory creation.
  - Structured logs (Timestamp, Tool, Error, Context) enable systemic auditing
    of agentic "struggle points" to inform protocol and tool refinements.

### Changed

- **Version Bump**: Incremented project version to `2.12.0`.

## [2.11.0] - 2026-03-31

### Changed

- **Playbook Generator Optimizations**:
  - **Transitive Dependency Reduction**: Overhauled `generate-playbook.js` with
    a Floyd-Warshall transitive reduction algorithm. The Mermaid graph and
    task-level `Prerequisite Check` blocks now automatically strip redundant
    edges, significantly reducing visual clutter and agent prompt bloat.
  - **Hardened Standard Sprint IDs**: Enforced strict **3-digit zero-padding**
    (e.g., `040.1.1`) for all task identifiers to ensure deterministic
    alphanumeric sorting across the sprint lifecycle.
  - **Unique Model Fallbacks**: Implemented a mandatory uniqueness constraint
    for task models. If a manifest provides a single model, the generator now
    automatically assigns a diverse second-choice model from a different family
    (e.g., Claude -> Gemini) to prevent rate-limit deadlocks.
  - **Domain Emoji Accuracy**: Fixed session-to-icon mapping logic to correctly
    align `@repo/api`, `@repo/mobile`, and `@repo/web` workspaces with their
    respective legend tokens.
- **Version Bump**: Incremented project version to `2.11.0`.

## [2.10.0] - 2026-03-31

### Added

- **`sprint-setup` Workflow**: Introduced a new automated workflow to handle
  sprint branch creation and directory initialization, resolving race conditions
  during sprint kickoff.
- **Master Planning Orchestration**: Integrated `sprint-setup` as the first
  mandatory step (Step 0) in the `plan-sprint` orchestrator.

### Changed

- **Standardized Sprint Numbering**:
  - Overhauled `generate-playbook.js` to enforce **3-digit padding** (e.g.,
    `sprint-040`) for all directory paths, task IDs, and branch checkouts.
  - Implemented **Robust Directory Resolution** in the generation script to
    gracefully handle both padded and unpadded directory inputs with automatic
    fallback.
- **Version Bump**: Incremented project version to `2.10.0`.

## [2.9.4] - 2026-03-31

### Changed

- **Automated Protocol Maintenance**:
  - **Submodule Refresh**: Integrated a mandatory `.agents` submodule refresh
    step into the `close-sprint` workflow. The terminal sprint agent will now
    automatically pull the latest protocols from the pinned `dist` branch,
    ensuring consistency and cleaning up phantom Git changes.
  - **Playbook Finalization**: Added a terminal step to `close-sprint` to ensure
    the closure task itself is marked as Complete in the playbook and Mermaid
    diagram, providing a 100% finished artifact.
- **Version Bump**: Incremented project version to `2.9.4`.

## [2.9.3] - 2026-03-31

### Changed

- **Hardened Git & Branch Protocols**:
  - **Naming Enforcement**: Standardized the `sprint-[NUM]/[TASK_ID]` branch
    naming convention in `finalize-sprint-task` with explicit instructions to
    use forward slashes, preventing glob discovery failures.
  - **Self-Cleaning Integration**: Added a mandatory "Self-Cleanup" step to the
    `sprint-integration` workflow to ensure the integration task's own feature
    branch is purged after completion.
  - **End-to-End Orchestration**: Linked the `sprint-testing`,
    `sprint-code-review`, and `sprint-retro` workflows to `finalize-sprint-task`
    to ensure bookend tasks correctly push branches and track status.
  - **Catch-All Branch Audit**: Updated `close-sprint` to perform an aggressive
    remote branch scan that catches and deletes branches using non-standard
    naming conventions (e.g., dash-separated instead of slash-separated).
- **Version Bump**: Incremented project version to `2.9.3`.

## [2.9.2] - 2026-03-31

### Changed

- **Hardened Webhook Notifications**:
  - **Cross-Platform Compatibility**: Standardized the `curl` payload syntax in
    `finalize-sprint-task`, `sprint-integration`, and `close-sprint` workflows
    to ensure reliable execution across Bash and PowerShell/CMD.
  - **Increased Visibility**: Injected mandatory notification steps into the
    `sprint-integration` and `close-sprint` workflows to track major sprint
    milestones.
  - **Failure Auditing**: Requirement for agents to log `WEBHOOK_FAILURE.md` in
    the event of network/configuration errors, preventing silent notification
    drops.
- **Version Bump**: Incremented project version to `2.9.2`.

## [2.9.1] - 2026-03-31

### Changed

- **Harden Playbook Generation Logic**:
  - **Categorization Improvements**: Patched `selectIcon` to explicitly support
    `isCloseSprint` (Ops icon) and prioritized DevOps/Infra keyword matching to
    prevent monorepo "Web" mention false-positives.
  - **Regex Security**: Implemented word-boundary (`\b`) matching for all domain
    keywords to prevent accidental substring hits (e.g., "props" triggering
    "ops").
  - **Dual Model Enforcement**: Every task now guarantees both a **First
    Choice** and **Second Choice** model, with intelligent, mode-aware fallbacks
    (Planning -> Pro Low, Fast -> Flash) if the manifest provides only one.
  - **Visual Refinement**: Updated task headers to use a pipe (`|`) delimiter
    for cleaner separation between Mode, First Choice, and Second Choice models.
  - **Sequential Dependency Logic**: Fixed a bug where tasks in a sequential
    group (e.g., `39.1.2`) were missing their predecessor (`39.1.1`) as a
    mandatory prerequisite in the `AGENT EXECUTION PROTOCOL`.
- **Version Bump**: Incremented project version to `2.9.1`.

## [2.9.0] - 2026-03-31

### Added

- **`devops/git-flow-specialist` Skill**: A comprehensive repository health
  skill that centralizes branch safety, base alignment, and conventional commit
  rules. Includes **Emergency Recovery Protocols** for accidental commits to
  main, unresolved merge markers, and diverged branches.
- **`/close-sprint` Workflow**: A new terminal bookend step that promotes the
  sprint branch to `main`, enforces a completeness gate (all tasks must be
  `[x]`), cleans up sprint branches, and runs a final conflict marker scan.

### Changed

- **Hardened Sprint Generation Pipeline**:
  - Updated `generate-playbook.js` to inject a mandatory **Environment Reset**
    step at the start of every task, forcing base branch alignment (Fix 1).
  - Injected `devops/git-flow-specialist` as a mandatory requirement for all
    Integration and Code Review tasks (Fix 4).
  - Added `isCloseSprint` bookend stage to the generation script and task
    manifest schema, ensuring the close-sprint workflow is automatically wired
    as the final step in every sprint playbook.
- **Workflow Guardrails**:
  - `finalize-sprint-task`: Added a **Branch Guard** to prevent accidental
    pushes to `main` (Fix 2) and explicit base branching (Fix 5).
  - `sprint-integration`: Added a mandatory **Conflict Marker Scan** with
    zero-tolerance for residual `<<<<<<<` markers (Fix 3).
  - `verify-sprint-prerequisites`: Added **Branch Validation** to ensure agents
    are on the correct sprint base (Fix 6).
  - **Pre-Commit Hardening**: Integrated mandatory `npm test` execution into the
    Husky pre-commit hook to match GitHub CI standards and prevent regressions.
- **Skill Retirement**: Retired and removed the
  `architecture/conventional-commits-enforcer` skill (consolidated into
  `git-flow-specialist`).
- **Version Bump**: Incremented project version to `2.9.0`.

## [2.8.1] - 2026-03-31

## [2.8.0] - 2026-03-30

### Added

- **Dynamic Mermaid Legend**: The sprint playbook execution flow diagram now
  includes a categorical legend for chat session icons (🗄️ DB, 🌐 Web, 📱
  Mobile, 🧪 Test, 📝 Docs, 🛡️ Ops, ⚙️ Gen).
- **Mandatory Bookend Validation**: Implemented strict persona and skill
  assertions in `generate-playbook.js` for Integration, QA, Code Review, and
  Retro tasks.

### Changed

- **Redefined Chat Icons**: Simplified the chat session icon set to 6 meaningful
  categories with automatic keyword-based selection logic.
- **Improved Dependency Logic**:
  - Reduced redundant prerequisites for sequential tasks within the same Chat
    Session (Linearized `1 -> 2 -> 3` logic).
  - Automated bookend pipeline wiring (Integration → QA → Code Review → Retro)
    in the Mermaid DAG.
- **Hardened Execution Protocol**: Added node-specific Mermaid class
  instructions (e.g., `set the Mermaid class for node C1`) with idempotency
  hints `(if not already)` to prevent state-tracking ambiguity.
- **Version Bump**: Incremented project version to `2.8.0`.

## [2.7.0] - 2026-03-30

### Added

- **Sprint Retro Action Item Capture**:
  - Mandated the capture of action items identified in retrospectives into the
    `roadmap.md` file to ensure they are tracked.
  - Updated the `sprint-retro` workflow step 4 to include sub-tasks for marking
    completed items and capturing new ones.

### Changed

- **Persona Alignment**: Updated the **Product Manager** persona to explicitly
  own the roadmapping of retro action items.
- **Documentation**: Synchronized `SDLC.md` and `README.md` to reflect the full
  end-to-end retrospective process.
- **Version Bump**: Incremented project version to `2.7.0`.

## [2.6.0] - 2026-03-30

### Added

- **Per-Sprint Branch Protocol**:
  - Implemented a standardized branching model where all sprint tasks occur on
    `sprint-N/chat-session-X` branches.
  - Updated `verify-sprint-prerequisites` and `sprint-integration` to support
    the new branch hierarchy.

### Changed

- **SDLC Hardening**: Refined integration and finalization workflows to enforce
  branch naming consistency and dependency across branches.
- **Version Bump**: Incremented project version to `2.6.0`.

## [2.5.1] - 2026-03-30

### Added

- **Shell & Terminal Protocol (Windows Compatibility)**:
  - Introduced a mandatory protocol for Windows (PowerShell) environments to use
    `;` as a statement separator instead of `&&`.
  - Updated `instructions.md` with Section 2: "Shell & Terminal Protocol
    (Windows Compatibility)".
  - Provided clear examples for command chaining (e.g.,
    `git add . ; git commit -m "..."`).

### Changed

- **Version Bump**: Incremented project version to `2.5.1` across
  `package.json`, `.agents/VERSION`, and documentation.

## [2.5.0] - 2026-03-30

### Added

- **4-State Playbook Status Model**:
  - Expanded sprint playbook tracking from 3 states to 4 states to capture the
    full agent task lifecycle:
    - ⬜ **Not Started** (`- [ ]`, `not_started`) — Task hasn't begun.
    - 🟨 **Executing** (`- [~]`, `executing`) — Agent is actively working.
    - 🟦 **Committed** (`- [/]`, `committed`) — Feature branch pushed, awaiting
      integration.
    - 🟩 **Complete** (`- [x]`, `complete`) — Merged/integrated and verified.
  - Introduced amber Mermaid `classDef executing` styling for the new state.
  - Added **Mark Executing** as the first step in every Agent Execution Protocol
    block, injected by `generate-playbook.js`.

### Changed

- **Breaking: Status Contract Migration**:
  - Renamed Mermaid class `in_progress` to `committed` across all playbook
    artifacts.
  - The `- [/]` marker now means "Committed" (branch pushed) instead of the
    previous "In Progress" interpretation.
  - Updated Mermaid legend to display all 4 states.
- **Workflow Updates**:
  - `finalize-sprint-task`: Now transitions Executing → Committed (4-State
    Track). Added a state progression reference table.
  - `sprint-integration`: Updated to transition Committed → Complete, replacing
    the old `in_progress` → `complete` references.
  - `verify-sprint-prerequisites`: Added explicit state reference table
    clarifying that only `[x]` (Complete) satisfies dependencies.
- **Sample Playbook**:
  - Updated golden sample to showcase all 4 states (C1=complete, C2=committed,
    C3=executing, C4-C7=not_started).

## [2.4.0] - 2026-03-30

### Added

- **Golden SDLC Samples**:
  - Introduced a comprehensive `.agents/sample-docs/` directory containing
    benchmark PRDs, Technical Specs, Roadmaps, and Architecture documents.
  - Included a complete "locked-in" Sprint 001 sample with a functional task
    manifest and playbook.

### Changed

- **SDLC Visualization**:
  - Overhauled the core SDLC Mermaid diagram in `SDLC.md` to a Left-to-Right
    (`LR`) layout to better represent chronological phase transitions.
- **Sprint Test Plan Relocation**:
  - Migrated sprint-specific test plans from
    `docs/test-plans/sprint-test-plans/` to a more contextual
    `docs/sprints/sprint-[##]/test-plan.md` location.
  - Updated the `qa-engineer` persona and `sprint-testing`/`qa-audit` workflows
    to adhere to the new directory structure.
- **Documentation Hardening**:
  - Standardized all internal documentation with relative links, replacing
    absolute file system paths.
  - Updated `README.md` and `SDLC.md` to provide clearer onboarding guidance
    referencing the new "Golden Samples."

## [2.3.2] - 2026-03-30

### Fixed

- **Mermaid Default Styling**:
  - Switched from `style default` to an explicit `classDef not_started` model
    for initial node coloring. This ensures all nodes default to light gray
    without creating orphaned "default" nodes in the diagram.
- **Mermaid Script Robustness**:
  - Updated `generate-playbook.js` to automatically assign the `not_started`
    class to every node upon creation.

## [2.3.1] - 2026-03-30

### Fixed

- **Webhook Notification Format**:
  - Refined the `finalize-sprint-task` workflow to explicitly require a JSON
    payload with a `message` parameter, ensuring compatibility with Make.com
    webhooks.

### Changed

- **UI Simplification**:
  - Removed redundant "💬" chat emoji from Chat Session headers and Mermaid
    diagram labels for a cleaner, professional look.

## [2.3.0] - 2026-03-30

### Added

- **Feature Branching & 3-State Tracking**:
  - Implemented a zero-conflict Git orchestration model using isolated feature
    branches for concurrent Chat Sessions.
  - Introduced **3-State Playbook Tracking**: Tasks now transition from Pending
    (`- [ ]`) to Pushed/Ready (`- [/]`) and finally to Complete (`- [x]`).
  - Added **Real-time Progress Visualization**: Automated blue (`in_progress`)
    and green (`complete`) highlighting for Mermaid diagram nodes in the
    playbook.
- **Sprint Integration Workflow**:
  - Added a new automated `isIntegration` bookend task that merges feature
    branches and performs bulk playbook state synchronization before QA.

## [2.2.1] - 2026-03-30

### Added

- **Strict Dependency Rules**:
  - Updated JSON Schema and workflow documentation to strictly mandate
    direct-only dependencies, preventing transitive bloat in the playbook.
- **Bookend Optimization**:
  - Added persona and skill guidance specifically for the automated QA, Code
    Review, and Sprint Retrospective bookend sessions.

## [2.2.0] - 2026-03-30

### Added

- **Explicit Dependency Injection**:
  - The playbook generation script now deterministically tracks dependent task
    numbers and injects them precisely into the `AGENT EXECUTION PROTOCOL`.
  - Added a self-referencing `Playbook Path` header to the top of every
    generated playbook for easier agent discovery.
- **Dynamic Prerequisite Logic**:
  - Tasks with no dependencies now automatically omit the "Prerequisite Check"
    step to streamline execution prompts.
- **Expanded Bookend Tracking**:
  - Split the "Code Review & Retro" session into two dedicated Chat Sessions:
    `Code Review` (Sequential) and `Sprint Retrospective` (PM-led, always last).

### Changed

- **Workflow Simplification**:
  - Moved detailed dependency verification logic into the
    `verify-sprint-prerequisites` workflow, reducing prompt bloat in the
    playbook.
  - Added repository `scope` annotations to Sequential sessions (not just
    Concurrent ones) to ensure clear boundary enforcement.
  - Manifest schema now allows omitting `instructions` for bookend tasks (QA,
    Review, Retro) since they use auto-injected workflow commands.
- **Topological Sorting Improvements**:
  - Dependencies are now sorted numerically in task prompts for better
    scannability.

## [2.1.1] - 2026-03-30

### Added

- **Graceful "Technical Chore" Fallbacks**:
  - Updated `prd-template.md` and `technical-spec-template.md` to officially
    support `(N/A - Technical Operations Chore)` or `None required` for purely
    technical/backend sprints. This prevents LLM hallucinations in non-UI tasks.

### Changed

- **Strict Playbook Formatting**:
  - Updated `task-manifest.schema.json` to mandate `\n-` markdown list
    formatting for task instructions.
  - Updated `generate-sprint-playbook` workflow to enforce bulleted instruction
    scoping for better agent readability.
- **Robust Path Handling**:
  - Fixed `generate-playbook.js` to preserve leading zeros in sprint numbers
    (e.g., `037`) when resolving directory paths.

## [2.1.0] - 2026-03-30

### Added

- **Script-Assisted Playbook Generation**:
  - Introduced `.agents/scripts/generate-playbook.js`, a deterministic Node.js
    script to generate sprint playbooks from a structured JSON manifest.
  - Introduced `.agents/schemas/task-manifest.schema.json` to define the
    contract for playbook generation.
  - Updated `generate-sprint-playbook` workflow to use the new two-phase
    generation pipeline (JSON manifest output -> script execution).
  - Added automated topological sorting for task dependencies and intelligent
    chat session grouping by workspace scope.
  - Added comprehensive unit tests for the playbook generation logic.

### Changed

- **Submodule Distribution Alignment**: Moved the playbook generation script
  into the `.agents/` directory to ensure it is correctly distributed to
  consumer projects via git submodules.
- **Workflow Improvements**: Updated `generate-sprint-playbook` and
  `sprint-playbook-template` to support the new generation model and provide
  better execution rule guidance.

## [2.0.0] - 2026-03-29

### Major Architectural Overhaul

- **Persona Expansion (12-Role Architecture)**:
  - Expanded from 4 to 12 specialized personas to eliminate role conflation:
    `architect`, `engineer`, `engineer-web`, `engineer-mobile`, `product`,
    `ux-designer`, `qa-engineer`, `devops-engineer`, `sre`, `security-engineer`,
    `technical-writer`, and `project-manager`.
  - **Automatic Referral Protocol**: Standardized **Scope Boundaries** across
    all personas, enabling agents to automatically detect out-of-scope tasks and
    switch to the appropriate persona without user intervention.

- **Structured Configuration Centralization**:
  - Created a dedicated `.agents/config/` directory to house all JSON
    configuration files.
  - **Model Selection (`config/models.json`)**: Extracted model tiers and
    chaining logic for better maintainability.
  - **Tech Stack (`config/tech-stack.json`)**: Extracted all project-specific
    technology references (ORM, DB, API, UI, etc.) to ensure protocol
    portability across different tech stacks.
  - **Agent Config (`config/config.json`)**: Centralized operational limits and
    auto-run permissions.

- **Expanded Sprint Lifecycle**:
  - Introduced mandatory **Sprint Code Review** (Chat Session 5) and **Sprint
    Retrospective** (Chat Session 6) into the core workflow.
  - Added 6 new internal sprint workflows: `gather-sprint-context`,
    `verify-sprint-prerequisites`, `finalize-sprint-task`, `sprint-testing`,
    `sprint-code-review`, and `sprint-retro`.

- **Generic & Portable Templates**:
  - Refactored `technical-spec-template.md` and `prd-template.md` to be
    tech-agnostic, dynamically pulling project details from
    `config/tech-stack.json`.
  - Standardized `Output Artifacts` sections across all personas for consistent
    artifact ownership.

### Documentation

- **README Overhaul**: Updated `.agents/README.md` and root `README.md` to
  reflect the new 12-persona structure, categorized workflows table, and
  centralized config folder.

## [1.13.5] - 2026-03-29

### Workflow Enhancements

- **Agent Notification Webhook**:
  - Updated the `generate-sprint-playbook` workflow to include a mandatory
    notification step in the `AGENT EXECUTION PROTOCOL`.
  - Agents will now attempt to call a webhook URL defined as
    `AGENT_NOTIFICATION_WEBHOOK` in the `AGENTS.md` file upon completing a
    sprint step.
  - Implemented graceful failure logic if the variable is not set.

## [1.13.4] - 2026-03-29

### Workflow Enhancements

- **Enhanced Model Selection Guidance**:
  - Overhauled the `generate-sprint-playbook` workflow with detailed model
    personas (Architects, Workhorses, Sprinters, Specialists).
  - Introduced explicit **Planner-Executor-Reviewer** chaining logic to optimize
    agentic performance across Claude 4.6 and Gemini 3.1 models.
  - Added specific guidance for utilizing **Opus (Thinking)** as an escalation
    model and **Flash** for the "inner loop" of development.

## [1.13.3] - 2026-03-28

### Workflow Enhancements

- **Standardized Sprint Retrospectives**:
  - Introduced `.agents/templates/sprint-retro-template.md` to ensure
    consistent, metric-driven retrospectives.
  - Updated the `generate-sprint-playbook` workflow (via
    `sprint-playbook-template.md`) to explicitly mandate retro generation using
    the new template.
  - Standardized retro sections for Scorecard, Architectural Debt, and Action
    Items.

## [1.13.2] - 2026-03-27

### Workflow Enhancements

- **Sprint Test Plan Customization**: Updated `generate-sprint-playbook` to
  ensure sprint-specific test plans are stored in the
  `test-plans/sprint-test-plans/` folder instead of the generic
  `docs/test-plans/` directory.
- **Improved QA Persona Alignment**: Enhanced the QA Automation Engineer persona
  instructions to strictly use sprint-numbered test plan filenames.

## [1.13.1] - 2026-03-27

### Workflow Enhancements

- **Audit Output Standardization**: Standardized all audit workflows to append
  `-results.md` to their output filenames (e.g., `sre-audit-results.md`,
  `accessibility-audit-results.md`).
- **Improved Contextual Clarity**: Updated documentation to reflect these new
  output patterns, ensuring agents produce consistently named artifacts across
  all audit types.

## [1.13.0] - 2026-03-27

### Protocol Refinements

- **Concurrent Sprint Prerequisite Logic**:
  - Overhauled the `generate-sprint-playbook` workflow to correctly handle
    Fan-Out (concurrent) chat sessions.
  - Replaced the ambiguous "previous chats" check with explicit mandatory
    dependency lists in task templates.
  - Updated the `AGENT EXECUTION PROTOCOL` to eliminate out-of-order execution
    blocks in parallel development tracks (e.g., Web vs. Mobile).

## [1.12.0] - 2026-03-26

### Protocol Hardening

- **Improved Sprint Playbook Generation**:
  - Moved the `AGENT EXECUTION PROTOCOL` to the top of task blocks for improved
    agent visibility and adherence.
  - Introduced a mandatory **Sample Data Maintenance** step for Chat Session 4
    (QA) to ensure dev data (seeds, mocks) stays in sync.
  - Strengthened protocol language to strictly enforce prerequisites and state
    updates.

## [1.11.0] - 2026-03-26

### Refinements & Standardization

- **Audit Workflow Harmonization**: Synchronized 7 new audit workflows with the
  standardized `devops-audit` and `qa-audit` structure. All audits now include
  mandatory Dimension/Category, Impact, Current State, Recommendation, and
  copy-pasteable **Agent Prompts** for safe remediation.
- **Improved Read-Only Guardrails**: Reinforced the non-mutating nature of audit
  workflows to ensure purely diagnostic behavior.

### Fixes

- **ESLint Compliance**: Resolved `no-console` warnings in the `athlete-portal`
  scripts (specifically `self-healing-agent.ts`) that were blocking Husky
  pre-commit hooks.

## [1.10.0] - 2026-03-26

### Workflow Enhancements

- **Audit & Automation Expansion**: Introduced 7 new comprehensive workflows:
  - `privacy-audit`: Data privacy and PII compliance checking.
  - `clean-code-audit`: Maintainability and technical debt analysis.
  - `security-audit`: Vulnerability scanning and OWASP alignment.
  - `performance-audit`: Deep architectural and stack-wide bottleneck analysis.
  - `generate-release-notes`: Automated synthesis of git commits into
    user-facing changelogs.
  - `dependency-update-audit`: Security and bloat auditing for modern package
    managers.
  - `ux-ui-audit`: Design system consistency and UX best-practice reviews.

### Domain Skills

- **Ecosystem Expansion**: Added 14 new foundational skills to the
  `.agents/skills/` directory:
  - **Frontend**: `astro`, `tailwind-v4`, `google-analytics-v4`.
  - **Backend**: `cloudflare-workers`, `turso-sqlite`, `clerk-auth`,
    `stripe-payments`, `highlevel-crm`.
  - **QA**: `vitest`, `playwright`, `accessibility-audit`.
  - **Architecture**: `subagent-orchestration`, `structured-output-zod`,
    `markdown`.

## [1.9.0] - 2026-03-25

### Workflow Enhancements

- **Hardened Test Execution**: Updated `run-test-plan` workflow to prevent
  repository mutations:
  - Mandated the creation of a local `*-RESULTS.md` copy for all test results
    instead of inline updates to original files.
  - Explicitly prohibited automatic commits, staging, or check-ins of test
    results or temporary scripts.
  - Enforced strict local-only persistence for artifact review.

## [1.8.0] - 2026-03-25

### Workflow Enhancements

- **Protocol & Formatting Hardening**: Overhauled `generate-sprint-playbook` to
  enforce strict output standards:
  - Introduced the **"No Outer Wrapper"** rule, mandating raw Markdown output
    instead of fenced code blocks for the entire playbook.
  - Implemented the **"No-Summarization Rule"** to ensure the
    `AGENT EXECUTION PROTOCOL` is copied word-for-word into every task without
    modification.
  - Standardized **Chat Session Headers** with sequence indicators and icons.
  - Integrated a required **Mermaid diagram** into the playbook template to
    visualize the Fan-Out architecture.
  - Refined task scoping and template structure for improved agent readability.

## [1.7.0] - 2026-03-25

### Workflow Enhancements

- **Integrated QA Lifecycle**: Hardened `generate-sprint-playbook` by coupling
  test plan generation with execution:
  - Mandated a dedicated Chat Session (Session 4) for updating
    `docs/test-plans/*.md` with new features before running them.
  - Expanded the **QA Automation Engineer** persona to include manual test plan
    authoring and documentation tasks.
  - Defined explicit **Dual-Purpose Testing** standards (semantic locators and
    SQL assertions) for robust validation.
  - Refined model routing to prefer **Claude Sonnet 4.6 (Planning)** for
    producing high-quality QA documentation.

## [1.6.0] - 2026-03-25

### Workflow Enhancements

- **Fan-Out Architecture**: Overhauled `generate-sprint-playbook` with a robust
  multi-agent orchestration model:
  - Introduced explicit Chat Session modeling (Backend, UI, QA, Retro) for
    parallelized agent execution and data contract locking.
  - Added strict Model Routing and Persona Assignment rules to optimize for
    specialized task execution.
  - Implemented a mandatory `Agent Execution Protocol` within task templates to
    enforce dependency checking, state updates, and hook-based validation.
  - Standardized QA tasks to leverage existing test plans via `/run-test-plan`
    instead of ad-hoc test generation.

## [1.5.0] - 2026-03-25

### Core Improvements

- **Sprint Playbook Checks**: Introduced mandatory prerequisite validation and
  final sprint audits:
  - Added `PREREQUISITE CHECK` to all playbook task templates to prevent
    out-of-order execution.
  - Added `FINAL SPRINT AUDIT` to the retro workflow to verify completion
    against PRDs.
  - Updated `generate-sprint-playbook` to explicitly list task dependencies.
- **Update Documentation**: Restored comprehensive submodule update strategies
  (Bash, PowerShell, and `package.json`) to the root `README.md` and
  de-duplicated the `.agents/README.md` user guide.

## [1.4.1] - 2026-03-25

### Fixes

- **Slash Command Discovery**: Flattened the `workflows/` directory back to the
  root level. This restores native Antigravity IDE auto-registration for all `/`
  commands which was inadvertently broken by subdirectory categorization in
  v1.3.0.
- **CI/CD Validation**: Hardened the `dist` branch publication process to
  strictly validate the presence of the new `rules/` and `config.json` files.

## [1.4.0] - 2026-03-25

### Core Improvements

- **Modular Global Rules**: Introduced the `.agents/rules/` directory containing
  foundational, domain-agnostic standards:
  - `git-conventions.md`: Conventional Commits and branch naming.
  - `api-conventions.md`: JSON formatting, error shapes, and status codes.
  - `testing-standards.md`: Arrange-Act-Assert patterns and naming.
  - `database-standards.md`: Naming conventions and soft-deletion policies.
  - `security-baseline.md`: Zod validation and PII protection.
  - `ui-copywriting.md`: Sentence case and empathetic tone guidelines.
- **Local Overrides**: Added support for `.agents/instructions.local.md` and
  `config.local.json` to allow personal developer preferences.
- **Structured Config**: Introduced `.agents/config.json` for programmatic agent
  guardrails.

### Documentation

- **User Guide Updates**: Documented the new rules and localization features in
  `.agents/README.md`.
- **System core**: Updated `instructions.md` to bootstrap the new rules and
  config system.

## [1.3.0] - 2026-03-25

### Core Improvements

- **Structural Organization**: Categorized all `skills` (into `frontend`,
  `backend`, `security`, `qa`, `architecture`) and `workflows` (into `audits`,
  `sdlc`, `testing`) to support future expansion.

### Documentation

- **User Guide Updates**: Overhauled `.agents/README.md` with new directory
  structures and categorized tables for skills and workflows.
- **Instructional Updates**: Updated `.agents/instructions.md` to support the
  new categorized skill paths.

## [1.2.0] - 2026-03-25

### Documentation

- **Personal Stack**: Added details on the agent-first personal development
  stack (Google AI Ultra, Antigravity IDE, Wispr Flow) in the root `README.md`.

## [1.1.1] - 2026-03-25

### Core Improvements

- **Workflow Renaming**: Standardized sprint planning workflows from `plan-*` to
  `generate-*` for clarity.
- **Git Integration**: Added mandatory git commit steps to all sprint playbook
  tasks to ensure progress is saved and pre-commit hooks are enforced.

## [1.1.0] - 2026-03-25

### Key Improvements

- **Automated Sprint Planning**: Restructured `SDLC` folder into automated
  `/plan-sprint` workflows.
- **Consolidated Instructions**: Merged `system-prompt.md` into
  `instructions.md` for a single system core.
- **Streamlined Structure**: Flattened `.agents/` directory by moving templates
  to root.

## [1.0.0] - 2026-03-25

### Initial Release

- **Initial Stable Release**: Standardized Agent Protocols for LLM-based coding
  assistants.
- **Global Instructions**: Foundational rules for context-first, plan-first, and
  security-first agent behavior.
- **Persona System**: Role-specific constraints for AI agents (Architect,
  Engineer, Product, SRE).
- **Domain Skills**: Modular tech-stack guardrails (SQLite/Drizzle, Cloudflare
  Workers, Astro, Expo, etc.).
- **SDLC Workflows**: Standardized sprint planning, PRD, and technical spec
  templates.
- **Slash Command Audits**: Integrated workflows for accessibility,
  architecture, devops, and SRE reviews.
- **Consumer Distribution**: Submodule-based delivery via the `dist` branch.
- **Cross-Platform Support**: Added PowerShell compatibility for manual
  submodule update commands.
