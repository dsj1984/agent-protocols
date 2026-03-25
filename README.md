# Agent Protocols 🤖

A structured framework of instructions, personas, skills, and SDLC workflows
designed to optimize agentic AI coding assistants. This repository provides a
shared foundation for LLM-based agents to maintain quality, consistency, and
professional standards across projects.

## 📂 Repository Layout

```text
agent-protocols/
├── instructions/            # ← Distributed to consumers via the `dist` branch
│   ├── instructions.md      # Global agent behavior and core philosophies
│   ├── README.md            # Consumer-facing user guide
│   ├── personas/            # Role-specific constraint files
│   │   ├── architect.md
│   │   ├── engineer.md
│   │   ├── product.md
│   │   └── sre.md
│   ├── skills/              # Modular tech-stack guardrails
│   │   ├── sqlite-drizzle-expert/
│   │   ├── cloudflare-hono-architect/
│   │   ├── cloudflare-queue-manager/
│   │   ├── zero-trust-security-engineer/
│   │   ├── astro-react-island-strategist/
│   │   ├── expo-react-native-developer/
│   │   ├── monorepo-path-strategist/
│   │   ├── resilient-qa-automation/
│   │   ├── stripe-billing-expert/
│   │   └── ui-accessibility-engineer/
│   └── sdlc/                # Sprint planning workflows and templates
│       ├── planning-workflow.md
│       └── spec-templates/
├── .github/workflows/       # CI/CD automation
│   ├── lint.yml             # PR markdown linting
│   └── publish-dist.yml     # Deploys instructions/ to the dist branch
├── package.json             # Tooling: markdownlint, prettier, husky
└── README.md                # ← You are here (internal contributor guide)
```

> **Key distinction:** Only the `instructions/` directory is distributed to
> consumers. Everything else (CI configs, tooling, this README) stays internal
> to this repository.

## 🚀 How Consumers Use This

Consumers add the **`dist` branch** as a Git submodule into their project's
`.agent` directory:

```bash
git submodule add -b dist https://github.com/Area-Code-Technologies/agent-protocols.git .agents
```

This gives them a `.agents/` folder containing the instructions bundle directly:
`.agents/README.md`, `.agents/instructions.md`, `.agents/personas/`,
`.agents/skills/`, `.agents/sdlc/`, and more. See
[`instructions/README.md`](instructions/README.md) for the consumer-facing user
guide.

### Consumer Update Strategies

#### Manual

```bash
git submodule update --remote .agents
git add .agents
git commit -m "chore: update agent-protocols to latest"
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
2. Make your changes to files inside `instructions/`.
3. Commit — Husky + lint-staged will automatically lint and format staged `.md`
   files before the commit is accepted.
4. Open a Pull Request against `main`. The `lint.yml` workflow will validate
   your changes.

### CI/CD Pipeline

| Workflow           | Trigger                        | Purpose                                    |
| ------------------ | ------------------------------ | ------------------------------------------ |
| `lint.yml`         | Push/PR to `main`              | Validates all markdown via `npm run lint`  |
| `publish-dist.yml` | Push to `main` (instructions/) | Syncs `instructions/` to the `dist` branch |

When changes to `instructions/**` are merged into `main`, the `publish-dist`
workflow automatically copies the `instructions/` directory to the `dist`
branch. Consumers pinned to `dist` will pick up the changes on their next
submodule update.
