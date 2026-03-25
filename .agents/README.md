# Agent Protocols — User Guide (1.0.0)

This is the `.agents/` bundle distributed to your project via Git submodule. It
contains everything your AI coding agents need to operate with strict quality,
consistency, and architectural guardrails.

## 📂 What's Inside

```text
.agents/
├── VERSION                  # Current version of the protocols
├── instructions.md          # Global rules every agent must follow
├── system-prompt.md         # Template for your agent's system configuration
├── personas/                # Role-specific behavior constraints
│   ├── architect.md
│   ├── engineer.md
│   ├── product.md
│   └── sre.md
├── skills/                  # Tech-stack-specific guardrails
│   ├── sqlite-drizzle-expert/
│   ├── cloudflare-hono-architect/
│   ├── cloudflare-queue-manager/
│   ├── zero-trust-security-engineer/
│   ├── astro-react-island-strategist/
│   ├── expo-react-native-developer/
│   ├── monorepo-path-strategist/
│   ├── resilient-qa-automation/
│   ├── stripe-billing-expert/
│   ├── ui-accessibility-engineer/
│   ├── conventional-commits-enforcer/
│   ├── autonomous-coding-standards/
│   └── secure-telemetry-logger/
├── sdlc/                    # Sprint planning workflows and templates
│   ├── planning-workflow.md
│   └── spec-templates/
│       ├── prd-template.md
│       ├── sprint-playbook-template.md
│       └── technical-spec-template.md
└── workflows/               # Reusable single-command audit workflows
    ├── architecture-audit.md
    ├── devops-audit.md
    ├── quality-audit.md
    ├── seo-audit.md
    ├── accessibility-audit.md
    └── sre-audit.md
```

---

## 📖 Global Instructions (`instructions.md`)

The foundational rules all agents must follow regardless of persona or task.
Covers:

- **Context First** — Agents must read project docs before proposing solutions.
- **Plan First** — Non-trivial tasks require a written plan before
  implementation.
- **Execution Discipline** — Re-plan on failure; include verification steps.
- **Quality Assurance** — Write tests, enforce accessibility, respect linters.
- **Persona Adherence** — When adopting a role, follow the persona's constraint
  file strictly.

Configure your AI tool to load this file on every interaction.

---

## 🎭 Personas (`personas/`)

Personas constrain agent behavior to a specific role. When you tell your agent
to "Act as an Architect," it should load the corresponding file and follow its
rules strictly.

| File           | Role        | Focus                                                 |
| -------------- | ----------- | ----------------------------------------------------- |
| `architect.md` | Architect   | System design, schemas, API contracts, security       |
| `engineer.md`  | Engineer    | Implementation, TypeScript, Zod validation, testing   |
| `product.md`   | Product Mgr | UX flows, accessibility, acceptance criteria, roadmap |
| `sre.md`       | SRE         | Testing, CI/CD, caching, performance, infrastructure  |

**Usage:** Reference the persona in your agent prompt:

> Act as an Architect. Review the proposed schema changes against
> `data-dictionary.md` and ensure they follow the constraints defined in your
> persona.

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

| Skill                           | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `sqlite-drizzle-expert`         | Enforces SQLite dialect for Drizzle ORM and Turso     |
| `cloudflare-hono-architect`     | Prevents Node.js module usage in edge Workers         |
| `cloudflare-queue-manager`      | Ensures idempotent, resilient queue consumer logic    |
| `zero-trust-security-engineer`  | Enforces Zod validation and Clerk auth on all routes  |
| `astro-react-island-strategist` | Maintains Astro/React island hydration boundaries     |
| `expo-react-native-developer`   | Prevents DOM elements in React Native code            |
| `monorepo-path-strategist`      | Enforces workspace aliases and dependency boundaries  |
| `resilient-qa-automation`       | Writes flake-free Playwright and Vitest tests         |
| `stripe-billing-expert`         | Ensures idempotency keys and webhook signature checks |
| `ui-accessibility-engineer`     | Enforces Tailwind CSS and WCAG 2.1 AA compliance      |

**Usage:** Skills are loaded automatically by agents that support the skill
discovery pattern, or you can reference them directly in prompts:

> Load the `sqlite-drizzle-expert` skill. I need to add a new table to the
> database.

---

## 🔄 SDLC Workflows (`sdlc/`)

The SDLC module defines a structured, multi-phase workflow for AI-driven
software development using Dual-Track Agile.

### Planning Workflow (`planning-workflow.md`)

A step-by-step guide for sprint planning with AI agents:

1. **Scope Selection** — Human picks features from the roadmap.
2. **PRD Generation** — AI Product Manager writes requirements.
3. **Architecture Review** — AI Architect maps PRD to schemas and APIs.
4. **Playbook Generation** — AI generates a sequenced sprint execution plan with
   persona assignments, model routing, and task scoping rules.

### Spec Templates (`spec-templates/`)

Ready-to-use markdown templates for sprint documentation:

| Template                      | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| `prd-template.md`             | Product Requirements Document structure          |
| `technical-spec-template.md`  | Technical specification with schema and API defs |
| `sprint-playbook-template.md` | Sprint execution plan with task checkboxes       |

**Usage:** Feed these templates into your planning sessions:

> Act as the Product Manager. Using the PRD template, generate a PRD for Sprint
> 23 based on the items in `roadmap.md`.

---

## 🔁 Workflows (`workflows/`)

Workflows are reusable, single-command audit prompts designed to be invoked as
slash commands in your IDE (e.g., `/architecture-audit`). Each workflow is
self-contained — it defines the agent's role, a read-only scan process, an
output template, and strict constraints so results are consistent across any
project.

### Available Workflows

| Workflow File            | Slash Command          | Output File             | Purpose                                            |
| ------------------------ | ---------------------- | ----------------------- | -------------------------------------------------- |
| `architecture-audit.md`  | `/architecture-audit`  | `architecture-audit.md` | Clean code, over-engineering & coupling review     |
| `devops-audit.md`        | `/devops-audit`        | `devops-audit.md`       | CI/CD, DX tooling & infrastructure review          |
| `quality-audit.md`       | `/quality-audit`       | `quality-audit.md`      | Test coverage, flakiness & mocking strategy review |
| `seo-audit.md`           | `/seo-audit`           | `seo-audit.md`          | Traditional SEO + Generative Engine Optimization   |
| `accessibility-audit.md` | `/accessibility-audit` | `performance-audit.md`  | Lighthouse performance audit & optimization loop   |
| `sre-audit.md`           | `/sre-audit`           | `release-audit.md`      | Production release candidate readiness audit       |

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

To fully activate these protocols, you should configure your AI agent (via
`.cursorrules`, `GEMINI.md`, or your tool's "System Instructions") with the
content of **`system-prompt.md`**.

This "Meta-Prompt" instructs the agent to:

1. **Ingest** the baseline rules from `instructions.md`.
2. **Route** to the correct persona in `personas/` when asked.
3. **Activate** domain-specific guardrails from `skills/`.
4. **Use** Context7 MCP for live documentation retrieval.

---

## ⚡ Quick Start

1. **Add the submodule** to your project (one-time setup):

   ```bash
   git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents
   ```

2. **Configure your AI tool** to load `.agents/instructions.md` on every
   session.

3. **Use personas** by telling the agent to "Act as [Role]" — it will look for
   the matching file in `.agents/personas/`.

4. **Activate skills** by referencing them by name or letting your agent
   auto-discover `SKILL.md` files in `.agents/skills/`.

5. **Run sprint planning** using the workflow in
   `.agents/sdlc/planning-workflow.md` with the spec templates.

6. **Stay updated** — periodically pull the latest:

   ```bash
   git submodule update --remote .agents
   ```
