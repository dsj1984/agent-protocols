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

If a `.agents/instructions.local.md` file or `.agents/config/config.local.json`
is present, you MUST load them. They contain personal developer preferences and
environment variables that override project defaults. Do not modify these local
files unless requested.

### F. Modular Global Rules

Before writing code, verify if any domain-agnostic rules apply by checking the
`.agents/rules/` directory (e.g., `coding-style.md`).

### G. Structured Configuration

Refer to `.agents/config/config.json` to understand your operational limits
(e.g., allowed auto-run permissions, default personas). Refer to
`.agents/config/models.json` for model selection guidance when self-assigning
models to tasks. Refer to `.agents/config/tech-stack.json` for the project's
specific technology choices (database, ORM, API framework, auth provider,
validation library, workspace paths).

### H. Observability & Agent Friction Logging

You MUST log telemetry about any operational difficulty or automation
opportunity you encounter into the current sprint's log file (e.g.,
`docs/sprints/sprint-[##]/agent-friction-log.json`) using JSON Lines (JSONL)
format. Append a structured entry if you experience:

- **Friction Point**: Consecutive tool validation errors, unrecoverable command
  or script execution failures, or ambiguity requiring explicit self-correction.
- **Automation Candidate**: Repetitive sequences of commands (check
  `frictionThresholds.repetitiveCommandCount` in `.agents/config/config.json`,
  default 3+), boilerplate-heavy file creations, or manual processes that could
  be simplified by a dedicated workflow or skill.

### I. Anti-Thrashing Protocol

You MUST proactively identify when you are "thrashing" or stuck in an infinite
loop. If you satisfy either of the following conditions, you MUST immediately
stop, summarize the blockers, and present a **Re-Plan** or yield to the user:

- **Error Threshold**: You execute multiple consecutive tools that return errors
  (check `frictionThresholds.consecutiveErrorCount` in
  `.agents/config/config.json`, default 3).
- **Stagnation Threshold**: You perform consecutive steps of research or
  analysis without modifying a file (check
  `frictionThresholds.stagnationStepCount` in `.agents/config/config.json`,
  default 5), excluding setup/scaffolding tasks.

This protocol ensures the conversation remains focused and avoids consuming
unnecessary tokens on failing strategies.

---

## 2. Shell & Terminal Protocol (Windows Compatibility)

When operating on a Windows environment (PowerShell), agents MUST use `;` as a
statement separator for command chaining instead of `&&`, as common PowerShell
versions (like 5.1) do not support the latter and will throw a parser error.

- **Example:** `git add . ; git commit -m "..."`

This ensures that any project using these protocols stays compatible across
environments without needing manual command corrections.

---

## 3. Core Philosophy

1. **Context First:** Before proposing any solution, read the repository's core
   documentation (`README.md`, `architecture.md`, `data-dictionary.md`,
   `decisions.md`, `patterns.md`) to understand the tech stack, historical
   context, established patterns, and monorepo structure.
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

## 4. Execution & Quality Discipline

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

---

## 5. Git & Sprint Protocol (Strict Standards)

To maintain a clean and readable repository history, you MUST follow these
strict conventions for all sprint-related Git operations:

### A. Task Branch Naming

All task work MUST occur on an isolated feature branch created from the current
sprint branch (sprint-[XXX]).

- **Format**: `task/sprint-[XXX]/[ID]`
- **Example**: `task/sprint-040/40.2.1`
- **Constraint**: Do NOT use dashes or underscores between the sprint number and
  task ID unless they are part of the ID itself. Always prefix with `task/`.

### B. Status Tracking & Commit Standards

Administrative commits (e.g., updating task status in the playbook) MUST use a
deterministic format to allow for easy filtering and squashing.

- **Standard Template**: `chore(sprint): update task [ID] status to [STATUS]`
- **Valid Statuses**: `executing`, `committed`, `complete`
- **Constraint**: Never combine status updates for multiple tasks into a single
  commit unless specifically instructed. Do not omit the task ID or the word
  "task".

### C. Tracking File Decoupling

To avoid merge conflicts on shared tracking files:

1.  When updating a task status, you MUST check if a `task-state/` directory
    exists in the sprint folder.
2.  If it exists, write your status update to a dedicated file:
    `docs/sprints/sprint-[XXX]/task-state/[ID].json` instead of editing the main
    `playbook.md file directly.
3.  The `sprint-integration` workflow will periodically consolidate these state
    files into the master playbook.

### D. History Hygiene

Prioritize a clean `sprint-[XXX]` branch. Feature branches should be merged
using `--no-ff` or squashed if appropriate, as governed by the
`sprint-integration` workflow.

---

## 6. Workspace & File Hygiene (Temporary Files)

To keep the repository clean and avoid polluting the Git history:

- **Root Temp Directory**: All temporary files, scratch scripts, or intermediate
  outputs MUST be stored in the `/temp/` directory located at the workspace
  root.
- **Git Exclusion**: The `/temp/` directory is excluded from Git by default. Do
  NOT commit any files stored within it.
