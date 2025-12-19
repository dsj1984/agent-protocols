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
