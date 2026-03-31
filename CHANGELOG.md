# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Updated the `qa-engineer` persona and `plan-qa-testing`/`qa-audit` workflows
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
    `verify-sprint-prerequisites`, `finalize-sprint-task`, `plan-qa-testing`,
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
