# Antigravity Agent Protocol

You are operating within the Antigravity environment. Your behavior, technical
constraints, and operational context are governed by this central instruction
set. You MUST strictly adhere to the following rules:

---

## 1. System Guardrails & Initialization

### A. Persona Routing & Execution

When instructed to "Act as [Role/Persona]" (e.g., Architect, Engineer, QA), you
must immediately retrieve and strictly adopt the rules in:
`.agents/personas/[role].md`.

- **Fallback:** If the specific persona file is missing, default to
  `.agents/personas/engineer.md`.

### B. Skill Activation

When a task involves a specific domain (e.g., Turso/SQLite, Cloudflare Workers,
Stripe, Playwright), you MUST read the corresponding
`.agents/skills/[category]/[skill-name]/SKILL.md` file and apply its
constraints. Review the `examples/` directory within that skill before writing
code.

### C. Proactive Documentation (Context7 MCP)

You MUST use the Context7 MCP proactively to prevent hallucination.

- **Mandatory Usage:** For any code generation, project setup, or complex
  configuration using third-party libraries, resolve the library ID and fetch
  the latest official documentation **before** writing code. Do not ask for
  permission.

### D. Error Handling & Degradation

If any protocol file (Persona, Skill, or MCP) cannot be loaded, you MUST alert
the user using the following warning format before proceeding:

> ⚠️ **Agent Protocol Warning**
>
> - **Missing:** `[file or tool]`
> - **Impact:** [Description]
> - **Fallback:** [Description]

### E. Local Overrides

If a `.agents/instructions.local.md` file or `.agents/config.local.json` is
present, you MUST load them. They contain personal developer preferences and
environment variables that override project defaults. Do not modify these local
files unless requested.

### F. Modular Global Rules

Before writing code, verify if any domain-agnostic rules apply by checking the
`.agents/rules/` directory (e.g., `coding-style.md`).

### G. Structured Configuration

Refer to `.agents/config.json` to understand your operational limits (e.g.,
allowed auto-run permissions, default personas). Refer to `.agents/models.json`
for model selection guidance when self-assigning models to tasks. Refer to
`.agents/tech-stack.json` for the project's specific technology choices
(database, ORM, API framework, auth provider, validation library, workspace
paths).

---

## 2. Core Philosophy

1. **Context First:** Before proposing any solution, read the repository's core
   documentation (`README.md`, `architecture.md`, `data-dictionary.md`) to
   understand the tech stack and monorepo structure.
2. **Plan First:** For non-trivial tasks (3+ steps or architectural decisions),
   enter **Plan Mode**. Generate a `docs/sprints/sprint-[##]/tech-spec.md` or
   `docs/architecture.md` file outlining the approach before touching code.
3. **Artifacts over Chat:** Create log files for test results, build outputs, or
   debug sessions rather than pasting large code blocks in chat.
4. **Idempotency:** Ensure scripts and commands can be run multiple times
   without breaking the environment.
5. **Security First:** Never hardcode secrets. Use environment variables and
   validate with secret scanning tools.

---

## 3. Execution & Quality Discipline

- **Re-Plan on Failure:** If a strategy fails, **STOP** and re-plan immediately.
  Do not repeat a broken approach.
- **Subagent Strategy:** Use subagents liberally for research, exploration, or
  parallel analysis to keep the main context window focused. One objective per
  subagent.
- **Quality Standards:**
  - UI components must pass accessibility scans (WCAG 2.1 AA).
  - Adhere strictly to project linters and formatters.
  - No commented-out code snippets in final deliverables.
- **Verification:** Include explicit verification steps in every plan.
