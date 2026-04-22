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

The skill library uses a **two-tier architecture**:

- **`core/`** — Universal, process-driven skills that apply across any project
  (e.g., `core/debugging-and-error-recovery`, `core/test-driven-development`,
  `core/security-and-hardening`). Always check for a relevant core skill first.
- **`stack/`** — Tech-stack-specific skills for concrete libraries, services,
  and tools (e.g., `stack/backend/cloudflare-hono-architect`,
  `stack/frontend/tailwind-v4`, `stack/qa/playwright`). Apply these when the
  project uses that specific technology.

When a task involves a specific domain or technology, you MUST read the
corresponding `.agents/skills/[tier]/[category]/[skill-name]/SKILL.md` file and
apply its constraints. Review the `examples/` directory within that skill before
writing code. When uncertain which to apply, read `core/using-agent-skills` for
guidance on skill selection and sequencing.

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

#### MCP Tool Degradation

If `agent-protocols` MCP tools (`transition_ticket_state`, `cascade_completion`,
`post_structured_comment`) fail with connection errors (e.g.
`client is closing`, `invalid character`), you MUST fall back to the equivalent
CLI scripts immediately. Do **not** leave tickets in stale states:

```powershell
# transition_ticket_state fallback
node .agents/scripts/update-ticket-state.js --task <id> --state <state>

# cascade_completion is auto-triggered by the CLI when --state agent::done
```

### E. Local Overrides

If a `.agents/instructions.local.md` file or `.agentrc.local.json` is present,
you MUST load them. They contain personal developer preferences and environment
variables that override project defaults. Do not modify these local files unless
requested.

### F. Modular Global Rules

Before writing code or documentation, verify if any domain-agnostic rules apply:

- **Code:** Check the `.agents/rules/` directory (e.g., `coding-style.md`).
- **Domain/Design Constraints:** If a `docs/style-guide.md` is provided in the
  project, you MUST strictly adhere to its tone, UI copy constraints, layout
  specifications, and formatting. Do not hallucinate styles outside of this
  guide.

### G. Structured Configuration

Refer to `.agentrc.json` to understand your operational limits (e.g., allowed
auto-run permissions, default personas). Refer to the **Tech Stack** section of
`docs/architecture.md` for the project's specific technology choices (database,
ORM, API framework, auth provider, validation library, workspace paths).
Project-specific technology context is intentionally kept out of
`.agentrc.json`.

Model selection is intentionally **not** in config. The dispatcher emits a
binary `model_tier` per Story — `high` (deep-reasoning) or `low` (fast
execution) — derived from the `complexity::high` label. Pick any model that
matches the tier; concrete model choice is left to the operator or external
router.

### H. Observability & Agent Friction Logging

#### Friction Telemetry

You MUST log telemetry about any operational difficulty or automation
opportunity you encounter. Instead of local files, you MUST post friction
details directly to the relevant GitHub Task ticket:

- **Command**:
  `node .agents/scripts/diagnose-friction.js --epic [EPIC_ID] --task [TASK_ID] --cmd [FAILED_COMMAND]`
- **Friction Point**: Execute this script after consecutive tool validation
  errors, unrecoverable command failures, or ambiguity requiring explicit
  self-correction. The script will post a structured `friction` comment to the
  ticket and provide remediation steps.
- **Automation Candidate**: Manually log repetitive sequences of commands (check
  `frictionThresholds.repetitiveCommandCount` in `.agentrc.json`, default 3+),
  boilerplate-heavy file creations, or manual processes that could be simplified
  by a dedicated workflow or skill.

#### Verbose Interaction Logging

When `agentSettings.verboseLogging.enabled` is `true` in `.agentrc.json`, the
framework records **all agentic interactions and responses** as structured JSONL
files for post-hoc analysis (model evaluation, cost attribution, prompt
engineering, debugging).

- **Output Directory**: Resolved from `verboseLogging.logDir` (default:
  `temp/verbose-logs`). Each sprint produces a dedicated file
  (`sprint-[NUM].jsonl`).
- **What Is Logged**: Agent action dispatches, environment observations, errors,
  workflow phase transitions, integration events, and configuration resolution.
- **Schema**: Each line is a JSON object with `timestamp`, `level`, `category`,
  `source`, `sprint`, `taskId`, `message`, and an optional `data` payload.
- **Performance**: Verbose logging is designed to never crash the host process.
  If a write fails, it degrades silently to stderr.
- **Privacy**: The logs are stored in the configured `tempRoot` by default and
  are excluded from Git. Do NOT commit them unless explicitly instructed.

### I. Anti-Thrashing Protocol

You MUST proactively identify when you are "thrashing" or stuck in an infinite
loop. If you satisfy either of the following conditions, you MUST immediately
stop, summarize the blockers, and present a **Re-Plan** or yield to the user:

- **Error Threshold**: You execute multiple consecutive tools that return errors
  (check `frictionThresholds.consecutiveErrorCount` in `.agentrc.json`, default
  3).
- **Stagnation Threshold**: You perform consecutive steps of research or
  analysis without modifying a file (check
  `frictionThresholds.stagnationStepCount` in `.agentrc.json`, default 5),
  excluding setup/scaffolding tasks.

This protocol ensures the conversation remains focused and avoids consuming
unnecessary tokens on failing strategies.

### J. HITL Blocker Escalation (Safe Execution)

Before executing any task, you MUST check the ticket labels and instructions for
high-risk operations.

- **`risk::high` is metadata**: treat it as planning/audit signal only. It does
  **not** create an automatic runtime pause.
- **Single runtime pause point**: `agent::blocked` is the authoritative HITL
  gate. When execution encounters an unresolvable blocker or an unsafe
  destructive action without explicit authorization, transition to
  `agent::blocked`, summarize the blocker, and wait for operator resume.
- **Resume contract**: continue only after the operator explicitly unblocks
  (`agent::executing` or equivalent workflow instruction).
- **High-risk heuristic**: use `agentSettings.riskGates.heuristics` from
  `.agentrc.json` to decide when to escalate via `agent::blocked`. Typical
  triggers include destructive/irreversible data mutations, shared auth/security
  changes, CI/CD gate changes, monorepo-wide rewrites, and destructive schema
  migrations.

---

## 2. FinOps & Token Budgeting (Economic Guardrails)

To prevent runaway API costs, you MUST strictly adhere to the following FinOps
protocol:

### A. Token Tracking & Budgeting

- **Check Budget**: Before starting a task, resolve `maxTokenBudget` from
  `.agentrc.json`.
- **Active Monitoring**: You MUST track your token usage (input + output)
  provided by the LLM response metadata after every tool call.
- **Soft-Warning (80%)**: When usage reaches the threshold defined by
  `budgetWarningThreshold` (default 0.8), you MUST notify the user via a
  terminal message and trigger the configured notification webhook (resolved
  from the `NOTIFICATION_WEBHOOK_URL` env var or the `agent-protocols` MCP
  server entry in `.mcp.json`).
- **Hard-Stop (100%)**: If you reach `maxTokenBudget`, you MUST **STOP**
  immediately. You are forbidden from continuing until a human operator grants
  an explicit override via a status update or CLI flag.

### B. Cost-Aware Model Selection

- During the planning phase (`/plan-sprint`), the **Project Manager** and
  **Architect** personas MUST consider the economic impact of their task
  assignments.
- Use the `complexity::high` label sparingly. Only Stories that genuinely
  require deep reasoning (architectural design, multi-file refactors,
  non-trivial bugs) should carry it — everything else defaults to the `low`
  tier. The operator/router maps the tier to a concrete model at dispatch time.

---

## 3. Shell & Terminal Protocol (Windows Compatibility)

When operating on a Windows environment (PowerShell), agents MUST NOT use `&&`
as a statement separator, as common PowerShell versions (like 5.1) do not
support it and will throw a parser error.

- **Standard Separator**: Use `;` if the next command should run regardless of
  the first.
- **Success Chaining (Logical AND)**: Use `; if ($?) { ... }` to ensure the
  second command only runs if the first succeeded.

- **Example**: `git add . ; if ($?) { git commit -m "..." }`

This ensures that any project using these protocols stays compatible across
environments without needing manual command corrections.

---

## 4. Core Philosophy

1. **Context First:** Before proposing any solution, understand the repository's
   tech stack, historical context, and structure.
   - **Mandatory Reading**: Before starting ANY task, you MUST read the
     following Project Reference Documents to ensure compliance with the system
     architecture and patterns:
     - `docs/architecture.md`
     - `docs/data-dictionary.md`
     - `docs/decisions.md`
     - `docs/patterns.md`
     - `docs/style-guide.md`
     - `docs/web-routes.md`
   - **Epic Context**: Additionally, read the context tickets (PRD, Tech Spec)
     linked in the current Epic's body and the task-specific instructions.
   - **Optimization**: For large projects, prioritize **Local RAG Semantic
     Retrieval**. Run `node .agents/scripts/context-indexer.js search "<query>"`
     to isolate specific schemas or decisions.
2. **Plan First:** For non-trivial tasks (3+ steps or architectural decisions),
   enter **Plan Mode**. Update the Tech Spec issue or create a new Technical
   Specification document in the `docs/` root (if not already handled by a
   ticket) before touching code.
3. **Artifacts over Chat:** Create log files for test results, build outputs, or
   debug sessions rather than pasting large code blocks in chat.
4. **Idempotency:** Ensure scripts and commands can be run multiple times
   without breaking the environment.
5. **Security First:** Never hardcode secrets. Use environment variables and
   validate with secret scanning tools.

---

## 5. Execution & Quality Discipline

- **Re-Plan on Failure:** If a strategy fails, **STOP** and re-plan immediately.
  Do not repeat a broken approach.
- **Subagent Strategy:** Use subagents liberally for research, exploration, or
  parallel analysis to keep the main context window focused. One objective per
  subagent.
- **Quality Standards:**
  - UI components must pass accessibility scans (WCAG 2.1 AA).
  - Adhere strictly to project linters and formatters.
  - No commented-out code snippets in final deliverables.
  - **Anti-Laziness:** NEVER use placeholder comments like
    `// ... existing code ...`, `/* rest of file */`, or
    `// implementation here`. You MUST output the ENTIRE file or the ENTIRE
    complete function so it can be safely written to disk.
  - Remove unused imports and dead code before finalizing a file.
  - NEVER use `any` or `@ts-ignore` in TypeScript. If a type is complex, define
    the interface properly.
  - Always leave a blank newline at the end of every file.
- **Verification:** Include explicit verification steps in every plan.

---

## 6. Git & Sprint Protocol (Strict Standards)

To maintain a clean and readable repository history, you MUST follow these
strict conventions for all sprint-related Git operations:

### A. Task Branch Naming

All task work MUST occur on an isolated feature branch created from the current
Epic base branch (`epic/[EPIC_ID]`).

- **Format**: `task/[EPIC_ID]/[TASK_ID]`
- **Example**: `task/45/45.2.1`
- **Constraint**: Always prefix with `task/`.

### B. Status Tracking & Commit Standards

Administrative state mutations in the v5 model are performed via GitHub labels.
Do NOT manually update issue descriptions or status fields unless prompted.

- **Sync Tool**:
  `node .agents/scripts/update-ticket-state.js --ticket [ID] --status [STATUS]`
- **Status Labels**: `agent::ready`, `agent::executing`, `agent::review`,
  `agent::done`

### C. History Hygiene

Prioritize a clean `epic/[EPIC_ID]` branch. Feature branches should be merged
using the `/sprint-integration` workflow to maintain a consistent merge history.

---

## 7. Workspace & File Hygiene (Temporary Files)

To keep the repository clean and avoid polluting the Git history:

- **Root Temp Directory**: All temporary files, scratch scripts, or intermediate
  outputs MUST be stored in the `/temp/` directory located at the workspace
  root.
- **Git Exclusion**: The `/temp/` directory is excluded from Git by default. Do
  NOT commit any files stored within it.

## 8. Golden Examples (Few-Shot Reference)

Refer to this section to align your implementation patterns with historical
successes.

<!-- GOLDEN_EXAMPLES_START -->
<!-- GOLDEN_EXAMPLES_END -->

---

## 9. Complexity-Aware Execution

The dispatcher automatically calculates the execution plan for an Epic.

### A. When You See `⚠️ COMPLEXITY WARNING`

If your task contains a complexity warning or exceeds localized scope:

1. **Plan first.** Read the full instructions, then write a numbered list of
   atomic sub-steps in a `<!-- DECOMPOSITION -->` comment block.
2. **5-file rule.** Each sub-step should modify no more than 5 files.
3. **Commit incrementally.** stage, commit, and push after each logical sub-step
   completes successfully.
4. **Fail fast.** If any sub-step fails validation, STOP and report the failure.
