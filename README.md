# Agent Protocols 🤖

A structured framework of instructions, personas, skills, and SDLC workflows
designed to optimize agentic AI coding assistants. This repository provides a
shared foundation for LLM-based agents to maintain quality, consistency, and
professional standards across projects.

## 📂 Repository Layout

```text
agent-protocols/
├── .agents/                 # ← Distributed to consumers via the `dist` branch
│   ├── VERSION              # Current version of the protocols
│   ├── instructions.md      # Consolidated system prompt & core philosophies
│   ├── README.md            # Consumer-facing user guide
│   ├── personas/            # Role-specific constraint files
│   ├── skills/              # Modular tech-stack guardrails (organized by category)
│   ├── templates/           # Sprint planning markdown templates
│   └── workflows/           # Reusable single-command SDLC workflows (organized by type)
├── .github/workflows/       # CI/CD automation
│   └── ci.yml               # Linting, testing, and deployment
├── package.json             # Tooling: markdownlint, prettier, husky
└── README.md                # ← You are here (internal contributor guide)
```

> **Key distinction:** Only the `.agents/` directory is distributed to
> consumers. Everything else (CI configs, tooling, this README) stays internal
> to this repository.

## 🚀 How Consumers Use This

Consumers add the **`dist` branch** as a Git submodule into their project's
`.agent` directory:

```bash
git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents
```

This gives them a `.agents/` folder containing the instructions bundle directly:
`.agents/README.md`, `.agents/instructions.md`, `.agents/personas/`,
`.agents/skills/`, `.agents/workflows/`, and more. See
[`.agents/README.md`](.agents/README.md) for the consumer-facing user guide.

### Consumer Update Strategies

#### Manual (One-Liner)

**Bash/Zsh:**

```bash
git submodule update --remote .agents && git commit -m "chore: update agent-protocols to latest" .agents
```

**PowerShell:**

```powershell
git submodule update --remote .agents; if ($?) { git commit -m "chore: update agent-protocols to latest" .agents }
```

#### Automatic on `npm install` (Recommended)

```jsonc
{
  "scripts": {
    "postinstall": "git submodule update --init --remote .agents",
  },
}
```

#### CI-Based (Scheduled PR)

```yaml
# .github/workflows/update-protocols.yml
name: Update Agent Protocols
on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9am UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true

      - name: Pull latest protocols
        run: git submodule update --remote .agents

      - name: Create PR if changed
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: 'chore: update agent-protocols submodule'
          title: 'chore: update agent-protocols to latest'
          branch: chore/update-agent-protocols
          delete-branch: true
```

## 🛠 Development

### Prerequisites

- Node.js 20+
- npm

### Setup

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
4. Open a Pull Request against `main`. The `lint.yml` workflow will validate
   your changes.

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
