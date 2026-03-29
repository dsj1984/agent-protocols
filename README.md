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

#### A. Manual Update (Bash)

```bash
git submodule update --remote --merge .agents && git add .agents && git commit -m "chore: update agent-protocols"
```

#### B. Manual Update (PowerShell)

```powershell
git submodule update --remote --merge .agents; git add .agents; git commit -m "chore: update agent-protocols"
```

#### C. Automated Update (`package.json`)

Add the following script to your `package.json` for one-command updates:

```json
"scripts": {
  "update:agents": "git submodule update --remote --merge .agents && git add .agents && git commit -m \"chore: update agent-protocols\""
}
```

Now you can run: `npm run update:agents`.

1. **Read the Full Guide**: For detailed configuring, using personas/skills, and
   more, refer to the detailed protocol guide: 👉
   [**`.agents/README.md`**](.agents/README.md)

### Agent Notification Webhook

The `generate-sprint-playbook` workflow now supports an optional notification
webhook. If the `AGENT_NOTIFICATION_WEBHOOK` variable is set in the `AGENTS.md`
file at the project root, every completed playbook step will trigger a
notification to that URL. This allows for real-time tracking of agent progress
in external tools like Slack, Discord, or custom project management dashboards.

## Repository Structure

The core of this repository lives entirely within the `.agents/` directory,
which is what gets distributed to consumers.

```text
agent-protocols/
├── .agents/                 # ← Distributed to consumers via the `dist` branch
│   ├── config/              # Standardized agent configurations
│   │   ├── config.json
│   │   ├── models.json
│   │   └── tech-stack.json
│   ├── instructions.md      # Core system prompt & rules
│   ├── personas/            # Role-specific behavior constraints (12 personas)
│   ├── rules/               # Modular domain-agnostic global rules
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
