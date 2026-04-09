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
│   ├── lib/                 # Core libraries
│   │   ├── orchestration/           # ★ Orchestration SDK (Epic 71+)
│   │   │   ├── index.js             # Barrel export: all SDK functions
│   │   │   ├── dispatcher.js        # DAG scheduling, wave computation, manifest rendering
│   │   │   ├── context-hydrator.js  # Self-contained prompt assembly
│   │   │   └── ticketing.js         # Ticket state machine + cascade logic
│   │   ├── ITicketingProvider.js    # Abstract 10-method ticketing contract
│   │   ├── IExecutionAdapter.js     # Abstract execution adapter interface
│   │   ├── config-resolver.js       # Unified config + .env loader + AJV validation
│   │   ├── provider-factory.js      # Resolves provider name → class
│   │   ├── adapter-factory.js       # Resolves adapter name → class
│   │   ├── Graph.js                 # DAG implementation for dependency resolution
│   │   ├── VerboseLogger.js         # Structured step-by-step execution logger
│   │   ├── git-merge-orchestrator.js  # Branch merge sequencing and conflict handling
│   │   └── git-utils.js             # Git shell command utilities
│   ├── providers/
│   │   └── github.js        # GitHub REST + GraphQL implementation
│   ├── adapters/            # Execution adapters (e.g., shell, MCP)
│   ├── mcp-orchestration.js # MCP Server entry point — exposes SDK as tools
│   └── [cli scripts…]       # Thin CLI wrappers delegating to the SDK
├── skills/                  # Two-tier skill library
│   ├── core/                # Universal process skills (20 skills)
│   └── stack/               # Tech-stack-specific guardrails (19 skills)
├── templates/               # Context hydration and CI templates
└── workflows/               # 36 slash-command workflows
```

---

## System Prompt (`instructions.md`)

**This file is the agent's system prompt.** Configure your AI tool
(`.cursorrules`, Custom Instructions, or system prompt settings) to load its
full content.

The system prompt instructs agents to:

1. **Ingest** the baseline rules from `rules/`.
1. **Route** to the appropriate persona from `personas/`.
1. **Activate** domain guardrails from `skills/`.
1. **Retrieve** live documentation via Context7 MCP.
1. **Enforce** Windows shell compatibility (`;` not `&&`).

> [!IMPORTANT] You MUST configure your AI tool to load `instructions.md` as its
> primary system prompt. Without this, none of the protocols are active.

---

## Configuration (`.agentrc.json`)

All agent scripts resolve settings from a unified `.agentrc.json` at your
project root.

**Setup — run once per project:**

```bash
cp .agents/default-agentrc.json .agentrc.json
```

### Key Settings

| Setting                             | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `agentSettings.baseBranch`          | Your default branch (`main`, `master`, etc.)     |
| `agentSettings.testCommand`         | Your project's test runner                       |
| `agentSettings.validationCommand`   | Comprehensive validation suite                   |
| `agentSettings.lintBaselineCommand` | Structured linter output for baseline ratcheting |
| `orchestration.provider`            | Ticketing provider (`"github"`)                  |
| `orchestration.github.owner`        | GitHub repository owner                          |
| `orchestration.github.repo`         | GitHub repository name                           |
| `techStack.project.name`            | Your project name                                |

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
1. **Run workflows** using slash commands (e.g., `/sprint-plan`,
   `/audit-security`).

---

## MCP Server (Native Tooling)

Version 5 introduces the **Agent Protocols MCP Server**, enabling agents to
discover and invoke orchestration tools natively (e.g., in Cursor, Claude
Desktop, or VS Code) without spawning shell subprocesses.

### 1. Configuration

Add the following to your MCP host settings (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-protocols": {
      "command": "node",
      "args": ["/absolute/path/to/your/project/.agents/scripts/mcp-orchestration.js"],
      "env": {
        "GITHUB_TOKEN": "your_token_here",
        "GEMINI_API_KEY": "your_token_here",
        "NOTIFICATION_WEBHOOK_URL": "optional_webhook_url"
      }
    }
  }
}
```

> [!IMPORTANT]
> Always use **absolute paths** for the `args` array to ensure the server starts correctly regardless of where your agent is currently focused.

### 2. Authentication & Secrets

The MCP server resolves secrets in this priority:

1. **Host Environment**: Variables defined in the `env` block of your MCP config.
2. **Project `.env`**: Automatically loaded from your project root.
3. **External Tools**: Leverages the `github-mcp-server` if active in the same session.

### 3. Exposed Tools

| Tool                     | Equivalent Command         | Agent Benefit                                      |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| `orchestrator_dispatch`  | `node dispatcher.js`       | Returns markdown manifest with progress checkboxes  |
| `orchestrator_hydrate`   | `node context-hydrator.js` | Returns a self-contained, fully hydrated prompt    |
| `orchestrator_transition`| `node update-ticket-state.js`| Supports state machine logic and cascade semantics |
| `orchestrator_verify`    | `node verify-prereqs.js`   | Checks dependency DAG before implementation starts |
| `select_audits`          | `node audit-orchestrator.js`| Triggers audits based on gate and context rules    |
| `run_audit_suite`        | *(Native MCP)*             | Executes audit suites and normalizes findings      |

### 4. Debugging

If the server is configured but not appearing:

- Check the **stderr** logs in your MCP host.
- Success message: `[MCP] agent-protocols v5.0.0 server started`
- Failures: Initialization errors (missing dependencies, path issues) are logged before the server exits with code 1.

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
| `security-baseline.md`               | Security        | OWASP basics, credential safety, and encryption rules  |
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

| Workflow                     | Slash Command              | Purpose                                     |
| ---------------------------- | -------------------------- | ------------------------------------------- |
| `audit-accessibility.md`     | `/audit-accessibility`     | Lighthouse accessibility audit              |
| `audit-architecture.md`      | `/audit-architecture`      | Architecture and coupling review            |
| `audit-clean-code.md`        | `/audit-clean-code`        | Maintainability and technical debt analysis |
| `audit-dependency-update.md` | `/audit-dependency-update` | Dependency security and bloat audit         |
| `audit-devops.md`            | `/audit-devops`            | CI/CD and infrastructure review             |
| `audit-performance.md`       | `/audit-performance`       | Bottleneck and performance audit            |
| `audit-privacy.md`           | `/audit-privacy`           | PII and privacy compliance audit            |
| `audit-quality.md`           | `/audit-quality`           | Test coverage and quality review            |
| `audit-security.md`          | `/audit-security`          | Vulnerability and OWASP alignment           |
| `audit-seo.md`               | `/audit-seo`               | SEO and Generative Engine Optimization      |
| `audit-sre.md`               | `/audit-sre`               | Production release readiness audit          |
| `audit-ux-ui.md`             | `/audit-ux-ui`             | Design system consistency review            |

### Sprint Workflows

| Workflow                              | Slash Command                       | Purpose                                        |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `sprint-plan.md`                      | `/sprint-plan`                      | Autonomous PRD, Tech Spec, and task generation |
| `sprint-execute.md`                   | `/sprint-execute`                   | DAG dispatch (Epic) or task implementation     |
| `sprint-code-review.md`               | `/sprint-code-review`               | Comprehensive code review                      |
| `sprint-hotfix.md`                    | `/sprint-hotfix`                    | Rapid remediation on feature branches          |
| `sprint-retro.md`                     | `/sprint-retro`                     | Retrospective from ticket graph                |
| `sprint-close.md`                     | `/sprint-close`                     | Final merge, tag release, close Epic           |

### Utility Workflows

| Workflow                       | Slash Command                | Purpose                                   |
| ------------------------------ | ---------------------------- | ----------------------------------------- |
| `bootstrap-agent-protocols.md` | `/bootstrap-agent-protocols` | Initialize repo labels and project fields |
| `git-commit-all.md`            | `/git-commit-all`            | Stage and commit all changes              |
| `delete-epic-branches.md`      | `/delete-epic-branches`      | Hard reset: delete Epic branches          |
| `delete-epic-tickets.md`       | `/delete-epic-tickets`       | Hard reset: clear Epic child issues       |
| `run-red-team.md`              | `/run-red-team`              | Adversarial security testing              |

---

## Orchestration Engine

### Provider Architecture

All ticketing operations are mediated through the `ITicketingProvider` abstract
interface. The framework ships with a **GitHub provider** using raw `fetch()`
(Node 20+) — no external SDK dependencies.

Execution operations (branch creation, script dispatch) are mediated through the
`IExecutionAdapter` interface, decoupling business logic from the shell.

#### Orchestration SDK (`scripts/lib/orchestration/`)

Epic 71 introduced a typed, reusable SDK that centralizes orchestration logic.
All CLI scripts and the MCP server are **thin wrappers** that delegate to it:

| Module               | Exports                                               |
| -------------------- | ----------------------------------------------------- |
| `index.js`           | Barrel — re-exports all SDK functions                 |
| `dispatcher.js`      | `buildDAG`, `computeWave`, `renderManifestMarkdown`   |
| `context-hydrator.js`| `hydrateContext`, `assemblePrompt`                    |
| `ticketing.js`       | `transitionTicketState`, `cascadeCompletion`          |

#### Entry Points

| Entry Point           | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `mcp-orchestration.js`| **MCP Server** — exposes SDK functions as native agentic tools   |
| `dispatcher.js`       | CLI wrapper — `node dispatcher.js --epic N [--dry-run]`          |
| `context-hydrator.js` | CLI wrapper — `node context-hydrator.js --task N --epic N`       |
| `update-ticket-state.js`| CLI wrapper — `node update-ticket-state.js --task N --state S` |

#### Provider Layer

| Layer                 | File                                | Purpose                                        |
| --------------------- | ----------------------------------- | ---------------------------------------------- |
| Abstract Interface    | `scripts/lib/ITicketingProvider.js` | 10-method contract for all ticketing providers |
| Provider Factory      | `scripts/lib/provider-factory.js`   | Resolves `orchestration.provider` → class      |
| GitHub Implementation | `scripts/providers/github.js`       | REST + GraphQL implementation for GitHub       |
| Config Resolver       | `scripts/lib/config-resolver.js`    | AJV schema validation + .env auto-loader       |

### Scripts Reference

| Script                         | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `bootstrap-agent-protocols.js` | Idempotent setup of GitHub labels and project fields                         |
| `epic-planner.js`              | Autonomous PRD and Tech Spec generation                                      |
| `ticket-decomposer.js`         | Recursive 4-tier hierarchy decomposition                                     |
| `mcp-orchestration.js`         | **MCP Server** — exposes dispatch, hydration, and state tools to agents      |
| `dispatcher.js`                | CLI wrapper — DAG scheduler; outputs dispatch manifest with progress tracking|
| `context-hydrator.js`          | CLI wrapper — assembles self-contained agent prompts from ticket graph       |
| `sprint-story-init.js`         | Initializes story execution, manages branches, and handles dependencies      |
| `sprint-story-close.js`        | Finalizes story execution, merges branches, and cascades completions         |
| `sprint-close.js`              | Automates Epic closure, validates documentation freshness, and tags releases |
| `update-ticket-state.js`       | CLI wrapper — label-based state machine with `cascadeCompletion`             |
| `delete-epic.js`               | Recursive issue deletion/clearing via GraphQL                                |
| `notify.js`                    | Operator notification (mentions + webhooks)                                  |
| `verify-prereqs.js`            | Validates task dependencies before execution                                 |
| `lint-baseline.js`             | Lint baseline ratchet — prevents new warnings                                |
| `generate-roadmap.js`          | Auto-renders `docs/roadmap.md` from live Epics                               |
| `diagnose-friction.js`         | Analyzes friction logs for patterns                                          |
| `detect-merges.js`             | Detects and reports merge conflicts                                          |
| `git-commit-if-changed.js`     | Conditional commit utility                                                   |
| `audit-orchestrator.js`        | Automated, gate-based static analysis and audit runner                       |
| `handle-approval.js`           | CI webhook listener for processing `/approve` commands on audit findings     |

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

| Priority | Method                       | Environment               |
| -------- | ---------------------------- | ------------------------- |
| 1        | GitHub MCP Server            | Agentic IDE (Antigravity) |
| 2        | `GITHUB_TOKEN` or `GH_TOKEN` | CI/CD, background scripts |
| 3        | `gh auth token` (CLI)        | Local developer workflow  |

### Required Token Permissions

**Fine-grained PATs (recommended):**

- `GitHub Projects (V2)`: Read & Write
- `Issues`: Read & Write
- `Metadata`: Read-only
- `Pull requests`: Read & Write

**Classic PATs:** `repo` + `project` (full control).

### Configuration

1. **Agentic IDE**: Ensure the `github-mcp-server` is active in the session.
1. **Background scripts**: Set `GITHUB_TOKEN` in your environment or `.env` file
   at the project root.
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
