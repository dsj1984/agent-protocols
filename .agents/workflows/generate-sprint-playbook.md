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
  _Depends on: None._
- (B) Chat Session 2 (Web UI) & Chat Session 3 (Mobile UI). _Concurrent._ These
  sessions fan-out and run in parallel ONLY after Chat Session 1 is complete.
  (Tasks: X.2.1 and X.3.1)  
  _Depends on: Chat Session 1._
- (C) Chat Session 4 (QA Test Plan Generation & Execution). _Sequential in a
  FRESH chat._ (Tasks: X.4.1, X.4.2)  
  _Depends on: Chat Session 2 AND Chat Session 3._
- (D) Chat Session 5 (Retro & Documentation). _Sequential._ (Tasks: X.5.1)  
  _Depends on: Chat Session 4._

TASK SCOPING RULE: Keep individual tasks highly focused. A single task should
instruct the agent to modify no more than 2 to 3 files.

## Step 3 - Model Routing and Persona Assignment

### Model Selection Guidance

**The Architects (Planning & Complex Problem Solving)** _These models are your
"Lead Engineers." Use them when the agent needs to design systems, resolve
complex bugs, or map out a multi-step execution plan._

- **Claude Opus 4.6 (Thinking):** Use this as your ultimate escalation model. If
  your agent is stuck in a loop, failing to resolve a bug after multiple
  attempts, or needs to design a complex, multi-file system architecture from
  scratch, Opus with "Thinking" will give you the deepest reasoning and highest
  success rate. It is slow and expensive, so reserve it for when the agent must
  get the logic right the first time.
- **Gemini 3.1 Pro (High):** Use this for heavy-lifting tasks that require
  massive context windows and deep synthesis. If your agent needs to ingest an
  entire large repository, understand the interactions between distant
  microservices, or execute a massive, sweeping refactor, the "High" effort
  setting ensures it thoroughly analyzes the codebase before writing.

**The Workhorses (Feature Execution)** _These models are your "Mid-Level
Developers." They offer the best balance of intelligence and speed for
day-to-day autonomous tasks._

- **Claude Sonnet 4.6 (Thinking):** This is arguably the best default model for
  your primary coding agent. Because it has "Thinking" enabled, it can reliably
  break down a Jira ticket or feature request, plan the necessary file changes,
  and execute them without the latency and cost of Opus. Use it for standard
  feature implementations and API integrations.
- **Gemini 3.1 Pro (Low):** Use this when you need top-tier coding knowledge
  (rare languages, complex frameworks) but the task itself is straightforward
  and doesn't require deep, multi-step reasoning. Setting it to "Low" effort
  reduces latency, making it great for writing complex unit tests or translating
  code from one language to another where the logic is already defined.

**The Sprinters (Rapid Iteration & Tool Use)** _These models are your "Junior
Devs" or "Linters." They are built for speed and volume._

- **Gemini 3 Flash:** Use this for the "inner loop" of your agentic workflow.
  Flash is perfect for highly repetitive, low-reasoning tasks: generating
  boilerplate code, fixing simple syntax errors caught by the compiler,
  formatting data, or acting as a fast "critic" agent that briefly reviews the
  output of other models before it gets committed.

**The Specialists (Privacy & Local/Custom Needs)** _Large open-weight models for
restricted environments._

- **GPT-OSS 120B (Medium):** This represents a large open-weight model. Use this
  if your agent is handling highly sensitive, proprietary data that you are
  restricted from sending to commercial APIs. A 120B model is highly capable for
  standard coding tasks, and the "Medium" setting provides a good balance of
  compute efficiency if you are running it on limited internal infrastructure.

**How to chain them together:** A highly efficient agentic workflow usually uses
a Planner-Executor-Reviewer pattern. For example, you might use **Claude Opus
4.6 (Thinking)** to read the prompt and write the architectural plan, pass that
plan to **Claude Sonnet 4.6 (Thinking)** or **Gemini 3.1 Pro (Low)** to actually
write the files, and use **Gemini 3 Flash** to rapidly fix any compilation
errors the agent encounters along the way.

Personas & Active Skills: _You MUST dynamically assign all applicable skills to
every task based on the context of the work. Select the appropriate skills from
the `.agents/skills/` (or equivalent) directory. Do not leave the skills field
blank._

- ARCHITECT: Specifications, schemas, APIs.
- ENGINEER: Implementation (Web, Mobile).
- PRODUCT: Retro and Roadmap alignment.
- QA AUTOMATION ENGINEER: Test plan generation (writing to
  `docs/test-plans/sprint-test-plans/sprint-[SPRINT_NUMBER]-test-plan.md`) and
  automated test execution.

## Step 4 - Strict Output Formatting

Generate the markdown playbook for the Sprint.

**CRITICAL FORMATTING RULES:**

1. NO OUTER WRAPPER: You must output raw Markdown. Do NOT wrap your entire
   response in an outer set of backticks (e.g., do not start the file with
   ```markdown). Start directly with the `# Sprint [NUMBER] Playbook` header.
2. THE NO-SUMMARIZATION RULE: You are strictly forbidden from modifying or
   summarizing the `AGENT EXECUTION PROTOCOL`. You must copy the text from the
   template below EXACTLY word-for-word for every single task.

**Document Structure:**

1. **Title:** `# Sprint [NUMBER] Playbook: [Sprint Name]`
1. **Summary:** Create a `## Sprint Summary` section. Write a concise 2-3
   sentence overview of the sprint's core objectives, technical scope, and
   business value based on your analysis of the PRD.
1. **Execution Flow:** Create a `## Fan-Out Execution Flow` section and include
   this exact Mermaid diagram beneath it:

```mermaid
graph TD
    A[Chat 1: Backend Foundation] --> B[Chat 2: Web UI]
    A --> C[Chat 3: Mobile UI]
    B --> D[Chat 4: QA & E2E Testing]
    C --> D
    D --> E[Chat 5: Retro & Documentation]
```

1. **Chat Sessions:** Use the following Chat Session Headers exactly as written:
   `### 💬 ⚙️ Chat Session 1: Backend Foundation (Sequential)`
   `### 💬 ⚡ Chat Session 2: Web UI (Concurrent)`
   `### 💬 📱 Chat Session 3: Mobile UI (Concurrent)`
   `### 💬 🧪 Chat Session 4: QA & E2E Testing (Sequential)`
   `### 💬 🔄 Chat Session 5: Retro & Documentation (Sequential)`

**TASK TEMPLATE:** Every task MUST exactly match this semantic structure:

- [ ] **[SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER] [Task Title]**

**Mode:** [Planning/Fast] **Model:** [Model Name]

```text
Sprint [SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER]: Act as an [Persona].

**AGENT EXECUTION PROTOCOL (STRICT ADHERENCE REQUIRED):**
1. **Prerequisite Check**: Open `playbook.md` and verify all tasks with lower `STEP` numbers in this chat AND all tasks in [MANDATORY_PREVIOUS_CHATS] are marked `[x]`. (Note: This chat Session is [CHAT_NUMBER]; refer to the Fan-Out Flow diagram for dependencies). If not, **STOP** and alert the user.
2. **Execution**: Perform the task instructions below.
3. **Validation**: Ensure all validation and pre-commit hooks pass (`npm run lint`, etc.).
4. **Commit**: `[type]([scope]): [lowercase conventional commit message]`
5. **Completion**: Mark this task as complete (`- [x]`) in `playbook.md` BEFORE ending the session.
6. **Notification**: If the variable `AGENT_NOTIFICATION_WEBHOOK` is defined in the `AGENTS.md` file, make a webhook call to that URL with a message indicating that sprint step `[SPRINT_NUMBER].[CHAT_NUMBER].[STEP_NUMBER]` was completed. If the variable is not set, fail gracefully without error.

**Active Skills:** `[comma-separated list of all applicable skills]`

[Detailed task instructions here. MUST explicitly list file paths.]

[CRITICAL FOR QA TASKS: Chat Session 4 MUST include a specific task to maintain/update fake/sample test data (seed files, mocks, etc.) and update the Manual Test Plan Documentation in `docs/test-plans/sprint-test-plans/sprint-[SPRINT_NUMBER]-test-plan.md` for new sprint features using the Dual-Purpose standard. Following the documentation task, include a separate execution task using the `/run-test-plan` workflow against those updated files. DO NOT invent Playwright tests from scratch.]
```

## Step 5 - Output Artifacts

Save the generated playbook into
`docs/sprints/sprint-[SPRINT_NUMBER]/playbook.md`.

## Constraint

Adhere strictly to the templates and instructions provided. Do not summarize the
protocol. Do NOT use an outer markdown code block wrapper for the file.
