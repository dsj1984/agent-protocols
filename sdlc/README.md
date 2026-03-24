# 🤖 AI-Driven Software Development Life Cycle (SDLC) Protocol

This document outlines the standard operating procedure for building and scaling
the Athlete Portal using AI agents. It defines the boundary between human-led
product management and AI-led code execution, ensuring strict architectural
compliance, scope management, and predictable velocity.

## 📁 Repository Context Files (The "Ground Truth")

AI agents possess massive general knowledge but zero project-specific memory. To
prevent hallucinations and enforce architectural constraints, every agent
session must be anchored by our core context files.

- **`README.md`**: The master system overview. It defines the Turborepo
  workspace structure (apps/web, apps/mobile, packages/shared) and local
  development commands. Agents read this to understand where code belongs.
- **`architecture.md`**: The structural guardrails. It dictates the tech stack
  (Astro, Expo, Hono, Cloudflare, Turso) and design patterns (e.g., Omni-Search,
  unified routing). It prevents agents from introducing unauthorized libraries
  or patterns.
- **`data-dictionary.md`**: The database source of truth. It explicitly defines
  the Drizzle ORM schemas, relationships, and nullability constraints. Agents
  must never infer database structures; they must read this file.
- **`roadmap.md`**: The master product matrix. It tracks implemented features ✅
  and future epics ⏳, organized by Product Domain and Sprint Index. It is our
  primary defense against scope creep.

---

## 🛠️ Phase 1: Product Strategy & Planning (The PM Loop)

Before any code is written, the human Product Owner collaborates with a
high-reasoning AI acting as the Product Manager/Architect to translate ideas
into actionable blueprints.

### 1. Scope Definition & Roadmap Grooming

- **Action:** The human proposes a feature or UX improvement.
- **Validation:** The AI PM cross-references the request against `roadmap.md`.
- **Outcome:** If the feature is a massive leap (e.g., "Add public/private event
  ticketing"), the AI flags it as scope creep, generates a prompt to add it to a
  "Future Epic" in the roadmap, and refocuses the session. If approved, the
  feature is assigned to the current Sprint.

### 2. The Product Requirements Document (PRD)

Once a Sprint is locked, the AI PM generates a strict markdown PRD.

- **Inputs:** `roadmap.md`, `architecture.md`.
- **Outputs:** Problem Statement, User Stories, Acceptance Criteria, and
  Mobile-First UX Flows.

### 3. The Technical Specification

The AI Architect translates the PRD into a rigid technical contract.

- **Inputs:** PRD, `data-dictionary.md`.
- **Outputs:** Exact Drizzle schema changes (tables, columns, indexes) and Hono
  API route definitions (methods, payloads, return types).

### 4. The Sprint Playbook

The AI Architect generates a sequential execution plan designed for multi-agent
concurrency.

- **Structure:** Tasks are grouped into Chat Sessions (e.g., Session 1: Backend
  Foundation, Session 2: Web UI, Session 3: Mobile UI).
- **Formatting:** Each task is output as an isolated, copy-pasteable prompt
  wrapper defining the Agent Persona, Mode, Model, and specific instructions.

---

## 🚀 Phase 2: Agent Execution (The Dev Loop)

With the Sprint Playbook generated, the human transitions from Product Owner to
Orchestrator, feeding prompts to specialized dev agents.

### 1. Sequential Backend Foundation (Chat Session 1)

- **Rule:** The database and API must be built first, sequentially, in a single
  chat session.
- **Execution:** The human pastes the schema and API tasks into the IDE chat.
  The agent (acting as the Backend Engineer) writes the Drizzle migrations and
  Hono controllers.
- **Goal:** Establish the strict data contract and resolve any type errors
  before the frontends attempt to consume the data.

### 2. Concurrent Frontend Execution (Chat Sessions 2+)

- **Rule:** Once the backend is locked and committed, frontend work can happen
  in parallel.
- **Execution:** The human opens separate, independent chat windows.
  - _Chat A:_ Feeds the Web UI playbook tasks for the Astro/React workspace
    (`@repo/web`).
  - _Chat B:_ Feeds the Mobile UI playbook tasks for the Expo workspace
    (`@repo/mobile`).
- **Advantage:** Prevents the LLM's context window from getting confused between
  web DOM elements and native mobile components.

### 3. Verification & QA

- **Rule:** Agents do not blindly commit.
- **Execution:** The human enforces pre-commit hooks. The playbook includes
  commands for the AI SRE persona to write Playwright E2E tests, verifying that
  the full-stack loop (UI -> API -> DB) functions as designed.

---

## 🧠 Agent Persona Protocols

When feeding playbook tasks to the AI, we strictly enforce personas to constrain
the AI's behavior and optimize its output:

- **The Architect (Claude Opus / Gemini Pro):** Focuses on system design,
  database schemas, and API contracts. Writes specifications, not implementation
  code. Defends system integrity and zero-trust security.
- **The Engineer (Claude Sonnet / Gemini Flash):** The builder. Writes strict
  TypeScript, enforces Zod validation, and prioritizes pure functions and early
  returns.
- **The Product Manager:** Focuses on UX flows, accessibility (WCAG 2.1 AA), and
  strict adherence to the roadmap.
- **The SRE:** Focuses on testability (Vitest/Playwright), edge-caching
  strategies, and pipeline stability.
