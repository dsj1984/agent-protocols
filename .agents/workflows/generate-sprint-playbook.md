---
description:
  Generate an actionable sprint playbook from PRD and architecture plans
---

# Playbook Generation Workflow

## Role

Technical Project Manager and Agile Scrum Master

## Context & Objective

Your objective is to orchestrate a team of autonomous AI coding agents.

CRITICAL: You are writing the PLAYBOOK of instructions for other agents. DO NOT
generate the actual application code, SQL migrations, or frontend components in
your response. Only write the prompts and tasks.

**Target Sprint:** `[SPRINT_NUMBER]` — The user should provide the sprint number
when executing this command.

## Step 1 - Mandatory Knowledge Retrieval

Before generating any tasks, you MUST read the following sources:

1. `roadmap.md`: Identify the specific features slated for the requested sprint.
1. `docs/sprints/sprint-[SPRINT_NUMBER]/prd.md`: Ensure EVERY Acceptance
   Criteria has a corresponding implementation step. Do not drop business logic.
1. `docs/sprints/sprint-[SPRINT_NUMBER]/tech-spec.md`, `data-dictionary.md`, and
   `architecture.md`: Ensure all generated APIs, UI components, DB schemas, and
   Infrastructure configurations align perfectly with the defined architecture.
   Explicitly list file paths in the tasks.

## Step 2 - Agent Chat Session Model Alignment (Fan-Out Architecture)

Structure the sprint to support parallel agent execution in the IDE by
organizing tasks strictly into the following "Fan-Out" Chat Sessions.

**Task Numbering Rule:** You MUST use the format
`[SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER]` (e.g., 1.1.1, 1.1.2, 1.2.1).

- (A) Chat Session 1 (Backend Foundation). _Sequential._ Builds DB schemas and
  API routes first to lock the data contracts. (Tasks: X.1.1, X.1.2...)
- (B) Chat Session 2 (Web UI) & Chat Session 3 (Mobile UI). _Concurrent._ These
  sessions fan-out and run in parallel ONLY after Chat Session 1 is complete.
  (Tasks: X.2.1 and X.3.1)
- (C) Chat Session 4 (QA & E2E Testing). _Sequential in a FRESH chat._ (Tasks:
  X.4.1)
- (D) Chat Session 5 (Retro & Documentation). _Sequential._ (Tasks: X.5.1)

TASK SCOPING RULE: Keep individual tasks highly focused. A single task should
instruct the agent to modify no more than 2 to 3 files.

## Step 3 - Model Routing and Persona Assignment

Models:

- CLAUDE OPUS 4.6 (Planning mode): High-complexity tasks (schema, architecture,
  QA execution)
- CLAUDE SONNET 4.6 (Planning mode): Complex business logic
- GEMINI 3.1 HIGH (Planning mode): Standard APIs, data fetching, components
- GEMINI 3 FLASH (Fast mode): Retro, documentation, simple styling

Personas & Active Skills: _You MUST dynamically assign all applicable skills to
every task based on the context of the work. Select the appropriate skills from
the `.agents/skills/` (or equivalent) directory. Do not leave the skills field
blank._

- ARCHITECT: Specifications, schemas, APIs.
- ENGINEER: Implementation (Web, Mobile).
- PRODUCT: Retro and Roadmap alignment.
- QA AUTOMATION ENGINEER: Test execution.

## Step 4 - Strict Output Formatting

Generate the markdown playbook for the Sprint.

**STRICT RULE:** You MUST follow the structure and task templates defined below.
Do not use overly verbose boilerplate.

1. The ENTIRE output must be wrapped in a single set of FOUR backticks.
1. Use CHAT SESSION HEADERS:
   `### 💬 ⚙️ Chat Session 1: Backend Foundation (Sequential)`
   `### 💬 ⚡ Chat Session 2: Web UI (Concurrent)`
   `### 💬 📱 Chat Session 3: Mobile UI (Concurrent)`
1. Include a Mermaid diagram summarizing the Fan-Out Chat Sessions.
1. TASK TEMPLATE: Every task MUST exactly match this semantic structure:

- [ ] **[SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER] [Task Title]**

**Mode:** [Planning/Fast] **Model:** [Model Name]

```text
Sprint [SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER]: Act as an [Persona].

**Active Skills:** `[comma-separated list of all applicable skills]`

[Detailed task instructions here. MUST explicitly list file paths.]
[If this is the QA task, you MUST instruct the agent to use the `/run-test-plan` workflow against the specific `docs/test-plans/*.md` files relevant to this sprint. DO NOT tell the agent to write new Playwright tests from scratch.]

AGENT EXECUTION PROTOCOL:
1. Prerequisite Dependency Check:
   - Understand your Task ID format: `[SPRINT].[CHAT].[STEP]`.
   - You depend on ALL tasks from previous Chat Sessions (any task where `CHAT` is less than yours).
   - You depend on ALL earlier tasks in your current Chat Session (any task where `CHAT` equals yours, but `STEP` is less than yours).
   - You DO NOT depend on tasks in other concurrent Chat Sessions (e.g., Chat 2 does not wait for Chat 3).
   - Open `playbook.md` and verify your specific dependencies are marked `[x]`. If not, STOP and alert the user.
2. Hook Check: Ensure all validation and pre-commit hooks pass.
3. Commit: `[type]([scope]): [lowercase conventional commit message]`
4. State Update: Check off `- [x] **[SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER]**` in this playbook file.
```

## Step 5 - Output Artifacts

Save the generated playbook into
`docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`.

## Constraint

Adhere strictly to the templates and instructions provided. Never invent tests;
always execute existing test plan markdowns for the QA steps.
