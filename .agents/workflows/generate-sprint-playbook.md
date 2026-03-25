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

## Step 2 - Agent Chat Session Model Alignment

Structure the sprint to support parallel agent execution in the IDE by
organizing tasks strictly into Chat Sessions:

- (A) Chat Session 1 (Backend Foundation - Sequential)
- (B) Chat Sessions 2 and 3 (Frontend Web & Mobile - Concurrent)
- (C) Chat Session 4 (QA Test Plan Generation and Execution - Concurrent)
- (D) Chat Session 5 (Retro & Documentation - Sequential)

TASK SCOPING RULE: Keep individual tasks highly focused. A single task should
instruct the agent to modify no more than 2 to 3 files.

## Step 3 - Model Routing and Persona Assignment

Models:

- CLAUDE OPUS 4.6 (Planning mode): High-complexity tasks (schema, architecture)
- CLAUDE SONNET 4.6 (Planning mode): Complex business logic
- GEMINI 3.1 HIGH (Planning mode): Standard APIs, data fetching, components
- GEMINI 3 FLASH (Fast mode): Styling, simple layouts
- GPT-OSS 120B MEDIUM (Planning mode): Basic data formatting fallback.

Personas:

- ARCHITECT: Specifications, schemas.
- ENGINEER: Implementation with strict TypeScript, Zod.
- PRODUCT: Define ACs, UI/UX flows.
- SRE: Testing, Playwright/Vitest, Infrastructure.
- QA ENGINEER: Create test plans using `.agents/templates/test-plan_template.md`
  and execute them using the `/run-test-plan` workflow to dynamically update
  their execution status.

## Step 4 - Strict Output Formatting

Generate the markdown playbook for the Sprint.

**STRICT RULE:** You MUST follow the structure, Mermaid diagrams, and task
templates defined in `.agents/templates/sprint-playbook-template.md`.

1. The ENTIRE output must be wrapped in a single set of FOUR backticks.
1. Use CHAT SESSION HEADERS:
   `### 💬 ⚙️ Chat Session 1: Backend Foundation (Sequential)` etc.
1. Use the MERMAID diagram from the template.
1. TASK TEMPLATE: Every task MUST match the template in the spec-template:

- [ ] **[SPRINT_NUMBER].[TASK_NUMBER] [Task Title]**

**Mode:** [Planning/Fast] **Model:** [Model Name]

```text
Sprint [SPRINT_NUMBER].[TASK_NUMBER]: Act as an [Persona].
[Detailed task instructions here.]

AGENT INSTRUCTION: Ensure all validation and pre-commit hooks pass successfully. Upon completion, perform a git commit of your changes with the message "type: [SPRINT_NUMBER].[TASK_NUMBER] - [Task Title]". Finally, open `docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md` and check off `- [x] **[SPRINT_NUMBER].[TASK_NUMBER]**`.
```

## Step 5 - Output Artifacts

Save the generated playbook into
`docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`.

## Constraint

Adhere strictly to the templates and instructions provided.
