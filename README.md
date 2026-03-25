# Agent Protocols 🤖

Agent Protocols is a structured framework of instructions, personas, skills, and
SDLC workflows designed to optimize agentic AI coding assistants. It serves as a
centralized, shared foundation to help LLM-based agents maintain code quality,
architectural consistency, and professional standards across all your projects.

## 🚀 How to Use This Project

This repository distributes its core protocols via the `dist` branch. Consumers
can add this framework to their own projects as a Git submodule.

1. **Add the submodule** to your project's `.agents` directory:

   ```bash
   git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents
   ```

2. **Read the Full Guide**: For complete instructions on configuring your AI
   tools, using personas/skills, and detailed update strategies, refer to the
   consumer-facing user guide: 👉 [**`.agents/README.md`**](.agents/README.md)

## 📂 Repository Structure

The core of this repository lives entirely within the `.agents/` directory,
which is what gets distributed to consumers.

```text
agent-protocols/
├── .agents/                 # ← Distributed to consumers via the `dist` branch
│   ├── instructions.md      # Core system prompt & rules
│   ├── personas/            # Role-specific behavior constraints
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

## 🛠 Internal Development

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

## 💻 My Personal Agentic Development Stack

The development of these protocols leverages an agent-first stack optimized for
speed, precision, and high-context reasoning:

- **LLM Engine:** Google AI Ultra
- **Planning Assistant:** Gemini Deep Think
- **Agentic IDE:** Google Antigravity IDE (using Gemini & Claude models)
- **Asynchronous Agent:** Google Jules (experimental)
- **Context Engine:** Context7 (indirectly via MCP)
- **Voice Interface:** Wispr Flow
