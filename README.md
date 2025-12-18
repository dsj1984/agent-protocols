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
