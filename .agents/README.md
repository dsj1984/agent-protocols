# Agent Protocols — Consumer Reference

This is the detailed reference guide for teams consuming the Agent Protocols
framework via the `.agents/` Git submodule.

## Directory Layout

```text
.agents/
├── VERSION                  # Current version (5.0.0)
├── SDLC.md                  # End-to-end workflow guide
├── instructions.md          # MANDATORY: Primary system prompt
├── default-agentrc.json     # Copy to project root as .agentrc.json
├── personas/                # 12 role-specific behavior constraints
├── rules/                   # 8 domain-agnostic coding standards
├── schemas/                 # JSON Schemas for structured output validation
├── scripts/                 # v5 orchestration engine
│   ├── lib/                 # Core libraries (config, interfaces, factory)
│   │   ├── ITicketingProvider.js   # Abstract 10-method ticketing contract
│   │   ├── config-resolver.js      # Unified config + .env loader
│   │   └── provider-factory.js     # Resolves provider name → class
│   └── providers/
│       └── github.js        # GitHub REST + GraphQL implementation
├── skills/                  # Two-tier skill library
│   ├── core/                # Universal process skills (20 skills)
│   └── stack/               # Tech-stack-specific guardrails (19 skills)
├── templates/               # Context hydration and CI templates
└── workflows/               # 25 slash-command workflows
```

---

## System Prompt (`instructions.md`)

**This file is the agent's system prompt.** Configure your AI tool (`.cursorrules`,
Custom Instructions, or system prompt settings) to load its full content.

The system prompt instructs agents to:

1. **Ingest** the baseline rules from `rules/`.
1. **Route** to the appropriate persona from `personas/`.
1. **Activate** domain guardrails from `skills/`.
1. **Retrieve** live documentation via Context7 MCP.
1. **Enforce** Windows shell compatibility (`;` not `&&`).

> [!IMPORTANT]
> You MUST configure your AI tool to load `instructions.md` as its primary
> system prompt. Without this, none of the protocols are active.

---

## Configuration (`.agentrc.json`)

All agent scripts resolve settings from a unified `.agentrc.json` at your
project root.

**Setup — run once per project:**

```bash
cp .agents/default-agentrc.json .agentrc.json
```

### Key Settings

| Setting                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `agentSettings.baseBranch`       | Your default branch (`main`, `master`, etc.)    |
| `agentSettings.testCommand`      | Your project's test runner                      |
| `agentSettings.validationCommand`| Comprehensive validation suite                  |
| `agentSettings.lintBaselineCommand` | Structured linter output for baseline ratcheting |
| `orchestration.provider`         | Ticketing provider (`"github"`)                 |
| `orchestration.github.owner`     | GitHub repository owner                         |
| `orchestration.github.repo`      | GitHub repository name                          |
| `techStack.project.name`         | Your project name                               |

### Validation Commands

The framework uses three commands for quality checks:

1. **`validationCommand`** — Comprehensive check (e.g., `run-s lint typecheck`).
1. **`typecheckCommand`** — Strict type-checking (e.g., `tsc --noEmit`). Run
   independently after refactors to verify typing boundaries.
1. **`lintBaselineCommand`** — Structured JSON output for the lint baseline
   ratchet engine. Integrations fail if new warnings are introduced.

> **Resolution order:** `.agentrc.json` at project root → built-in defaults
> (zero-config fallback).

### Local Overrides

Override protocol behavior per-machine with `.agents/instructions.local.md`
(rules) or `.agentrc.local.json` (config). These are automatically gitignored.

---

## Activation

1. **Configure** your AI tool to load `.agents/instructions.md` as the system
   prompt.
1. **Use personas** by telling the agent to "Act as [Role]" — it loads the
   matching file from `personas/`.
1. **Activate skills** by name or let the agent auto-discover `SKILL.md` files
   in `skills/core/` and `skills/stack/`.
1. **Run workflows** using slash commands (e.g., `/sprint-plan`, `/audit-security`).

---

## Personas

Personas constrain agent behavior to a specific role.

| File                   | Role            | Focus                                                      |
| ---------------------- | --------------- | ---------------------------------------------------------- |
| `architect.md`         | Architect       | System design, tech specs, API contracts, security         |
| `engineer.md`          | Engineer (Gen)  | Implementation, backend, shared libs, logic                |
| `engineer-web.md`      | Web Engineer    | Frontend UI, Astro/React, browser performance, WCAG        |
| `engineer-mobile.md`   | Mobile Engineer | Expo/React Native, native modules, mobile UX               |
| `product.md`           | Product Mgr     | PRDs, user stories, MVP scoping, roadmap, retros           |
| `ux-designer.md`       | UX Designer     | Journey maps, component states, visual hierarchy           |
| `qa-engineer.md`       | QA Engineer     | Test plans, E2E/Unit automation, test data management      |
| `devops-engineer.md`   | DevOps Engineer | CI/CD pipelines, IaC, build tooling, DX                    |
| `sre.md`               | SRE             | Reliability, observability, performance, incident response |
| `security-engineer.md` | Security Eng    | Audits, threat modeling, auth/authz, data privacy          |
| `technical-writer.md`  | Tech Writer     | Documentation, changelogs, Mermaid diagrams                |
| `project-manager.md`   | Project Mgr     | Sprint decomposition, playbook generation, orchestration   |

---

## Rules

Modular, domain-agnostic standards loaded by the system prompt.

| File                                 | Domain          | Purpose                                                |
| ------------------------------------ | --------------- | ------------------------------------------------------ |
| `api-conventions.md`                 | API             | RESTful standards, status codes, and JSON patterns     |
| `coding-style.md`                    | Generic         | Clean code standards and file structure conventions    |
| `database-standards.md`              | Database        | Migration safety, naming, and indexing strategies      |
| `git-conventions.md`                 | Version Control | Branching strategy and PR quality standards            |
| `security-baseline.md`              | Security        | OWASP basics, credential safety, and encryption rules  |
| `testing-standards.md`               | Quality         | Coverage thresholds and unit testing philosophy        |
| `ui-copywriting.md`                  | UX              | Content tone, error messaging, and labeling standards  |
| `search-and-execution-heuristics.md` | Shell & Search  | Optimized command usage and pipeline safety heuristics |

---

## Skills

The skill library uses a **two-tier architecture**: universal process skills
(`core/`) and technology-specific guardrails (`stack/`).

### Core Skills (`skills/core/`)

| Skill                           | Phase    | Purpose                                                  |
| ------------------------------- | -------- | -------------------------------------------------------- |
| `idea-refinement`               | Define   | Structured divergent/convergent thinking for vague ideas |
| `spec-driven-development`       | Define   | Requirements and acceptance criteria before code         |
| `planning-and-task-breakdown`   | Plan     | Decompose features into small, verifiable tasks          |
| `context-engineering`           | Build    | Load the right context at the right time                 |
| `incremental-implementation`    | Build    | Thin vertical slices, verified before expanding          |
| `api-and-interface-design`      | Build    | Stable interfaces with clear contracts                   |
| `frontend-ui-engineering`       | Build    | Production-quality UI with accessibility                 |
| `code-simplification`           | Build    | Resist over-engineering; prefer the boring solution      |
| `test-driven-development`       | Verify   | Failing test first, then make it pass                    |
| `browser-testing-with-devtools` | Verify   | Chrome DevTools MCP for runtime verification             |
| `debugging-and-error-recovery`  | Verify   | Reproduce → localize → fix → guard                       |
| `code-review-and-quality`       | Review   | Five-axis review with quality gates                      |
| `security-and-hardening`        | Review   | OWASP prevention, input validation, least privilege      |
| `performance-optimization`      | Review   | Measure first, optimize only what matters                |
| `git-workflow-and-versioning`   | Ship     | Atomic commits, clean history, conventional commits      |
| `ci-cd-and-automation`          | Ship     | Automated quality gates on every change                  |
| `documentation-and-adrs`        | Ship     | Document the why, not just the what                      |
| `shipping-and-launch`           | Ship     | Pre-launch checklist, monitoring, rollback plan          |
| `deprecation-and-migration`     | Maintain | Safe removal of legacy code and upgrade patterns         |
| `using-agent-skills`            | Meta     | Skill discovery and sequencing guide                     |

### Stack Skills (`skills/stack/`)

| Skill                           | Category       | Purpose                                               |
| ------------------------------- | -------------- | ----------------------------------------------------- |
| `monorepo-path-strategist`      | `architecture` | Enforces workspace aliases and dependency boundaries  |
| `structured-output-zod`         | `architecture` | Enforces structured API responses using Zod           |
| `subagent-orchestration`        | `architecture` | Defines subagent task delegation strategies           |
| `clerk-auth`                    | `backend`      | Security standard for Clerk authentication            |
| `cloudflare-hono-architect`     | `backend`      | Prevents Node.js module usage in edge Workers         |
| `cloudflare-queue-manager`      | `backend`      | Ensures idempotent, resilient queue consumer logic    |
| `cloudflare-workers`            | `backend`      | Cloudflare edge compute best practices                |
| `highlevel-crm`                 | `backend`      | Guidelines for GoHighLevel CRM integration            |
| `sqlite-drizzle-expert`         | `backend`      | Enforces SQLite dialect for Drizzle ORM and Turso     |
| `stripe-billing-expert`         | `backend`      | Ensures idempotency keys and webhook signature checks |
| `stripe-payments`               | `backend`      | Secure processing for Stripe checkout sessions        |
| `turso-sqlite`                  | `backend`      | Rules for Turso edge database interactions            |
| `astro`                         | `frontend`     | Astro hydration, rendering, and routing rules         |
| `astro-react-island-strategist` | `frontend`     | Maintains Astro/React island hydration boundaries     |
| `expo-react-native-developer`   | `frontend`     | Prevents DOM elements in React Native code            |
| `google-analytics-v4`           | `frontend`     | Secure event logging for GA4                          |
| `tailwind-v4`                   | `frontend`     | Ensures strict Tailwind v4 class usage                |
| `audit-accessibility`           | `qa`           | WCAG automated scanning compliance                    |
| `playwright`                    | `qa`           | Rules for writing robust Playwright E2E tests         |
| `vitest`                        | `qa`           | Unit test automation with Vitest                      |
| `secure-telemetry-logger`       | `security`     | Standardizes structured logging and PII stripping     |

---

## Workflows

Workflows are reusable slash commands for audits, sprint operations, and
repository maintenance.

### Audit Workflows

| Workflow                   | Slash Command              | Purpose                                      |
| -------------------------- | -------------------------- | -------------------------------------------- |
| `audit-accessibility.md`  | `/audit-accessibility`     | Lighthouse accessibility audit               |
| `audit-architecture.md`   | `/audit-architecture`      | Architecture and coupling review             |
| `audit-clean-code.md`     | `/audit-clean-code`        | Maintainability and technical debt analysis  |
| `audit-dependency-update.md` | `/audit-dependency-update` | Dependency security and bloat audit       |
| `audit-devops.md`         | `/audit-devops`            | CI/CD and infrastructure review              |
| `audit-performance.md`    | `/audit-performance`       | Bottleneck and performance audit             |
| `audit-privacy.md`        | `/audit-privacy`           | PII and privacy compliance audit             |
| `audit-quality.md`        | `/audit-quality`           | Test coverage and quality review             |
| `audit-security.md`       | `/audit-security`          | Vulnerability and OWASP alignment            |
| `audit-seo.md`            | `/audit-seo`               | SEO and Generative Engine Optimization       |
| `audit-sre.md`            | `/audit-sre`               | Production release readiness audit           |
| `audit-ux-ui.md`          | `/audit-ux-ui`             | Design system consistency review             |

### Sprint Workflows

| Workflow                          | Slash Command                       | Purpose                                         |
| --------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `sprint-plan.md`                  | `/sprint-plan`                      | Autonomous PRD, Tech Spec, and task generation  |
| `sprint-execute.md`               | `/sprint-execute`                   | DAG dispatch (Epic) or task implementation      |
| `sprint-verify-task-prerequisites.md` | `/sprint-verify-task-prerequisites` | Validate dependencies before execution      |
| `sprint-finalize-task.md`         | `/sprint-finalize-task`             | Validation, commit, and state sync              |
| `sprint-code-review.md`          | `/sprint-code-review`               | Comprehensive code review                       |
| `sprint-integration.md`          | `/sprint-integration`               | Merge and stabilization                         |
| `sprint-hotfix.md`               | `/sprint-hotfix`                    | Rapid remediation on feature branches           |
| `sprint-retro.md`                | `/sprint-retro`                     | Retrospective from ticket graph                 |
| `sprint-close-out.md`            | `/sprint-close-out`                 | Final merge, tag release, close Epic            |

### Utility Workflows

| Workflow                          | Slash Command                       | Purpose                                         |
| --------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `bootstrap-agent-protocols.md`   | `/bootstrap-agent-protocols`        | Initialize repo labels and project fields       |
| `git-commit-all.md`              | `/git-commit-all`                   | Stage and commit all changes                    |
| `delete-epic.md`                 | `/delete-epic`                      | Hard reset: delete Epic branches and issues     |
| `run-red-team.md`                | `/run-red-team`                     | Adversarial security testing                    |

---

## Orchestration Engine

### Provider Architecture

All ticketing operations are mediated through the `ITicketingProvider` abstract
interface. The framework ships with a **GitHub provider** using raw `fetch()`
(Node 20+) — no external SDK dependencies.

| Layer                 | File                                | Purpose                                        |
| --------------------- | ----------------------------------- | ---------------------------------------------- |
| Abstract Interface    | `scripts/lib/ITicketingProvider.js` | 10-method contract for all ticketing providers |
| Provider Factory      | `scripts/lib/provider-factory.js`   | Resolves `orchestration.provider` → class      |
| GitHub Implementation | `scripts/providers/github.js`       | REST + GraphQL implementation for GitHub       |
| Config Resolver       | `scripts/lib/config-resolver.js`    | ajv schema validation + .env auto-loader       |

### Scripts Reference

| Script                          | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `bootstrap-agent-protocols.js`  | Idempotent setup of GitHub labels and project fields      |
| `epic-planner.js`               | Autonomous PRD and Tech Spec generation                   |
| `ticket-decomposer.js`          | Recursive 4-tier hierarchy decomposition                  |
| `dispatcher.js`                 | DAG scheduler — builds dependency graph, dispatches waves |
| `context-hydrator.js`           | Assembles self-contained agent prompts from ticket graph  |
| `sprint-integrate.js`           | Merges task branches into Epic base branch                |
| `update-ticket-state.js`        | Label-based state machine with completion cascade         |
| `delete-epic.js`                | Recursive issue deletion via GraphQL                      |
| `notify.js`                     | Operator notification (mentions + webhooks)               |
| `verify-prereqs.js`             | Validates task dependencies before execution              |
| `lint-baseline.js`              | Lint baseline ratchet — prevents new warnings             |
| `generate-roadmap.js`           | Auto-renders `docs/roadmap.md` from live Epics            |
| `diagnose-friction.js`          | Analyzes friction logs for patterns                       |
| `detect-merges.js`              | Detects and reports merge conflicts                       |
| `git-commit-if-changed.js`      | Conditional commit utility                                |

### Orchestration Configuration

Add the following block to your `.agentrc.json`:

```json
{
  "orchestration": {
    "provider": "github",
    "github": {
      "owner": "your-org",
      "repo": "your-repo",
      "projectNumber": null,
      "operatorHandle": "@your-username"
    },
    "notifications": {
      "mentionOperator": true,
      "webhookUrl": ""
    }
  }
}
```

| Field                           | Required | Description                                             |
| ------------------------------- | -------- | ------------------------------------------------------- |
| `provider`                      | Yes      | Provider name (`"github"` is the only shipped provider) |
| `github.owner`                  | Yes      | GitHub repository owner (user or org)                   |
| `github.repo`                   | Yes      | GitHub repository name                                  |
| `github.projectNumber`          | No       | GitHub Projects V2 number (for custom fields)           |
| `github.operatorHandle`         | No       | GitHub @mention handle for notifications                |
| `notifications.mentionOperator` | No       | Whether to @mention the operator in comments            |
| `notifications.webhookUrl`      | No       | Webhook URL for external notification delivery          |

---

## Authentication

The `GitHubProvider` resolves credentials in this priority order:

| Priority | Method                       | Environment                 |
| -------- | ---------------------------- | --------------------------- |
| 1        | GitHub MCP Server            | Agentic IDE (Antigravity)   |
| 2        | `GITHUB_TOKEN` or `GH_TOKEN` | CI/CD, background scripts   |
| 3        | `gh auth token` (CLI)        | Local developer workflow    |

### Required Token Permissions

**Fine-grained PATs (recommended):**

- `GitHub Projects (V2)`: Read & Write
- `Issues`: Read & Write
- `Metadata`: Read-only
- `Pull requests`: Read & Write

**Classic PATs:** `repo` + `project` (full control).

### Configuration

1. **Agentic IDE**: Ensure the `github-mcp-server` is active in the session.
1. **Background scripts**: Set `GITHUB_TOKEN` in your environment or `.env`
   file at the project root.
1. **Local CLI**: Run `gh auth login`.

---

## Guardrails

### Anti-Thrashing Protocol

Agents MUST halt, summarize blockers, and re-plan if they hit consecutive tool
errors or perform consecutive analysis steps without modifying a file.
Controlled by `frictionThresholds` in `.agentrc.json`.

### Lint Baseline Ratcheting

The lint baseline engine enforces zero-deterioration during sprint workflows.
Integrations fail if new lint warnings are introduced, and the baseline
automatically tightens when the codebase improves.

### HITL Risk Gates

Deterministic safety checks force Human-In-The-Loop approval when an agent plans
destructive operations (e.g., `DROP TABLE`, `DELETE`).

### Friction Telemetry

Friction events (repetitive commands, consecutive errors, stagnation) are logged
as structured comments on the Task issue for post-hoc analysis.

---

## Git Performance (Windows)

### Global Settings (Run Once)

```bash
git config --global core.fsmonitor true
git config --global feature.manyFiles true
```

### Per-Repository Maintenance

```bash
git maintenance start
```
