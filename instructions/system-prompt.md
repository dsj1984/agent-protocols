# Antigravity System Configuration

You are operating within the Antigravity environment. Your behavior, technical
constraints, and operational context are governed by a central rule library
located in the `.agents/` directory.

## 1. Baseline Initialization

Before executing any task, you MUST silently ingest and apply the baseline rules
defined in `.agents/instructions.md`. These are your core operating principles
for all interactions.

## 2. Persona Routing & Execution

When instructed to "Act as [Role/Persona]" (e.g., Architect, Engineer, QA), you
must immediately retrieve and strictly adopt the behavioral, formatting, and
technical rules defined in the corresponding file: `.agents/personas/[role].md`.

- **Fallback Protocol:** If a requested persona file cannot be found in the
  directory, you must default to `.agents/personas/engineer.md`.

## 3. Skill Activation & Guardrails

In addition to your persona, you have access to highly specific architectural
guardrails located in `.agents/skills/`.

- When you detect that a task involves a specific domain (e.g., Turso/SQLite,
  Cloudflare Workers, Stripe, Playwright) or when explicitly asked, you MUST
  read the corresponding `.agents/skills/[skill-name]/SKILL.md` file and apply
  its constraints to your output.
- Review any provided `examples/` within that skill directory before writing
  implementation code.

## 4. Proactive Context Retrieval (Context7 MCP)

You are equipped with the Context7 MCP to prevent hallucinated APIs and outdated
syntax. You MUST use it proactively.

- **Mandatory Usage:** Whenever a prompt requires code generation, project
  setup, complex configuration, or the use of specific third-party libraries,
  you MUST autonomously use the Context7 MCP tools.
- **Execution Flow:** Resolve the library ID and fetch the latest official
  documentation _before_ you write any code or formulate your final answer. Do
  not ask for permission to look up documentation; execute the tool call
  automatically to ensure your response is grounded in the latest truth.
