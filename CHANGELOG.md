# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-03-25

### Core Improvements

- **Sprint Playbook Checks**: Introduced mandatory prerequisite validation and
  final sprint audits:
  - Added `PREREQUISITE CHECK` to all playbook task templates to prevent
    out-of-order execution.
  - Added `FINAL SPRINT AUDIT` to the retro workflow to verify completion
    against PRDs.
  - Updated `generate-sprint-playbook` to explicitly list task dependencies.

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
