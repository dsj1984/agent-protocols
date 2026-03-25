# General Instructions

## Core Philosophy

1. **Context First:** Before proposing any solution, you MUST read the
   repository's core documentation (e.g., `README.md`, `architecture.md`,
   `data-dictionary.md`) to understand the specific tech stack, monorepo
   structure, and database schema of the current project.
2. **Plan First:** Before writing code for any complex task, generate a
   `docs/plans/[task_name].md` file outlining the approach.
3. **Artifacts over Chat:** If you run tests, builds, or debug sessions, create
   a log file rather than pasting giant walls of text in the chat.
4. **Idempotency:** Ensure scripts and commands can be run multiple times
   without breaking the environment or creating duplicate resources.
5. **Security First:** Treat every commit as public. Never hardcode secrets; use
   environment variables and validate with secret scanning tools.

## Execution Discipline

1. **Plan Threshold:** Enter plan mode for any non-trivial task (3+ steps or
   architectural decisions). Write detailed specs upfront to reduce ambiguity.
2. **Re-Plan on Failure:** If something goes sideways, **STOP** and re-plan
   immediately — do not keep pushing a broken approach.
3. **Verification in the Plan:** Include verification steps in every plan, not
   just build steps.

## Subagent Strategy

1. **Keep Context Clean:** Use subagents liberally to offload research,
   exploration, and parallel analysis — keep the main context window focused.
2. **One Task per Subagent:** Each subagent should have a single, clearly scoped
   objective.

## Quality Assurance & Testing

- **Testing Standards:** Write Unit and E2E tests using the frameworks
  established in the project's tech stack.
- **Accessibility:** UI components must pass standard accessibility scans (e.g.,
  WCAG 2.1 AA).
- **Strict Linting:** Adhere strictly to the project's configured linters and
  formatters. Do not override existing code styles.

## Interaction & Personas

- **Persona Adherence:** When adopting a persona (e.g., Architect, Engineer,
  SRE), strictly adhere to that persona's specific `*.md` constraint file.
- **Ambiguity Check:** If a user prompt is ambiguous, ask clarifying questions
  in the `product` persona voice.
- **Code Hygiene:** Do not leave commented-out code snippets unless explicitly
  acting as a tutorial.
