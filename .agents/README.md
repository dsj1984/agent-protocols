# Agent Protocols — User Guide

This is the `.agents/` bundle distributed to your project via Git submodule. It
contains everything your AI coding agents need to operate with strict quality,
consistency, and architectural guardrails.

## 📋 Table of Contents

- [What's Inside](#whats-inside)
- [Global Instructions](#global-instructions)
- [Personas](#personas)
- [Rules](#rules)
- [Skills](#skills)
- [Workflows](#workflows)
- [Templates](#templates)
- [Tooling & Configuration](#tooling-configuration)

---

## <a id="whats-inside"></a>📂 What's Inside

```text
.agents/
├── VERSION                  # Current version of the protocols
├── SDLC.md                  # Detailed guide for the /plan-sprint workflow
├── config/                  # Standardized agent configurations
├── instructions.md          # MANDATORY: The consolidated system prompt
├── personas/                # Role-specific behavior constraints
├── rules/                   # Modular domain-agnostic global rules
├── sample-docs/             # Reference samples for PRDs, specs, and roadmaps
├── schemas/                 # JSON Schemas for structured agent output
├── scripts/                 # Deterministic scaffolding and utility scripts
├── skills/                  # Tech-stack-specific guardrails
├── templates/               # Sprint planning markdown templates
└── workflows/               # Reusable single-command workflows
```

---

## <a id="global-instructions"></a>📖 Global Instructions (`instructions.md`)

**CRITICAL:** This file is your agent's **System Prompt**. It contains the
foundational rules all agents must follow, including Persona Routing, Skill
Activation, and mandatory Documentation retrieval.

- **Persona Routing** — Auto-loading role-specific constraints.
- **Skill Activation** — Auto-discovering domain guardrails.
- **Documentation (Context7)** — Mandatory live doc retrieval.
- **Context First** — Reading project docs before proposing solutions.
- **Plan First** — Writing plan files before implementation.
- **Windows Compatibility** — Ensuring shell command portability via `;`.
- **Quality Assurance** — Tests, accessibility, and strict formatting.

> [!IMPORTANT] You MUST configure your AI tool (e.g., `.cursorrules`, Custom
> Instructions, or System Prompt settings) to load the full content of
> `instructions.md` as its primary system core.

### ⚙️ Configuring your Agent

To fully activate these protocols, you MUST configure your AI agent (via
`.cursorrules`, custom instruction settings, or system prompt blocks) with the
content of **`instructions.md`**.

This file acts as the **System Core**, instructing the agent to:

1. **Ingest** the baseline rules.
2. **Route** to personas in `personas/`.
3. **Activate** guardrails from `skills/`.
4. **Use** Context7 MCP for live documentation.

### ⚡ Activation & Usage

Once the submodule is added to your project, follow these steps:

1. **Configure your AI tool** to load `.agents/instructions.md` as the **System
   Prompt**.
2. **Use personas** by telling the agent to "Act as [Role]" — it will look for
   the matching file in `.agents/personas/`.
3. **Activate skills** by referencing them by name or letting your agent
   auto-discover `SKILL.md` files in `.agents/skills/`.
4. **Run sprint planning** using the automated workflow `/plan-sprint [SPRINT]`.

### 🔒 Local Overrides

Developers can override protocol behavior for their specific machine by creating
`.agents/instructions.local.md` (for rules) or
`.agents/config/config.local.json` (for config). These files are automatically
`gitignored`.

---

### 🛡️ Efficiency & Guardrails

To prevent agents from getting stuck in analysis loops or performing excessively
long tasks, the following guardrails are enforced:

- **Anti-Thrashing Protocol**: Mandates that an agent MUST halt, summarize its
  blockers, and present a **Re-Plan** if it hits 3 consecutive tool errors OR
  performs 5 steps of analysis without modifying a file.
- **Complexity Ceilings (Instruction Density)**: Limits the number of logical
  steps/bullet points in a task's instructions to ensure agents remain within a
  stable cognitive context.
  - **Configurability**: Controlled by `maxInstructionSteps` in
    `.agents/config/config.json` (Default: 5).

---

## <a id="personas"></a>🎭 Personas (`personas/`)

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

## <a id="rules"></a>⚖️ Rules (`rules/`)

Modular, domain-agnostic global rules that define behavioral standards.

| File                    | Domain          | Purpose                                               |
| ----------------------- | --------------- | ----------------------------------------------------- |
| `api-conventions.md`    | API             | RESTful standards, status codes, and JSON patterns    |
| `coding-style.md`       | Generic         | Clean code standards and file structure conventions   |
| `database-standards.md` | Database        | Migration safety, naming, and indexing strategies     |
| `git-conventions.md`    | Version Control | Branching strategy and PR quality standards           |
| `security-baseline.md`  | Security        | OWASP basics, credential safety, and encryption rules |
| `testing-standards.md`  | Quality         | Coverage thresholds and unit testing philosophy       |
| `ui-copywriting.md`     | UX              | Content tone, error messaging, and labeling standards |

---

## <a id="skills"></a>🧩 Skills (`skills/`)

Skills are modular, tech-stack-specific guardrails organized by category
(architecture, backend, devops, frontend, qa, security):

| Skill                           | Category       | Purpose                                               |
| ------------------------------- | -------------- | ----------------------------------------------------- |
| `autonomous-coding-standards`   | `architecture` | Enforces structural rules for agent-protocols library |
| `autonomous-coding-standards`   | `architecture` | Enforces structural rules for agent-protocols library |
| `markdown`                      | `architecture` | Enforces markdown styling and best practices          |
| `monorepo-path-strategist`      | `architecture` | Enforces workspace aliases and dependency boundaries  |
| `structured-output-zod`         | `architecture` | Enforces structured API responses using Zod           |
| `subagent-orchestration`        | `architecture` | Defines subagent task delegation strategies           |
| `git-flow-specialist`           | `devops`       | Zero-tolerance branch safety and emergency recovery   |
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
| `ui-accessibility-engineer`     | `frontend`     | Enforces Tailwind CSS and WCAG 2.1 AA compliance      |
| `audit-accessibility`           | `qa`           | WCAG automated scanning compliance                    |
| `playwright`                    | `qa`           | Rules for writing robust Playwright E2E tests         |
| `resilient-qa-automation`       | `qa`           | Writes flake-free Playwright and Vitest tests         |
| `vitest`                        | `qa`           | Unit test automation with Vitest                      |
| `secure-telemetry-logger`       | `security`     | Standardizes structured logging and PII stripping     |
| `zero-trust-security-engineer`  | `security`     | Enforces Zod validation and Clerk auth on all routes  |

---

## <a id="workflows"></a>🔁 Workflows (`workflows/`)

Workflows are reusable, single-command audit prompts designed to be invoked as
slash commands in your IDE (e.g., `/architecture-audit`).

### 🔄 Automated SDLC Workflow

We use a deterministic planning pipeline for sprint generation. See
**[SDLC.md](./SDLC.md)** for detailed instructions on the `/plan-sprint`
command.

### Available Workflows

| Workflow File                         | Category  | Slash Command                       | Purpose                                                          |
| ------------------------------------- | --------- | ----------------------------------- | ---------------------------------------------------------------- |
| `audit-accessibility.md`              | `audits`  | `/audit-accessibility`              | Lighthouse performance and accessibility audit                   |
| `audit-architecture.md`               | `audits`  | `/audit-architecture`               | Clean code, over-engineering & coupling review                   |
| `audit-clean-code.md`                 | `audits`  | `/audit-clean-code`                 | Maintainability and technical debt analysis                      |
| `audit-dependency-update.md`          | `audits`  | `/audit-dependency-update`          | Security and bloat auditing for dependencies                     |
| `audit-devops.md`                     | `audits`  | `/audit-devops`                     | CI/CD, DX tooling & infrastructure review                        |
| `audit-performance.md`                | `audits`  | `/audit-performance`                | Stack-wide bottleneck and architecture review                    |
| `audit-privacy.md`                    | `audits`  | `/audit-privacy`                    | PII data handling and privacy compliance audit                   |
| `audit-qa.md`                         | `audits`  | `/audit-qa`                         | Test coverage, test plans & mocking strategy review              |
| `audit-security.md`                   | `audits`  | `/audit-security`                   | Vulnerability scanning and OWASP alignment                       |
| `audit-seo.md`                        | `audits`  | `/audit-seo`                        | Traditional SEO + Generative Engine Optimization                 |
| `audit-sre.md`                        | `audits`  | `/audit-sre`                        | Production release candidate readiness audit                     |
| `audit-ux-ui.md`                      | `audits`  | `/audit-ux-ui`                      | Design system consistency and UX reviews                         |
| `sprint-roadmap-review.md`            | `sdlc`    | `/sprint-roadmap-review`            | analyze and decompose upcoming sprints in roadmap.md             |
| `sprint-generate-prd.md`              | `sdlc`    | `/sprint-generate-prd`              | Generates PRD from roadmap items                                 |
| `sprint-generate-tech-spec.md`        | `sdlc`    | `/sprint-generate-tech-spec`        | Generates Technical Spec from PRD                                |
| `sprint-generate-playbook.md`         | `sdlc`    | `/sprint-generate-playbook`         | Generates Sprint Playbook from PRD + Tech Spec                   |
| `generate-release-notes.md`           | `sdlc`    | `/generate-release-notes`           | Generates user-facing release notes from changelog               |
| `plan-sprint.md`                      | `sdlc`    | `/plan-sprint`                      | Sequentially runs PRD, Tech Spec, and Playbook                   |
| `run-test-plan.md`                    | `testing` | `/run-test-plan`                    | Executes Playwright & SQL tests against a test plan              |
| `sprint-gather-context.md`            | `sprint`  | `/sprint-gather-context`            | Centralized research/knowledge retrieval for sprints             |
| `sprint-verify-task-prerequisites.md` | `sprint`  | `/sprint-verify-task-prerequisites` | Validates task dependencies before execution                     |
| `sprint-finalize-task.md`             | `sprint`  | `/sprint-finalize-task`             | Standardized validation, commit, and notification                |
| `plan-qa-testing.md`                  | `sprint`  | `/plan-qa-testing`                  | QA test data maintenance and test plan updates                   |
| `sprint-code-review.md`               | `sprint`  | `/sprint-code-review`               | Comprehensive code review of all sprint changes                  |
| `sprint-integration.md`               | `sprint`  | `/sprint-integration`               | Merge and stabilization workflow                                 |
| `sprint-close-out.md`                 | `sprint`  | `/sprint-close-out`                 | Final merge to main, branch cleanup, and release tagging         |
| `sprint-retro.md`                     | `sprint`  | `/sprint-retro`                     | Sprint retrospective, action item capture, and roadmap alignment |

---

## <a id="templates"></a>📄 Templates (`templates/`)

Standardized markdown blueprints used during planning and testing.

| File                          | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `prd-template.md`             | Product Requirements template with User Stories       |
| `sprint-playbook-template.md` | Sprint Playbook template with Chat Session structure  |
| `sprint-retro-template.md`    | Sprint Retrospective template for post-sprint review  |
| `technical-spec-template.md`  | Technical Specification template for schemas and APIs |
| `test-plan_template.md`       | Dual-Purpose Test Plan for human/AI agent execution   |

---

## <a id="tooling-configuration"></a>🛠️ Tooling & Configuration

Supporting files that define the agent's environment and workspace standards.

| Path                           | Type   | Purpose                                            |
| ------------------------------ | ------ | -------------------------------------------------- |
| `config/config.json`           | Config | Core agent settings and defaults                   |
| `config/models.json`           | Config | Model selection guidance (Tiered Architecture)     |
| `config/tech-stack.json`       | Config | Project-specific stack and path mapping            |
| `schemas/task-manifest.json`   | Schema | JSON Schema for validating sprint task graphs      |
| `scripts/generate-playbook.js` | Script | Deterministic logic for rendering sprint playbooks |
