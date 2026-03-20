# General Instructions

## Core Philosophy

1. **Plan First:** Before writing code for any complex task, generate a
   `docs/plan_[task_name].md` file outlining the approach.
2. **Artifacts over Chat:** If you run tests, builds, or debug sessions, create
   a log file in `.agent/logs/` rather than pasting giant walls of text in the
   chat.
3. **Idempotency:** Ensure scripts and commands can be run multiple times
   without breaking the environment or creating duplicate resources.
4. **Security First:** Treat every commit as public. Never hardcode secrets; use
   environment variables and validate with secret scanning tools
   (Gitleaks/Secretlint).

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
3. **Compute over Confusion:** For complex problems, prefer throwing more
   compute at it (via subagents) over trying to hold everything in one thread.

## Self-Improvement Loop

1. **Capture Lessons:** After **any** correction from the user, update
   `tasks/lessons.md` with the pattern (what went wrong and the fix).
2. **Write Preventive Rules:** Turn each lesson into a concrete rule that
   prevents the same mistake from recurring.
3. **Review at Session Start:** At the start of a session, review
   `tasks/lessons.md` for any lessons relevant to the current project.

## Task Management

1. **Plan First:** Write the plan to `tasks/todo.md` with checkable items.
2. **Check In:** Verify the plan with the user before starting implementation.
3. **Track Progress:** Mark items complete as you go.
4. **Explain Changes:** Provide a high-level summary at each step.
5. **Document Results:** Add a review section to `tasks/todo.md` when done.
6. **Capture Lessons:** Update `tasks/lessons.md` after any user correction.

## Core Principles

1. **Simplicity First:** Make every change as simple as possible. Impact minimal
   code. If a simpler solution exists, use it.
2. **No Laziness:** Find root causes. No temporary fixes. Hold yourself to
   senior developer standards.

## Technology Stack Standards

### Core Development

- **IDE Environment:** Google Antigravity.
- **Framework:** Astro (Static Site Generation + Server-Side Rendering where
  needed).
- **Styling:** Tailwind CSS.
- **Icons:** Use `Iconify JSON` exclusively (do not import SVGs manually unless
  necessary).
- **Source Control:** GitHub.

### Infrastructure & Deployment

- **Hosting/DNS:** Cloudflare (Pages for frontend, Workers for edge logic).
- **Image Optimization:** Rely on Cloudflare Polish; do not implement heavy
  local image compression scripts.
- **CI/CD:** GitHub Actions.
- **Error Monitoring:** Sentry (Must be initialized in client/server bundles).
- **Notifications:** Pushover (used for critical pipeline/monitor alerts).

### Quality Assurance & Testing

- **Unit Testing:** Vitest.
- **E2E Testing:** Playwright.
- **Accessibility:** Must pass `pa11y` and `axe` scans.
- **Linting Suite (Strict Enforcement):**
  - Logic: ESLint.
  - Style: Prettier.
  - Markup: html-validate.
  - Config: yamllint.
  - Documentation: markdownlint.

## Business Logic & Integrations

- **Forms:** Do not handle data storage locally. POST data to Web3Forms or
  Cloudflare Workers acting as a proxy to HighLevel.
- **CRM/Booking:** Integrate via HighLevel widgets or API.
- **Analytics:** Ensure Google Analytics 4 tags are present.
- **Asset Creation:** When asked to generate or update images, use Gemini or
  Recraft.ai prompts.

## Interaction & Personas

- **Persona Adherence:** When adopting a persona (e.g., SRE, Developer, QA),
  strictly adhere to that persona's specific `*.md` constraint file.
- **Ambiguity Check:** If a user prompt is ambiguous, ask clarifying questions
  in the `product` persona voice.
- **Code Hygiene:** Do not leave commented-out code. Delete it.
