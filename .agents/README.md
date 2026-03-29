# Agent Protocols — User Guide

This is the `.agents/` bundle distributed to your project via Git submodule. It
contains everything your AI coding agents need to operate with strict quality,
consistency, and architectural guardrails.

## 📂 What's Inside

```text
.agents/
├── VERSION                  # Current version of the protocols
├── config.json              # Standardized agent configurations
├── instructions.md          # MANDATORY: The consolidated system prompt
├── models.json              # Model selection and guidance for agentic workflows
├── tech-stack.json          # Project-specific technology choices and paths
├── personas/                # Role-specific behavior constraints (12 personas)
│   ├── architect.md
│   ├── devops-engineer.md
│   ├── engineer.md
│   ├── engineer-mobile.md
│   ├── engineer-web.md
│   ├── product.md
│   ├── project-manager.md
│   ├── qa-engineer.md
│   ├── security-engineer.md
│   ├── sre.md
│   ├── technical-writer.md
│   └── ux-designer.md
├── rules/                   # Modular domain-agnostic global rules
│   ├── api-conventions.md
│   ├── coding-style.md
│   ├── database-standards.md
│   ├── git-conventions.md
│   ├── security-baseline.md
│   ├── testing-standards.md
│   └── ui-copywriting.md
├── skills/                  # Tech-stack-specific guardrails (organized by category)
│   ├── frontend/
│   ├── backend/
│   ├── security/
│   ├── qa/
│   └── architecture/
├── templates/               # Sprint planning markdown templates
│   ├── prd-template.md
│   ├── sprint-playbook-template.md
│   ├── sprint-retro-template.md
│   ├── technical-spec-template.md
│   └── test-plan_template.md
└── workflows/               # Reusable single-command auto-registered workflows
    ├── accessibility-audit.md
    ├── plan-sprint.md
    └── ...
```

---

## 📂 Project Documentation Structure (`docs/`)

To ensure consistency across parallel agent execution, all projects using these
protocols MUST adhere to the following `docs/` folder structure:

```text
docs/
├── architecture.md          # Core system design and tech stack
├── data-dictionary.md       # Database schema and validation rules
├── roadmap.md               # High-level sprint goals and feature list
├── sprints/                 # Sprint-specific planning artifacts
│   └── sprint-[##]/
│       ├── prd.md           # Product Requirements (User Stories, ACs)
│       ├── tech-spec.md     # Technical Specification (implementation plan)
│       └── playbook.md      # Actionable tasks for AI agents
└── test-plans/              # Domain-specific QA test plans
    └── sprint-test-plans/   # Sprint-specific test plans
```

> [!IMPORTANT] Always verify the existence of these files before starting a new
> chat session. Use the `/plan-sprint` command to auto-generate the sprint
> folder and its contents.

---

## 📄 Templates (`templates/`)

Standardized markdown blueprints used by agents during the planning and testing
phases.

| File                          | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `prd-template.md`             | Product Requirements template with User Stories       |
| `technical-spec-template.md`  | Technical Specification template for schemas and APIs |
| `sprint-playbook-template.md` | Sprint Playbook template with Chat Session structure  |
| `test-plan_template.md`       | Dual-Purpose Test Plan for human/AI agent execution   |

---

## 📖 Global Instructions (`instructions.md`)

**CRITICAL:** This file is your agent's **System Prompt**. It contains the
foundational rules all agents must follow, including:

- **Persona Routing** — Auto-loading role-specific constraints.
- **Skill Activation** — Auto-discovering domain guardrails.
- **Documentation (Context7)** — Mandatory live doc retrieval.
- **Context First** — Reading project docs before proposing solutions.
- **Plan First** — Writing plan files before implementation.
- **Quality Assurance** — Tests, accessibility, and strict formatting.

> [!IMPORTANT] You MUST configure your AI tool (e.g., `.cursorrules`, Custom
> Instructions, or System Prompt settings) to load the full content of
> `instructions.md` as its primary system core.

---

## 🎭 Personas (`personas/`)

Personas constrain agent behavior to a specific role. When you tell your agent
to "Act as an Architect," it should load the corresponding file and follow its
rules strictly.

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

**Usage:** Reference the persona in your agent prompt:

> Act as an Architect. Review the proposed schema changes against
> `data-dictionary.md` and ensure they follow the constraints defined in your
> persona.

---

## 🤖 Model Selection & Guidance (`models.json`)

To optimize for cost, speed, and intelligence, agents should be assigned to
tasks based on the tiers defined in `models.json`. This ensures that expensive
"Thinking" models are reserved for complex architecture, while fast "Flash"
models handle repetitive updates.

### Model Categories

| Tier            | Focus                                               | Recommended Models                      |
| --------------- | --------------------------------------------------- | --------------------------------------- |
| **Architects**  | System design, complex bugs, multi-step planning    | Claude Opus 4.6, Gemini 3.1 Pro (High)  |
| **Workhorses**  | Feature execution, API integrations, unit tests     | Claude Sonnet 4.6, Gemini 3.1 Pro (Low) |
| **Sprinters**   | Rapid iteration, syntax fixes, boilerplate, linting | Gemini 3 Flash                          |
| **Specialists** | Privacy-restricted or local/custom environments     | GPT-OSS 120B                            |

### ⛓️ Chaining Guidance (Agentic Workflows)

For maximum efficiency, follow the **Planner-Executor-Reviewer** pattern:

1. **Planner (Architect):** Use a high-reasoning model (e.g., Claude Opus) to
   design the technical spec and execution plan.
2. **Executor (Workhorse):** Use a balanced model (e.g., Claude Sonnet) to
   implement the code changes based on the plan.
3. **Reviewer/Fixer (Sprinter):** Use a fast model (e.g., Gemini 3 Flash) to
   quickly iterate on compiler errors or perform linting sweeps.

---

## 🧩 Skills (`skills/`)

Skills are modular, tech-stack-specific guardrails that prevent common AI
mistakes. Each skill directory follows a standard structure:

```text
skills/<skill-name>/
├── SKILL.md        # Required — The core instruction file
├── scripts/        # Optional — Helper scripts and utilities
├── examples/       # Optional — Reference implementations
└── resources/      # Optional — Templates, assets, additional docs
```

### Available Skills

| Skill                           | Category       | Purpose                                               |
| ------------------------------- | -------------- | ----------------------------------------------------- |
| `sqlite-drizzle-expert`         | `backend`      | Enforces SQLite dialect for Drizzle ORM and Turso     |
| `cloudflare-hono-architect`     | `backend`      | Prevents Node.js module usage in edge Workers         |
| `cloudflare-queue-manager`      | `backend`      | Ensures idempotent, resilient queue consumer logic    |
| `stripe-billing-expert`         | `backend`      | Ensures idempotency keys and webhook signature checks |
| `astro-react-island-strategist` | `frontend`     | Maintains Astro/React island hydration boundaries     |
| `expo-react-native-developer`   | `frontend`     | Prevents DOM elements in React Native code            |
| `ui-accessibility-engineer`     | `frontend`     | Enforces Tailwind CSS and WCAG 2.1 AA compliance      |
| `zero-trust-security-engineer`  | `security`     | Enforces Zod validation and Clerk auth on all routes  |
| `secure-telemetry-logger`       | `security`     | Standardizes structured logging and PII stripping     |
| `resilient-qa-automation`       | `qa`           | Writes flake-free Playwright and Vitest tests         |
| `monorepo-path-strategist`      | `architecture` | Enforces workspace aliases and dependency boundaries  |
| `autonomous-coding-standards`   | `architecture` | Enforces structural rules for agent-protocols library |
| `conventional-commits-enforcer` | `architecture` | Validates commit messages against conventional specs  |

**Usage:** Skills are loaded automatically by agents that support the skill
discovery pattern, or you can reference them directly in prompts:

> Load the `sqlite-drizzle-expert` skill. I need to add a new table to the
> database.

---

## 🔄 Automated SDLC Workflow - `/plan-sprint`

We use **Dual-Track Agile** to plan the _next_ sprint while the current one is
being built, ensuring a continuous flow of high-quality, architecturally sound
features.

Instead of manual copy-pasting, we use a single slash command to trigger the
entire planning pipeline.

### How to use it

In your "Director's Chair" (PM chat), simply type:

```text
/plan-sprint [SPRINT_NUMBER]
```

### What it does (Sequential Automation)

1. **Product Discovery (`/generate-prd`)**:
   - Reads `roadmap.md` for the target sprint items.
   - Generates a strict **Product Requirements Document (PRD)** focusing on
     Problem Statements, User Stories, and Acceptance Criteria.
   - Saves to: `docs/sprints/sprint-[##]/prd.md`.

1. **Architecture Review (`/generate-tech-spec`)**:
   - Cross-references the PRD with `data-dictionary.md` and `architecture.md`.
   - Drafts an explicit **Technical Specification** mapping out Turso/Drizzle
     schema changes and Hono API routes.
   - Saves to: `docs/sprints/sprint-[##]/tech-spec.md`.

1. **Playbook Generation (`/generate-sprint-playbook`)**
   - Synthesizes the PRD and Tech Spec into an actionable **Sprint Playbook**.
   - Organizes tasks into **Chat Sessions** (Backend Foundation, Web/Mobile UI,
     QA Testing).
   - Assigns specific Models (Claude Opus, Sonnet, Gemini High/Flash) and Modes
     (Planning/Fast) to each task.
   - **Agent Notification Webhook**: Embeds a notification step into the agent
     execution protocol. If `AGENT_NOTIFICATION_WEBHOOK` is defined in the
     `AGENTS.md` file at the project root, agents will notify the webhook upon
     completing a playbook step.
   - Saves to: `docs/sprints/sprint-[##]/playbook.md`.

### 🛠️ Execution & Guardrails

- **Parallel Execution**: Once the Playbook is generated, developers can work on
  Frontend and QA tasks concurrently after the Backend Foundation (Chat
  Session 1) locks the API contracts.
- **Auto-Tracking**: Every task in the playbook includes instructions for the
  agent to check off its own progress `- [x]` in the `playbook.md` once
  complete.
- **Templates**: All generated documents adhere to the professional templates in
  `.agents/templates/`.

---

## 🔁 Workflows (`workflows/`)

Workflows are reusable, single-command audit prompts designed to be invoked as
slash commands in your IDE (e.g., `/architecture-audit`). Each workflow is
self-contained — it defines the agent's role, a read-only scan process, an
output template, and strict constraints so results are consistent across any
project.

### Available Workflows

| Workflow File                    | Category  | Slash Command                  | Output File                          | Purpose                                              |
| -------------------------------- | --------- | ------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| `architecture-audit.md`          | `audits`  | `/architecture-audit`          | `architecture-audit-results.md`      | Clean code, over-engineering & coupling review       |
| `clean-code-audit.md`            | `audits`  | `/clean-code-audit`            | `clean-code-audit-results.md`        | Maintainability and technical debt analysis          |
| `devops-audit.md`                | `audits`  | `/devops-audit`                | `devops-audit-results.md`            | CI/CD, DX tooling & infrastructure review            |
| `qa-audit.md`                    | `audits`  | `/qa-audit`                    | `qa-audit-results.md`                | Test coverage, test plans & mocking strategy review  |
| `seo-audit.md`                   | `audits`  | `/seo-audit`                   | `seo-audit-results.md`               | Traditional SEO + Generative Engine Optimization     |
| `accessibility-audit.md`         | `audits`  | `/accessibility-audit`         | `accessibility-audit-results.md`     | Lighthouse performance and accessibility audit       |
| `sre-audit.md`                   | `audits`  | `/sre-audit`                   | `sre-audit-results.md`               | Production release candidate readiness audit         |
| `security-audit.md`              | `audits`  | `/security-audit`              | `security-audit-results.md`          | Vulnerability scanning and OWASP alignment           |
| `performance-audit.md`           | `audits`  | `/performance-audit`           | `performance-audit-results.md`       | Deep architectural and stack-wide bottleneck review  |
| `privacy-audit.md`               | `audits`  | `/privacy-audit`               | `privacy-audit-results.md`           | PII data handling and privacy compliance audit       |
| `dependency-update-audit.md`     | `audits`  | `/dependency-update-audit`     | `dependency-update-audit-results.md` | Security and bloat auditing for dependencies         |
| `ux-ui-audit.md`                 | `audits`  | `/ux-ui-audit`                 | `ux-ui-audit-results.md`             | Design system consistency and UX reviews             |
| `generate-prd.md`                | `sdlc`    | `/generate-prd`                | `prd.md`                             | Generates PRD from roadmap items                     |
| `generate-tech-spec.md`          | `sdlc`    | `/generate-tech-spec`          | `tech-spec.md`                       | Generates Technical Spec from PRD                    |
| `generate-sprint-playbook.md`    | `sdlc`    | `/generate-sprint-playbook`    | `playbook.md`                        | Generates Sprint Playbook from PRD + Tech Spec       |
| `generate-release-notes.md`      | `sdlc`    | `/generate-release-notes`      | `release-notes.md`                   | Generates user-facing release notes from changelog   |
| `plan-sprint.md`                 | `sdlc`    | `/plan-sprint`                 | (Orchestrator)                       | Sequentially runs PRD, Tech Spec, and Playbook       |
| `run-test-plan.md`               | `testing` | `/run-test-plan`               | (Updates Test Plan)                  | Executes Playwright & SQL tests against a test plan  |
| `gather-sprint-context.md`       | `sprint`  | `/gather-sprint-context`       | (Context retrieval)                  | Centralized research/knowledge retrieval for sprints |
| `verify-sprint-prerequisites.md` | `sprint`  | `/verify-sprint-prerequisites` | (Pre-flight check)                   | Validates task dependencies before execution         |
| `finalize-sprint-task.md`        | `sprint`  | `/finalize-sprint-task`        | (Commit & notify)                    | Standardized validation, commit, and notification    |
| `plan-qa-testing.md`             | `sprint`  | `/plan-qa-testing`             | (Test plan generation)               | QA test data maintenance and test plan updates       |
| `sprint-code-review.md`          | `sprint`  | `/sprint-code-review`          | (Chat output)                        | Comprehensive code review of all sprint changes      |
| `sprint-retro.md`                | `sprint`  | `/sprint-retro`                | `retro.md`                           | Sprint retrospective and roadmap alignment           |

### Setting Up Slash Commands

Configure your IDE's custom commands (e.g., Cursor's `.cursorrules` slash
commands or Gemini's custom instructions) to point to these workflow files:

1. Create a slash command (e.g., `/architecture-audit`) in your IDE.
2. Set the prompt content to the full text of the corresponding workflow file.
3. Invoke it from anywhere in your project — the workflow is self-contained and
   requires no project-specific context to run.

> **Note:** The `accessibility-audit` workflow requires setting the
> `[TARGET_URL]` placeholder to your local dev server URL before running.

---

## ⚙️ Configuring your Agent

To fully activate these protocols, you MUST configure your AI agent (via
`.cursorrules`, custom instruction settings, or system prompt blocks) with the
content of **`instructions.md`**.

This file acts as the **System Core**, instructing the agent to:

1. **Ingest** the baseline rules.
2. **Route** to personas in `personas/`.
3. **Activate** guardrails from `skills/`.
4. **Use** Context7 MCP for live documentation.

---

## ⚡ Activation & Usage

Once the submodule is added to your project, follow these steps to activate the
protocols:

1. **Configure your AI tool** to load the full content of
   `.agents/instructions.md` as the **System Prompt**.
2. **Use personas** by telling the agent to "Act as [Role]" — it will look for
   the matching file in `.agents/personas/`.
3. **Activate skills** by referencing them by name or letting your agent
   auto-discover `SKILL.md` files in `.agents/skills/`.
4. **Run sprint planning** using the automated workflow
   `/plan-sprint [SPRINT_NUMBER]`.

> [!TIP] Refer to the root **`README.md`** of this repository for detailed
> update strategies via Bash, PowerShell, or `package.json` scripts.

---

## 🔒 Local Overrides

Developers can override protocol behavior for their specific machine without
polluting the shared `.agents/` repository.

- Create `.agents/instructions.local.md` to add personal rules (e.g., "Always
  use yarn", "My local db is on port 5433").
- These `*.local.*` files are automatically `gitignored`.
