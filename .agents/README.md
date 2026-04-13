# Agent Protocols — Consumer Reference

This is the detailed reference guide for teams consuming the Agent Protocols
framework via the `.agents/` Git submodule.

## Directory Layout

```text
.agents/
├── VERSION                  # Current version (5.4.2)
├── SDLC.md                  # End-to-end workflow guide
├── instructions.md          # MANDATORY: Primary system prompt
├── default-agentrc.json     # Copy to project root as .agentrc.json
├── personas/                # 12 role-specific behavior constraints
├── rules/                   # 8 domain-agnostic coding standards
├── schemas/                 # JSON Schemas for structured output validation
├── scripts/                 # v5 orchestration engine
│   ├── lib/                 # Core libraries
│   │   ├── orchestration/           # ★ Orchestration SDK
│   │   │   ├── index.js             # Barrel export: all SDK functions
│   │   │   ├── dispatcher.js        # DAG scheduling and wave computation
│   │   │   ├── manifest-builder.js  # Dispatch manifest data assembly
│   │   │   ├── model-resolver.js    # LLM tiering and routing fallback
│   │   │   ├── reconciler.js        # State reconciliation routines
│   │   │   ├── story-grouper.js     # Issue grouping by executable Story
│   │   │   ├── task-fetcher.js      # Upstream API issue retrieval
│   │   │   ├── context-hydrator.js  # Self-contained prompt assembly
│   │   │   ├── ticketing.js         # Ticket state machine + cascade logic
│   │   │   ├── dependency-analyzer.js # Cross-ticket dependency resolution
│   │   │   ├── ticket-validator.js  # Ticket structure validation
│   │   │   ├── planning-state-manager.js # Planning phase state tracking
│   │   │   ├── doc-reader.js        # Documentation file reader
│   │   │   └── telemetry.js         # Execution telemetry collection
│   │   ├── presentation/           # Manifest rendering layer
│   │   │   └── manifest-renderer.js # Dispatch manifest markdown generation
│   │   ├── mcp/                    # MCP tool registry
│   │   │   └── tool-registry.js    # Tool definitions and handlers
│   │   ├── ITicketingProvider.js    # Abstract ticketing contract
│   │   ├── IExecutionAdapter.js     # Abstract execution adapter interface
│   │   ├── config-resolver.js       # Unified config + .env loader + AJV validation
│   │   ├── provider-factory.js      # Resolves provider name → class
│   │   ├── adapter-factory.js       # Resolves adapter name → class
│   │   ├── Graph.js                 # DAG implementation for dependency resolution
│   │   ├── VerboseLogger.js         # Structured step-by-step execution logger
│   │   ├── Logger.js                # Centralized fatal/error logging
│   │   ├── git-merge-orchestrator.js  # Branch merge sequencing and conflict handling
│   │   ├── git-utils.js             # Git shell command utilities
│   │   ├── dependency-parser.js     # Parses `blocked by` syntax from ticket bodies
│   │   ├── label-taxonomy.js        # v5 label constants and taxonomy definitions
│   │   ├── friction-service.js      # Friction event detection and logging service
│   │   ├── maintainability-engine.js  # Per-file maintainability scoring
│   │   ├── maintainability-utils.js # Maintainability baseline utilities
│   │   ├── llm-client.js            # LLM API client (Gemini)
│   │   ├── refinement-agent.js      # Protocol refinement suggestion engine
│   │   ├── github-refinement-service.js # GitHub PR creation for refinements
│   │   ├── impact-tracker.js        # Tracks impact of applied refinements
│   │   ├── integration-verifier.js  # Integration candidate verification
│   │   ├── config-schema.js         # AJV schema for .agentrc.json validation
│   │   ├── env-loader.js            # .env file auto-loader
│   │   ├── cli-args.js              # CLI argument parsing utilities
│   │   ├── fs-utils.js              # File system utilities
│   │   └── task-utils.js            # Task normalization helpers
│   ├── mcp/                 # MCP tool implementations
│   │   ├── select-audits.js # Audit selection logic
│   │   └── run-audit-suite.js # Audit execution and result normalization
│   ├── providers/
│   │   └── github.js        # GitHub REST + GraphQL implementation
│   ├── adapters/            # Execution adapters (e.g., shell, MCP)
│   ├── mcp-orchestration.js # MCP Server entry point — exposes SDK as tools
│   └── [cli scripts…]       # Thin CLI wrappers delegating to the SDK
├── skills/                  # Two-tier skill library
│   ├── core/                # Universal process skills (20 skills)
│   └── stack/               # Tech-stack-specific guardrails (22 skills)
├── templates/               # Context hydration and CI templates
└── workflows/               # 24 slash-command workflows
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

Add the following to your MCP host settings (e.g.,
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-protocols": {
      "command": "node",
      "args": [
        "/absolute/path/to/your/project/.agents/scripts/mcp-orchestration.js"
      ],
      "env": {
        "GITHUB_TOKEN": "your_token_here",
        "GEMINI_API_KEY": "your_token_here",
        "NOTIFICATION_WEBHOOK_URL": "optional_webhook_url"
      }
    }
  }
}
```

> [!IMPORTANT] Always use **absolute paths** for the `args` array to ensure the
> server starts correctly regardless of where your agent is currently focused.

### 2. Authentication & Secrets

The MCP server resolves secrets in this priority:

1. **Host Environment**: Variables defined in the `env` block of your MCP
   config.
2. **Project `.env`**: Automatically loaded from your project root.
3. **External Tools**: Leverages the `github-mcp-server` if active in the same
   session.

### 3. Exposed Tools

| Tool                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `dispatch_wave`           | DAG-based dispatch; returns markdown manifest with progress    |
| `hydrate_context`         | Assembles a self-contained, fully hydrated execution prompt    |
| `transition_ticket_state` | Label-based state machine with close/reopen semantics          |
| `cascade_completion`      | Recursively propagates completion upward through the hierarchy |
| `post_structured_comment` | Posts progress, friction, or notification comments on tickets  |
| `select_audits`           | Analyzes ticket content to determine which audits to run       |
| `run_audit_suite`         | Executes audit workflows and normalizes findings               |

### 4. Debugging

If the server is configured but not appearing:

- Check the **stderr** logs in your MCP host.
- Success message: `[MCP] agent-protocols v5.4.2 server started`
- Failures: Initialization errors (missing dependencies, path issues) are logged
  before the server exits with code 1.

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

> [!NOTE] The stack skill count (22) includes skill directories with `SKILL.md`
> files. Some directories may contain additional context files alongside the
> skill definition.

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

| Workflow                | Slash Command         | Purpose                                        |
| ----------------------- | --------------------- | ---------------------------------------------- |
| `sprint-plan.md`        | `/sprint-plan`        | Autonomous PRD, Tech Spec, and task generation |
| `sprint-execute.md`     | `/sprint-execute`     | DAG dispatch (Epic) or task implementation     |
| `sprint-code-review.md` | `/sprint-code-review` | Comprehensive code review                      |
| `sprint-hotfix.md`      | `/sprint-hotfix`      | Rapid remediation on feature branches          |
| `sprint-retro.md`       | `/sprint-retro`       | Retrospective from ticket graph                |
| `sprint-close.md`       | `/sprint-close`       | Final merge, tag release, close Epic           |

### Utility Workflows

| Workflow                       | Slash Command                | Purpose                                   |
| ------------------------------ | ---------------------------- | ----------------------------------------- |
| `bootstrap-agent-protocols.md` | `/bootstrap-agent-protocols` | Initialize repo labels and project fields |
| `create-epic.md`               | `/create-epic`               | Create a well-structured Epic issue       |
| `git-commit-all.md`            | `/git-commit-all`            | Stage and commit all changes              |
| `git-push.md`                  | `/git-push`                  | Stage, commit, and push to remote         |
| `roadmap-sync.md`              | `/roadmap-sync`              | Sync ROADMAP.md from GitHub Epics         |
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

The SDK centralizes orchestration logic. All CLI scripts and the MCP server are
**thin wrappers** that delegate to it:

| Module                      | Exports                                         |
| --------------------------- | ----------------------------------------------- |
| `index.js`                  | Barrel — re-exports all SDK functions           |
| `dispatcher.js`             | `buildDAG`, `computeWave`, `resolveAndDispatch` |
| `context-hydrator.js`       | `hydrateContext`, `assemblePrompt`              |
| `ticketing.js`              | `transitionTicketState`, `cascadeCompletion`    |
| `dependency-analyzer.js`    | Cross-ticket dependency resolution              |
| `ticket-validator.js`       | Ticket structure and metadata validation        |
| `planning-state-manager.js` | Planning phase state tracking                   |
| `telemetry.js`              | Execution telemetry collection                  |

#### Entry Points

| Entry Point              | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `mcp-orchestration.js`   | **MCP Server** — exposes SDK functions as native agentic tools |
| `dispatcher.js`          | CLI wrapper — `node dispatcher.js --epic N [--dry-run]`        |
| `context-hydrator.js`    | CLI wrapper — `node context-hydrator.js --task N --epic N`     |
| `update-ticket-state.js` | CLI wrapper — `node update-ticket-state.js --task N --state S` |

#### Provider Layer

| Layer                 | File                                | Purpose                                   |
| --------------------- | ----------------------------------- | ----------------------------------------- |
| Abstract Interface    | `scripts/lib/ITicketingProvider.js` | Abstract ticketing contract               |
| Provider Factory      | `scripts/lib/provider-factory.js`   | Resolves `orchestration.provider` → class |
| GitHub Implementation | `scripts/providers/github.js`       | REST + GraphQL implementation for GitHub  |
| Config Resolver       | `scripts/lib/config-resolver.js`    | AJV schema validation + .env auto-loader  |

### Scripts Reference

| Script                               | Purpose                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `bootstrap-agent-protocols.js`       | Idempotent setup of GitHub labels and project fields                    |
| `epic-planner.js`                    | Autonomous PRD and Tech Spec generation                                 |
| `ticket-decomposer.js`               | Recursive 4-tier hierarchy decomposition                                |
| `mcp-orchestration.js`               | **MCP Server** — exposes dispatch, hydration, and state tools to agents |
| `dispatcher.js`                      | CLI wrapper — DAG scheduler; outputs dispatch manifest                  |
| `context-hydrator.js`                | CLI wrapper — assembles self-contained agent prompts                    |
| `sprint-story-init.js`               | Initializes Story execution: branches, deps, state transitions          |
| `sprint-story-close.js`              | Finalizes Story: merges to Epic branch, cascades completions            |
| `sprint-close.js`                    | Epic closure: doc freshness gate, version bump, tag release             |
| `sprint-code-review.js`              | Automated code review execution                                         |
| `update-ticket-state.js`             | CLI wrapper — label-based state machine with cascade                    |
| `delete-epic.js`                     | Recursive issue deletion/clearing via GraphQL                           |
| `notify.js`                          | Operator notification (mentions + webhooks)                             |
| `lint-baseline.js`                   | Lint baseline ratchet — prevents new warnings                           |
| `check-maintainability.js`           | Maintainability score computation and baseline check                    |
| `update-maintainability-baseline.js` | Updates the maintainability baseline after improvements                 |
| `generate-roadmap.js`                | Auto-renders `docs/ROADMAP.md` from live Epics                          |
| `diagnose-friction.js`               | Analyzes friction logs for patterns                                     |
| `health-monitor.js`                  | Push-based sprint health monitoring                                     |
| `detect-merges.js`                   | Detects and reports merge conflicts                                     |
| `audit-orchestrator.js`              | Automated, gate-based static analysis and audit runner                  |
| `handle-approval.js`                 | CI webhook listener for `/approve` commands on audit findings           |
| `auto-heal.js`                       | CI self-remediation — resolves risk tier and dispatches healing         |

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
      "projectOwner": null,
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
| `github.projectOwner`           | No       | Owner of the project board (defaults to `github.owner`) |
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

### Maintainability Ratchet

A per-file maintainability scoring engine computes composite scores based on
cyclomatic complexity, file length, and dependency counts. The
`maintainability-baseline.json` prevents score degradation between sprints.

### HITL Risk Gates

Deterministic safety checks force Human-In-The-Loop approval when an agent plans
destructive operations (e.g., `DROP TABLE`, `DELETE`).

### Friction Telemetry

Friction events (repetitive commands, consecutive errors, stagnation) are logged
as structured comments on the Task issue for post-hoc analysis.

---

## Auto-Heal (CI Self-Remediation)

Agent Protocols ships a governance-tiered CI self-remediation engine. When a CI
stage fails, the `auto-heal.js` script assembles an AI prompt from the error
logs, resolves the appropriate risk tier, and dispatches a healing session to
either the Jules API or a GitHub Issue — without ever blocking the pipeline.

### Configuration

Add an `autoHeal` block to your `.agentrc.json`:

```json
{
  "autoHeal": {
    "enabled": true,
    "adapter": "jules",
    "adapters": {
      "jules": {
        "apiKeyEnv": "JULES_API_KEY",
        "apiUrl": "https://jules.googleapis.com/v1alpha/sessions",
        "requirePlanApproval": true,
        "maxRetries": 3,
        "timeoutMs": 30000
      },
      "github-issue": {
        "labelPrefix": "auto-heal",
        "assignCopilot": false
      }
    },
    "stages": {
      "lint": {
        "riskTier": "green",
        "logArtifact": "lint-output.log",
        "allowedModifications": ["Any file flagged by linter output"],
        "forbiddenModifications": []
      },
      "typecheck": {
        "riskTier": "yellow",
        "logArtifact": "typecheck-output.log",
        "allowedModifications": ["Type annotations", "interface definitions"],
        "forbiddenModifications": ["Auth middleware", "seed data"]
      },
      "e2e": {
        "riskTier": "red",
        "logArtifact": "e2e-output.log",
        "allowedModifications": ["Playwright spec files", "page objects"],
        "forbiddenModifications": ["Auth middleware", "API route signatures"]
      }
    },
    "maxLogSizeBytes": 4000,
    "branchFilter": ["main"],
    "consolidateSession": true
  }
}
```

| Field                | Default    | Description                                               |
| -------------------- | ---------- | --------------------------------------------------------- |
| `enabled`            | `true`     | Master on/off switch                                      |
| `adapter`            | `"jules"`  | Active adapter (`"jules"` or `"github-issue"`)            |
| `stages`             | `{}`       | Per-stage risk tier, log artifact, and modification scope |
| `maxLogSizeBytes`    | `4000`     | Maximum log bytes per stage included in the prompt        |
| `branchFilter`       | `["main"]` | Branches that auto-heal is active on (informational)      |
| `consolidateSession` | `true`     | Bundle all failed stages into one session/issue           |

### Adapters

| Adapter        | Config Key                 | Description                                                    |
| -------------- | -------------------------- | -------------------------------------------------------------- |
| `jules`        | `adapters.jules`           | Dispatches to the Jules API v1alpha. Requires `JULES_API_KEY`. |
| `github-issue` | `adapters['github-issue']` | Creates a labeled GitHub Issue. Requires `GITHUB_TOKEN`.       |

### Risk Tier Reference

| Tier     | Emoji | `autoApprove` | Typical Stages         | Description                              |
| -------- | ----- | ------------- | ---------------------- | ---------------------------------------- |
| `green`  | 🟢    | `true`        | lint, formatting       | Low-risk fix; no plan approval needed    |
| `yellow` | 🟡    | `false`       | typecheck, unit tests  | Moderate risk; plan approval required    |
| `red`    | 🔴    | `false`       | e2e, build, migrations | High risk; full human review recommended |

The **highest-risk failed stage** determines the overall tier for the run.

### CI Integration

Copy `.agents/templates/ci-auto-heal-job.yml` into your GitHub Actions workflow
and customize the `needs`, `if`, and artifact download steps for your project.

### Slash Command

Use `/ci-auto-heal` to manually trigger the auto-heal pipeline from a local
conversation when the automated CI job did not fire. See
`workflows/ci-auto-heal.md` for the full step-by-step guide.

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
