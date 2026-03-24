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
> attached roadmap.md file. Generate a strict PRD in markdown format. Include
> the Problem Statement, User Stories, Acceptance Criteria, and Mobile-First UX
> flows. Output the PRD as raw markdown in a single code block that I can
> copy/paste easily.

---

## Step 3: The Architecture Review (AI as Architect)

_Map the PRD to your specific database and tech stack before any code is
written._

**Copy & paste this prompt:**

> Act as the Architect. Review the PRD we just created. Cross-reference it with
> the attached Turso/Drizzle `data-dictionary.md` and Hono/Cloudflare
> `architecture.md`. Generate a Technical Specification outlining exactly what
> new tables, columns, and API routes need to be created to support this PRD.
> Output the specification as raw markdown in a single code block that I can
> copy/paste easily.

---

## Step 4: The Playbook Generation (The Orchestrator)

_Feed the validated product and architecture plans into your playbook engine._

**Copy & paste this prompt:**

`````text
Using the above PRD and Technical Specification, generate the markdown playbook for the Sprint.

MANDATORY KNOWLEDGE RETRIEVAL
Before generating any tasks, you MUST read the following uploaded sources:
(1) roadmap.md: Identify the specific features slated for the requested sprint.
(2) architecture.md & data-dictionary.md: Ensure all generated APIs, UI components, and DB schemas align perfectly with the existing Turso/Hono/Astro/Expo stack and database structures.

AGENT CHAT SESSION MODEL (BACKEND-FIRST, FRONTEND-PARALLEL)
Structure the sprint to support parallel agent execution in the IDE by organizing tasks strictly into Chat Sessions:
(A) Chat Session 1 (The Foundation - Sequential): The Architect and Backend Engineer update the shared Drizzle schema and Hono API controllers. These run sequentially in a single chat to build shared context and lock the API contract without merge conflicts.
(B) Chat Sessions 2+ (Parallel Execution - Concurrent): Once the foundation is locked, open separate, independent chat windows for Web UI (Astro/React), Mobile UI (Expo), and QA/E2E Testing (Playwright). Because they are in separate chats, the agents can build simultaneously across isolated workspaces (@repo/web and @repo/mobile).

MODEL ROUTING, MODE, AND PERSONA RULES
Assign specific models, modes, and personas to each task block based on the following strict criteria:

MODELS AND ROUTING
- CLAUDE OPUS 4.6 (Mode: Planning): Use ONLY for high-complexity tasks (schema design, complex third-party system integrations, Playwright/CI pipeline setups).
- CLAUDE SONNET 4.6 (Mode: Planning): Use for complex business logic (secure Hono API controllers, multi-step React state management, strict Zod validation).
- GEMINI 3.1 HIGH (Mode: Planning): Use for standard API endpoints, data fetching, and general frontend component structure.
- GEMINI 3 FLASH (Mode: Fast): Use for fast, lightweight tasks like styling, simple Astro UI layouts, or basic boilerplate generation.
- GPT-OSS 120B MEDIUM (Mode: Planning): Use as a fallback for standard data formatting or repetitive scripting. Tokens are limited so use sparingly.
- NOTE: There are more tokens available for Gemini than Claude models.

PERSONA EXECUTION RULES
- ARCHITECT: Guardian of system integrity. Write specifications, interfaces, and DB schemas, NOT implementation code. Enforce component decoupling, idempotency for third-party integrations, and zero trust security.
- ENGINEER: The builder valuing type safety, testability, and readability. Write implementation code with strict TypeScript, Zod validation, pure functions, and early returns. Always start code blocks with the filename comment (e.g., // src/lib/utils.ts).
- PRODUCT: PM and UX Lead. Define clear Acceptance Criteria, User Stories, and UX flows. Enforce mobile-first design, semantic HTML, and WCAG 2.1 AA accessibility.
- SRE: Guardian of platform reliability, security, and velocity. Implement Playwright/Vitest testing. Enforce infrastructure-as-code, zero-trust security (strictly no hardcoded secrets), and performance guardrails.

STRICT OUTPUT FORMATTING (CRITICAL)
You are an automated Markdown generator. You MUST output ONLY raw markdown. ABSOLUTELY NO conversational filler before or after the playbook (Do NOT say "Here is your playbook").

(1) FOUR-BACKTICK WRAPPER: The ENTIRE output must be wrapped in a single set of FOUR backticks (````markdown ... ````) so it can be copied with one click.
(2) CHAT SESSION HEADERS: Use this exact format: `### 💬 ⚙️ Chat Session 1: Backend Foundation (Sequential)` or `### 💬 ⚡ Chat Session 2: Web UI (Concurrent)`.
(3) NUMBERING SCHEME: Chat 1 uses 10.1, 10.2. Chat 2 increments the primary number and adds sub-numbers: 10.3.1, 10.3.2. Chat 3 uses 10.4.1. The final Retro chat increments again: 10.5.
(4) TASK TEMPLATE: Every single task MUST perfectly match the spacing, hyphens, and triple-backticks of this exact template:
(5) EXECUTION FLOW DIAGRAM: Immediately after the Sprint Summary, you MUST include a MermaidJS 'graph TD' flowchart mapping the sequential and concurrent Chat Sessions, visually demonstrating the fork and convergence.

- [ ] **[SPRINT.TASK_NUMBER] [Task Title]**

**Mode:** [Fast or Planning]
**Model:** [Model Name]

```text
Sprint [SPRINT.TASK_NUMBER]: Act as an [Persona].
[Detailed task instructions here...]

AGENT INSTRUCTION: Ensure all validation and pre-commit hooks pass successfully. Upon successful completion of this task, open the file docs/sprint-[SPRINT_NUMBER]/playbook.md. Find the exact line that starts with - [ ] **[SPRINT.TASK_NUMBER]** and change the - [ ] to - [x] to mark it as complete. Do not modify any other checkboxes.
`````
