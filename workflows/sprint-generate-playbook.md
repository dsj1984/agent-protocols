---
description:
  Generate an actionable sprint playbook from PRD and architecture plans
---

# Sprint Generate Playbook

## Role

Adopt the `project-manager` persona from `.agents/personas/`.

## Context & Objective

Your objective is to orchestrate a team of autonomous AI coding agents.

CRITICAL: You are writing a **JSON task manifest** that describes the tasks and
their dependency graph. A deterministic script will then transform your manifest
into the final formatted `playbook.md`. You do NOT write the playbook markdown
directly.

**Target Sprint:** `[SPRINT_NUMBER]` — The user should provide the sprint number
when executing this command.

## Step 0 - Path Resolution

1.  Resolve `[SPRINT_ROOT]` as the directory `sprint-[PADDED_NUM]` within the
    `sprintDocsRoot` prefix, both defined in `.agents/config/config.json`.
2.  `[PADDED_NUM]` is the `[SPRINT_NUMBER]` padded according to the
    `sprintNumberPadding` setting in the same config.

## Step 1 - Mandatory Knowledge Retrieval

Execute the `sprint-gather-context` workflow for `[SPRINT_NUMBER]` to retrieve
the roadmap, PRD, technical specifications, and architecture required to
generate your tasks.

## Step 2 - Dependency Analysis & Manifest Generation

Analyze the PRD and Technical Spec to decompose the sprint into discrete tasks
with explicit dependencies. Output a `task-manifest.json` file.

### Manifest Schema

Your output MUST conform to the JSON schema defined in
`.agents/schemas/task-manifest.schema.json`. Read this file before proceeding.

### Dependency Rules

- **Direct dependencies ONLY**: Include ONLY direct, immediate prerequisites. Do
  NOT include transitive dependencies (e.g., if Task C depends on Task B, and
  Task B depends on Task A, Task C's `dependsOn` should ONLY include Task B).
- If task B requires the database schema created by task A, task B's `dependsOn`
  includes task A's `id`.
- If tasks are independent bug fixes or unrelated work items, `dependsOn` is
  `[]` for all of them (they will become concurrent Chat Sessions).
- Tasks sharing a workspace scope (e.g., `@repo/web`) at the same dependency
  layer will be grouped into one sequential Chat Session by the script.
- Always include at least one Integration task (with `isIntegration: true`), one
  QA task (with `isQA: true`), one Retro task (with `isRetro: true`), and one
  Close Sprint task (with `isCloseSprint: true`) as the mandatory bookends of
  your dependency chain.
- Optionally include a Code Review task (with `isCodeReview: true`) between QA
  and Retro.
- The script enforces a strict bookend pipeline in this order: **Integration →
  QA → Code Review → Retro → Close Sprint**.

### Task Field Guidance

- **`id`**: A short, unique kebab-case slug (e.g., `db-migrations`,
  `bugfix-login-redirect`, `web-event-cards`).
- **`title`**: Human-readable title (e.g., "Database Schema Migrations").
- **`dependsOn`**: Array of task `id` strings. Empty array = no dependencies.
- **`persona`**: Select the exact persona filename from `.agents/personas/` that
  best fits the task. **Do not invent personas.**
- **`skills`**: Select applicable skills from `.agents/skills/`. Use the path
  relative to `.agents/skills/` (e.g., `database/turso`). Do not leave empty.
- **`model`**: Assign a primary model from `.agents/config/models.json` based on
  the task complexity. Read the model selection guidance in that file.
- **`secondaryModel`**: (Optional) Assign a fallback model from
  `.agents/config/models.json` that users can select if they face token limits
  or usage caps.
- **`mode`**: `"Planning"` for complex tasks, `"Fast"` for simple/boilerplate
  tasks.
- **`instructions`**: Detailed, multi-line task instructions. MUST explicitly
  list file paths to modify. **Maintain Task Atomicity**: each task SHOULD
  contain no more than the number of logical action items/bullet points defined
  in `.agents/config/config.json:maxInstructionSteps` (default: 5). If a feature
  requires more, decompose it into sequential sub-tasks. MUST use `\n-` plus a
  space for markdown bullet points to format the text into readable chunks
  instead of a single block. **Omit this field entirely for bookend tasks** —
  the script auto-injects the appropriate workflow delegation command.
- **`scope`**: Optional workspace scope (e.g., `@repo/api`, `@repo/web`,
  `@repo/mobile`, `root`). Tasks sharing a scope at the same layer are grouped
  into one Chat Session. The scope is displayed in the playbook execution rule
  to help agents stay within their assigned workspace boundaries.
- **`isIntegration`**, **`isQA`**, **`isCodeReview`**, **`isRetro`**,
  **`isCloseSprint`**: Boolean flags for bookend tasks. Each bookend becomes its
  own dedicated Chat Session appended at the end of the pipeline in this fixed
  order: **Integration → QA → Code Review → Retro → Close Sprint**. The script
  auto-injects the appropriate workflow delegation command and ignores any
  `instructions` value provided. Use the following persona and skill
  recommendations for bookend tasks:
  - **Integration** (`isIntegration`): triggers the `sprint-integration`
    workflow, which consolidates all feature branches before QA begins. Use
    persona `engineer`, skill `architecture/monorepo-path-strategist`.
  - **QA** (`isQA`): triggers the `sprint-testing` workflow. Use persona
    `qa-engineer`, skills from the `qa/` category.
  - **Code Review** (`isCodeReview`): triggers the `sprint-code-review`
    workflow. Use persona `architect`, skill
    `architecture/autonomous-coding-standards`.
  - **Retro** (`isRetro`): triggers the `sprint-retro` workflow. Use persona
    `product`, skill `architecture/markdown`.
  - **Close Sprint** (`isCloseSprint`): triggers the `sprint-close-out`
    workflow. Use persona `devops-engineer`, skill `devops/git-flow-specialist`.
- **`requires_approval`**: Boolean. If the Tech Spec flags a task as high-risk
  during the **HITL Risk Assessment** (semantically matching
  `riskGates.heuristics` in `config.json`), you MUST set this to `true`. This
  will instruct the execution script to pause for human confirmation.

### Output Location

Save the manifest to: `[SPRINT_ROOT]/task-manifest.json`

## Step 3 - Script Execution

Run the scaffold script to generate the formatted playbook:

```bash
node .agents/scripts/generate-playbook.js [SPRINT_NUMBER]
```

The script will:

1. Validate the manifest against the JSON schema.
2. Build a dependency graph and detect cycles.
3. Compute optimal sequential vs. concurrent Chat Sessions.
4. Generate a dynamic Mermaid execution flow diagram.
5. Render the playbook with perfect numbering and the verbatim Agent Execution
   Protocol.
6. Write the output to `[SPRINT_ROOT]/playbook.md`.

### Chat Session Icons

Chat sessions are assigned icons based on their content and scope:

- **🗄️ Database**: Tasks involving Turso, SQLite, Drizzle, SQL, or Database
  schemas.
- **🌐 Web**: Tasks involving Frontend, Astro, React, or Web scopes.
- **📱 Mobile**: Tasks involving Mobile native, iOS, or Android scopes.
- **🧪 Testing**: Tasks tagged with `isQA` or involving Vitest / Playwright.
- **📝 Documentation**: Tasks tagged with `isRetro` or involving Markdown /
  Docs.
- **🛡️ Config/Security/Ops**: Tasks tagged with `isIntegration`, `isCodeReview`,
  or involving infra/workflow setup.
- **⚙️ General**: Default fallback for other tasks.

## Step 4 - Validation

After the script completes:

1. Open the generated `playbook.md` and verify it looks correct.
2. Confirm the Mermaid diagram accurately represents the dependency structure.
3. Confirm task numbering follows the `[SPRINT].[CHAT].[STEP]` convention.
4. If anything looks wrong, fix the `task-manifest.json` and re-run the script.

## Constraint

Adhere strictly to the JSON schema. Do NOT write the playbook markdown manually.
The script owns the output format entirely. Your only output artifact is the
`task-manifest.json` file.
