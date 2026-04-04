# Agent Protocols 🤖

Agent Protocols is a structured framework of instructions, personas, skills, and
SDLC workflows designed to optimize agentic AI coding assistants. It serves as a
centralized, shared foundation to help LLM-based agents maintain code quality,
architectural consistency, and professional standards across all your projects.

## Table of Contents

- [How to Use and Update](#how-to-use-and-update)
- [Repository Structure](#repository-structure)
- [Contributions](#contributions)
- [Personal Agentic Dev Stack](#personal-agentic-dev-stack)

## How to Use and Update

This framework is distributed via the `dist` branch and is meant to be added as
a Git submodule in your project's `.agents/` directory.

### 1. Initial Setup

Add the submodule to your project:

```bash
git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents
```

### 2. Update Strategies

Regularly update the protocols to pick up the latest personas and skills.

#### A. Manual Update (Bash / Zsh)

```bash
git submodule update --remote --merge .agents && git add .agents && git commit -m "chore: update agent-protocols"
```

#### B. Manual Update (PowerShell)

```powershell
git submodule update --remote --merge .agents ; if ($?) { git add .agents ; if ($?) { git commit -m "chore: update agent-protocols" } }
```

#### C. Automated Update (`package.json`)

Add the following script to your `package.json` for one-command updates. Note:
usage of `&&` in `package.json` scripts may fail in some Windows environments;
consider using a cross-platform runner like `npm-run-all2`.

```json
"scripts": {
  "update:agents": "git submodule update --remote --merge .agents && git add .agents && git commit -m \"chore: update agent-protocols\""
}
```

### 3. Configure Your Project

After adding the submodule, copy the bundled default configuration into your
project root and rename it:

```bash
cp .agents/default-agentrc.json .agentrc.json
```

Then open `.agentrc.json` and set your project-specific values (e.g.,
`techStack.project.name`, `agentSettings.testCommand`,
`agentSettings.baseBranch`).

> **How it works:** All agent scripts resolve configuration in this order:
>
> 1. `.agentrc.json` at your **project root** ← your customised file
> 2. `.agentrc.json` ← legacy fallback (deprecated, will emit a warning)
> 3. Built-in defaults (zero-config)

### 🛡️ Efficiency & Guardrails

The framework includes built-in guardrails to prevent agent stagnation and
ensure high-quality sprint execution:

- **Isolated Multi-Agent Parallelization**: Natively intercepts sprint workflows
  to wrap executed agents within `git worktree` isolated sub-directories,
  automatically blocking concurrent branch collisions.
- **Strict Workflow Patterns**: Injects CLI routing layers via `--pattern` on
  the `run-agent-loop.js` orchestrator to natively support Evaluator-Optimizer
  and Prompt Chaining behavior topologies.
- **Cryptographic Provenance**: (Configurable) Digitally signs agent-generated
  test receipts using asymmetric Ed25519 PKI. The framework establishes a true
  zero-trust chain of custody that will block playbook progression if receipts
  are altered or generated incorrectly.
- **Anti-Thrashing Protocol**: Mandates agents to halt and re-plan after hitting
  configurable thresholds for tool errors or analysis steps without progress.
  Controlled via `frictionThresholds` in `.agentrc.json`.
- **Complexity Ceilings (Instruction Density)**: Enforces task atomicity by
  limiting the number of logical steps/bullet points in a task's instructions.
  This ensures agents stay within a manageable cognitive context. Configurable
  via `maxInstructionSteps` (default: 5) in `.agentrc.json`.
- **Agent Friction Telemetry**: Agents are mandated to log operational struggles
  (repetitive tasks, errors) into a structured `agent-friction-log.json` file.
  Tolerance thresholds for logging are configurable via
  `frictionThresholds.repetitiveCommandCount`.
- **Workspace & File Hygiene**: Mandates that all temporary files and scratch
  scripts MUST be stored in the `/temp/` directory at the project root. This
  directory is Git-ignored by default to prevent repository pollution.
- **Local RAG Semantic Retrieval**: Zero-dependency local vector store
  implementation for high-context retrieval in large repositories. Prevents
  "lost-in-the-middle" issues and token bloat.
- **FinOps & Economic Guardrails**: Tracks agent token consumption against
  configurable sprint budgets. Enforces soft-warnings at thresholds and
  hard-stops to prevent unexpected expenses.
- **HITL Risk Gates**: Semantic security checks that force Human-In-The-Loop
  approval when an architect detects high-risk operations (e.g., destructive
  mutations, structural anomalies) during the technical specification phase.
- **Automated Context Pruning ("Gardener")**: Identifies and archives stale ADRs
  and coding patterns into a `[DOCS_ROOT]/archive/` directory during the sprint
  retro. This keeps the Local RAG index focused on the most current
  architecture.
- **Zero-Touch Remediation Loop**: Automatically transitions agents from a
  failed `/sprint-integration` candidate check into a `/sprint-hotfix` loop.
  Agents remediate build/test failures and re-attempt integration autonomously
  up to a configurable `maxIntegrationRetries` threshold (default: 2).
- **Dynamic Golden-Path Harvesting (Agentic RLHF)**: Automatically harvests
  zero-friction implementation diffs and instruction pairings into a local
  `.agents/golden-examples/` repository. These "Golden Paths" are dynamically
  injected as few-shot prompts in future tasks to autonomously reinforce the
  project's highest-quality coding standards.
- **Adversarial Red-Teaming (Tribunal)**: An on-demand `/run-red-team` workflow
  that calls the `security-engineer` to cross-examine a specific branch or
  directory, using dynamic fuzzing and mutation tests to break code before
  promotion.
- **Macroscopic Telemetry Observer**: A zero-dependency aggregation script that
  reads friction logs across sprints to visually chart tool failures, efficiency
  trends, and productivity bottlenecks.
- **Guiding Principles**: Prioritizes flexibility over rigid protocols, ensuring
  agents can leverage native model improvements.

1. **Read the Full Guide**: For detailed configuring, using personas/skills, and
   more, refer to the detailed protocol guide: 👉
   [**`.agents/README.md`**](.agents/README.md)

### Agent Notification Webhook

The `sprint-generate-playbook` workflow now supports an optional notification
webhook. If the `webhookUrl` variable is set in the `.agentrc.json` file, every
completed playbook step will trigger a notification to that URL. This allows for
real-time tracking of agent progress in external tools like Slack, Discord, or
custom project management dashboards.

## Repository Structure

The core of this repository lives entirely within the `.agents/` directory,
which is what gets distributed to consumers.

```text
agent-protocols/
├── .agents/                 # ← Distributed to consumers via the `dist` branch
│   ├── VERSION              # Current version of the protocols
│   ├── default-agentrc.json # ← Copy this to your project root as .agentrc.json
│   ├── instructions.md      # Core system prompt & rules
│   ├── personas/            # Role-specific behavior constraints (12 personas)
│   ├── rules/               # Modular domain-agnostic global rules
│   ├── schemas/             # JSON schemas for structured format boundaries
│   ├── scripts/             # Deterministic logic scripts (playbook gen, etc)
│   ├── skills/              # Tech-stack-specific guardrails
│   ├── templates/           # Markdown templates
│   ├── workflows/           # SDLC automation slash commands
│   └── README.md            # Detailed consumer user guide
├── .github/                 # CI/CD automation for this repository
├── package.json             # Tooling: markdownlint, prettier, husky
└── README.md                # ← You are here
```

> **Key distinction:** Only the `.agents/` directory is distributed to consumers
> via the `dist` branch. The rest of the repository contains internal tooling
> and CI/CD pipelines for developing the protocols.

## Contributions

If you are contributing to or modifying this repository:

### Prerequisites & Setup

- Node.js 20+
- npm

```bash
npm install
```

This also installs **Husky** Git hooks via the `prepare` script, which
configures **lint-staged** to auto-format and lint markdown files on every
commit.

### Quality Control

All markdown is validated with `markdownlint` and formatted with `prettier`:

| Command          | Description                        |
| ---------------- | ---------------------------------- |
| `npm run lint`   | Check all markdown for lint errors |
| `npm run format` | Auto-format all markdown files     |

### Git Workflow

1. Create a feature branch from `main`.
2. Make your changes to files inside `.agents/`.
3. Commit — Husky + lint-staged will automatically lint and format staged `.md`
   files before the commit is accepted.
4. Open a Pull Request against `main`. The `ci.yml` workflow will validate your
   changes.

### Release Process

When preparing a new release of the protocols:

1.  **Bump Version**: Update the version number in `package.json`.
2.  **Sync VERSION File**: Update the `.agents/VERSION` file to match. This file
    is distributed to consumers to help them identify their current protocol
    version.
3.  **Update Changelog**: Add a new entry to `CHANGELOG.md` under the new
    version header.
4.  **Commit**: Commit the changes to `main`.
5.  **Publish**: The `ci.yml` workflow will automatically sync the `.agents/`
    directory to the `dist` branch upon merge.

### CI/CD Pipeline

| Workflow | Trigger           | Purpose                                                          |
| -------- | ----------------- | ---------------------------------------------------------------- |
| `ci.yml` | Push/PR to `main` | Validates markdown, runs security scans, and syncs `dist` branch |

When changes to `.agents/**` are merged into `main`, the `ci` workflow
automatically copies the `.agents/` directory contents to the `dist` branch if
the build passes. Consumers pinned to `dist` will pick up the changes on their
next submodule update.

## Personal Agentic Dev Stack

The development of these protocols leverages an agent-first stack optimized for
speed, precision, and high-context reasoning:

- **LLM Engine:** Google AI Ultra
- **Planning Assistant:** Gemini Deep Think
- **Agentic IDE:** Google Antigravity IDE (using Gemini & Claude models)
- **Asynchronous Agent:** Google Jules (experimental)
- **Context Engine:** Context7 (indirectly via MCP)
- **Voice Interface:** Wispr Flow
