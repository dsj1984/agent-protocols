# Software Development Life Cycle (SDLC) Workflow

Our SDLC is designed for an AI-native engineering environment, leveraging
**v5 Epic-Centric GitHub Orchestration**. This model replaces the legacy local
playbook pipeline with a ticketing-native approach where GitHub Issues and
Project Board fields serve as the Single Source of Truth (SSOT).

---

## 💡 Core Guiding Principles

- **Ticketing as SSOT**: No local state files (like `playbook.md`). All project
  logic, work breakdown, and task status lives in GitHub.
- **Provider Abstraction**: While v5 ships with a reference GitHub provider, the
  logic is abstracted behind `ITicketingProvider` for future portability.
- **Agentic Autonomy**: Planning and execution are decoupled. Agents "pick up"
  tasks from the backlog, implementation happens on isolated feature branches,
  and state syncs back to GitHub in real-time.
- **Human-in-the-Loop (HITL)**: Humans define the vision (Epics), trigger
  planning, and approve high-risk tasks.

---

## 🗺️ The End-to-End SDLC Process

```mermaid
graph LR
    classDef manual fill:#f9d0c4,stroke:#333,stroke-width:2px,color:#000;
    classDef agentic fill:#c4f9d0,stroke:#333,stroke-width:2px,color:#000;
    classDef artifact fill:#ececec,stroke:#333,stroke-width:1px,stroke-dasharray: 5 5,color:#000;

    %% Phase 1: Initiation
    subgraph Phase1 ["Phase 1: Initiation"]
        direction TB
        A["👤 Create GitHub Epic<br/>(Write Goal & Scope)"]:::manual
        B["👤 Run /sprint-plan"]:::manual
        A --> B
    end

    %% Phase 2: Autonomous Planning
    subgraph Phase2 ["Phase 2: Planning"]
        direction TB
        C["🤖 Epic Planner<br/>(Generate PRD & Tech Spec)"]:::agentic
        D["🤖 Ticket Decomposer<br/>(Epic ➔ Feature ➔ Story ➔ Task)"]:::agentic
        C --> D
        D -.-> D_Art["📄 GitHub Issue Hierarchy"]:::artifact
    end

    %% Phase 3: Execution
    subgraph Phase3 ["Phase 3: Execution"]
        direction TB
        E["🤖 /sprint-execute [Epic ID]<br/>(Dispatch Manifest)"]:::manual
        F["🤖 /sprint-execute [Task ID]<br/>(Context Hydration & Implementation)"]:::agentic
        E --> F
        F -.-> F_Art["📄 Feature Branch PRs"]:::artifact
    end

    %% Phase 4: Integration & Closure
    subgraph Phase4 ["Phase 4: Closure"]
        direction TB
        G["🤖 /sprint-integration<br/>(Merge & Stabilize)"]:::agentic
        H["🤖 Bookend Lifecycle<br/>(QA ➔ Retro ➔ Close Epic)"]:::agentic
        G --> H
    end

    B --> C
    D --> E
    F --> G
```

---

## ⚡ Phase 1: Initiation (Manual)

The human product lead defines the "North Star" by creating a GitHub Issue
labeled with `type::epic`.

- **Goal**: Clear, plain-English description of the objective.
- **Scope**: (Optional) High-level bullet points.
- **Initiation**: The human runs `/sprint-plan [EPIC_ID]` in the agentic IDE.

---

## 🚀 Phase 2: Planning (Agentic)

The framework fetches the Epic and autonomously builds the work breakdown.

1.  **Epic Planner (`epic-planner.js`)**:
    - Synthesizes the Epic body + project documentation.
    - Generates a **PRD** (`context::prd`) and **Tech Spec** (`context::tech-spec`)
      as linked GitHub Issues.
2.  **Ticket Decomposer (`ticket-decomposer.js`)**:
    - Recursively decomposes the specs into a 4-tier hierarchy:
      `Epic ➔ Feature ➔ Story ➔ Task`.
    - **Wiring**: Each ticket is linked using GitHub's `blocked by #NNN` and
      tasklist syntax.
    - **Metadata**: Each Task is stamped with persona, model recommendations,
      estimated files, and agent prompts.
3.  **Roadmap Update**: The automated roadmap generator (`generate-roadmap.js`)
    detects the new Epic/Features and updates `docs/roadmap.md`.

---

## 🏗️ Phase 3: Execution (Agentic)

Execution is driven by the **Dispatcher** and **Context Hydrator**.

1.  **Dispatch Manifest**: `/sprint-execute [EPIC_ID]` builds the dependency DAG
    across all Tasks and identifies the current "wave" of executable work. It
    outputs a manifest table in the IDE.
2.  **Context Hydration**: When an agent runs `/sprint-execute #[TASK_ID]`, the
    **Context Hydrator** assembles a self-contained prompt string:
    - `agent-protocol.md` (Universal rules)
    - Persona & Skill directives
    - Hierarchy context (Story ➔ Feature ➔ Epic)
    - Task-specific instructions
3.  **State Sync**: Agents update their state in real-time on GitHub:
    - **Labels**: `agent::ready` ➔ `agent::executing` ➔ `agent::review` ➔ `agent::done`.
    - **Tasklists**: Check off atomic subtasks in the ticket body.
    - **Telemetry**: Friction logs are posted as comments on the Task issue.

---

## 🏁 Phase 4: Integration & Closure (Agentic)

Once Task waves are complete, the bookend lifecycle begins.

1.  **Integration**: `/sprint-integration` merges PRs into the Epic base branch,
    running a stabilization suite on ephemeral candidate branches.
2.  **Completion Cascade**: When a Task is integrated, status cascades up:
    `Task Done ➔ Story Done ➔ Feature Done ➔ Epic Done`.
3.  **Lifecycle Phases**:
    - **QA**: Runs `/sprint-testing` on the integrated Epic branch.
    - **Retro**: Runs `/sprint-retro` to summarize wins/friction from the ticket graph.
    - **Close-Out**: `/sprint-close-out` merges the Epic to `main`, tags the
      release, and closes the Epic issue.
