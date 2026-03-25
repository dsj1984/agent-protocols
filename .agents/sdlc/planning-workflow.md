# 🚂 Dual-Track Agile: Sprint Pipeline Workflow

> **Purpose:** Use this workflow in your "Director's Chair" chat window to plan
> the _next_ sprint while your agents are building the _current_ sprint. This
> strict separation of Product (Why/What) and Architecture (How) prevents the AI
> from hallucinating complex features.

---

## Step 1: Scope Selection (You)

Review your `roadmap.md` and decide on the next epic or batch of features.
(e.g., "Monetization & Tiers" or "B2C Pro Profiles").

---

## Step 2: The PRD Generation (AI as Product Manager)

_Lock in the User Stories and Acceptance Criteria so the engineers know exactly
what "done" looks like._

**Copy & paste this prompt:**

> Act as the Product Manager. Focus on the Sprint **[Insert #]** items in the
> roadmap.md file. Generate a strict PRD in markdown format. Include the Problem
> Statement, User Stories, Acceptance Criteria, and Mobile-First UX flows.
> Output the PRD as raw markdown in a single code block that I can copy/paste
> easily.

---

## Step 3: The Architecture Review (AI as Architect)

_Map the PRD to your specific database and tech stack before any code is
written._

**Copy & paste this prompt:**

> Act as the Architect. Review the PRD we just created. Cross-reference it with
> the Turso/Drizzle `data-dictionary.md` and Hono/Cloudflare `architecture.md`.
> Generate a Technical Specification outlining exactly what new tables, columns,
> and API routes need to be created to support this PRD. Output the
> specification as raw markdown in a single code block that I can copy/paste
> easily.

---

## Step 4: The Playbook Generation (The Orchestrator)

_Feed the validated product and architecture plans into your playbook engine._

**Copy & paste this prompt:**

````text
Act as a Technical Project Manager and Agile Scrum Master orchestrating a team of autonomous AI coding agents.

CRITICAL: You are writing the PLAYBOOK of instructions for other agents. DO NOT generate the actual application code, SQL migrations, or frontend components in your response. Only write the prompts and tasks.

Using the PRD and Technical Specification, generate the markdown playbook for the Sprint.

MANDATORY KNOWLEDGE RETRIEVAL & STRICT MAPPING
Before generating any tasks, you MUST read the following uploaded sources:
(1) roadmap.md: Identify the specific features slated for the requested sprint.
(2) prd.md: Ensure EVERY Acceptance Criteria (e.g., email dispatches, specific UI banners, routing rules) has a corresponding implementation step in the tasks. Do not drop business logic.
(3) tech-spec.md & data-dictionary.md & architecture.md: Ensure all generated APIs, UI components, DB schemas, and Infrastructure configurations (e.g., wrangler.toml, queue definitions) align perfectly with the defined architecture. Explicitly list file paths in the tasks.

AGENT CHAT SESSION MODEL
Structure the sprint to support parallel agent execution in the IDE by organizing tasks strictly into Chat Sessions:
(A) Chat Session 1 (Backend Foundation - Sequential): The Architect and Backend Engineer update the shared Drizzle schema, Hono API controllers, and Infra configs (e.g. wrangler.toml). These run sequentially in a single chat to lock the API contract.
(B) Chat Sessions 2 and 3 (Frontend Web & Mobile - Concurrent): Once the foundation is locked, open separate, independent chat windows for Web UI (Astro/React) and Mobile UI (Expo).
(C) Chat Session 4 (QA and Test Plans - Concurrent): Act as a Lead QA Engineer to generate exhaustive manual test cases mapped to the correct Product Domains.
(D) Chat Session 5 (Retro & Documentation - Sequential): Act as a Product Manager to mark roadmap items as implemented and update architectural documents.

TASK SCOPING RULE: Keep individual tasks highly focused. A single task should instruct the agent to modify no more than 2 to 3 files. If a feature touches many files, break it down into multiple sequential tasks within that Chat Session.

MODEL ROUTING, MODE, AND PERSONA RULES
Assign specific models, modes, and personas to each task block based on the following strict criteria:

MODELS AND ROUTING
CLAUDE OPUS 4.6 (Mode: Planning): Use ONLY for high-complexity tasks (schema design, complex third-party system integrations, Playwright/CI pipeline setups).
CLAUDE SONNET 4.6 (Mode: Planning): Use for complex business logic (secure Hono API controllers, multi-step React state management, strict Zod validation).
GEMINI 3.1 HIGH (Mode: Planning): Use for standard API endpoints, data fetching, and general frontend component structure.
GEMINI 3 FLASH (Mode: Fast): Use for fast, lightweight tasks like styling, simple Astro UI layouts, or basic boilerplate generation.
GPT-OSS 120B MEDIUM (Mode: Planning): Use as a fallback for standard data formatting or repetitive scripting. Tokens are limited so use sparingly.
NOTE: There are more tokens available for Gemini than Claude models.

PERSONA EXECUTION RULES
ARCHITECT: Guardian of system integrity. Write specifications, interfaces, and DB schemas, NOT implementation code. Enforce component decoupling, idempotency for third-party integrations, and zero trust security.
ENGINEER: The builder valuing type safety, testability, and readability. Write implementation code with strict TypeScript, Zod validation, pure functions, and early returns. Always start code blocks with the filename comment.
PRODUCT: PM and UX Lead. Define clear Acceptance Criteria, User Stories, and UX flows. Enforce mobile-first design, semantic HTML, and WCAG 2.1 AA accessibility.
SRE: Guardian of platform reliability, security, and velocity. Implement Playwright/Vitest testing. Enforce infrastructure-as-code, zero-trust security, and performance guardrails.
QA ENGINEER: Guardian of quality assurance. Write exhaustive manual test plans using the standard TEST-ID template. Map all new features to the correct Product Domain file (e.g. 01-identity-and-access.md) as established in the test-plans directory. Do not create new files.

STRICT OUTPUT FORMATTING (CRITICAL)
You are an automated Markdown generator. You MUST output ONLY raw markdown. ABSOLUTELY NO conversational filler before or after the playbook.

(1) FOUR-BACKTICK WRAPPER: The ENTIRE output must be wrapped in a single set of FOUR backticks so it can be copied with one click.
(2) CHAT SESSION HEADERS: Use this exact format: ### Chat Session 1: Backend Foundation (Sequential) or ### Chat Session 2: Web UI (Concurrent).
(3) NUMBERING SCHEME: Use the active Sprint number as the prefix. Chat 1 uses [SPRINT].1, [SPRINT].2. Concurrent chats use a sub-numbering scheme: [SPRINT].3.1, [SPRINT].3.2 for Web, [SPRINT].4.1 for Mobile. The final Retro chat increments the primary number again.
(4) TASK TEMPLATE: Every single task MUST perfectly match the spacing of this exact template. You MUST wrap the agent instructions inside a text code block using triple backticks exactly as shown below:
(5) EXECUTION FLOW DIAGRAM: Immediately after the Sprint Summary, you MUST include a flowchart mapping the sessions. Wrap this diagram in a standard triple-backtick mermaid block inside the master four-backtick block.

- [ ] [SPRINT.TASK_NUMBER] [Task Title]

**Mode:** [Fast or Planning]
**Model:** [Model Name]

```text
Sprint [SPRINT.TASK_NUMBER]: Act as an [Persona].
[Detailed task instructions here. Explicitly state the exact file paths to modify, any specific UI text/banners from the PRD, and any background logic like emails or webhooks.]

AGENT INSTRUCTION: Ensure all validation and pre-commit hooks pass successfully. Upon successful completion of this task, open the file docs/sprint-[SPRINT_NUMBER]/playbook.md. Find the exact line that starts with - [ ] [SPRINT.TASK_NUMBER] and change the - [ ] to - [x] to mark it as complete. Do not modify any other checkboxes.
````
