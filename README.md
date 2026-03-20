# Agent Protocols 🤖

A structured framework of personas and global instructions designed to optimize
agentic AI workflows. This repository provides a shared foundation for LLM-based
agents to maintain quality, consistency, and professional standards across
projects.

## 📂 Project Structure

- **`personas/`**: Specialized roles for agents (Architect, Engineer, Product,
  SRE).
- **`general/`**: Core philosophies and cross-functional instructions.

## 🚀 Consumption

The most efficient way to use these protocols is as a Git submodule in your
target project:

```bash
git submodule add -b dist https://github.com/Area-Code-Technologies/agent-protocols.git .agent/protocols
```

> **Note:** The `dist` branch is automatically synchronized by CI to contain
> only the relevant markdown files, keeping your project's repository clean.

### Staying Up to Date

Because the submodule pins to a specific commit, you need to pull the latest
changes periodically. Choose the approach that fits your workflow:

#### Manual Update

From the root of your consuming project:

```bash
git submodule update --remote .agent/protocols
git add .agent/protocols
git commit -m "chore: update agent-protocols to latest"
```

#### Automatic on `npm install` (Recommended)

Add a `postinstall` script to your project's `package.json` so the submodule is
refreshed every time dependencies are installed:

```jsonc
{
  "scripts": {
    "postinstall": "git submodule update --init --remote .agent/protocols",
  },
}
```

This ensures every contributor gets the latest protocols after running
`npm install` — no manual step required.

#### CI-Based Update

For teams that want a pull request whenever protocols change, add a scheduled
GitHub Action to your consuming repo:

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
        run: git submodule update --remote .agent/protocols

      - name: Create PR if changed
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: 'chore: update agent-protocols submodule'
          title: 'chore: update agent-protocols to latest'
          branch: chore/update-agent-protocols
          delete-branch: true
```

## 🛠 Development

### Setup

```bash
npm install
```

### Quality Control

We use `markdownlint` and `prettier` to ensure documentation remains clean and
consistent.

- **Check Linting:** `npm run lint`
- **Apply Formatting:** `npm run format`

### Git Workflow

This project utilizes **Husky** and **lint-staged**. Every commit is
automatically validated and formatted before it is accepted.

### CI/CD

Continuous Integration via GitHub Actions validates every Pull Request and
handles the deployment of the `dist` branch upon merges to `main`.
