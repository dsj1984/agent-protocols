# Agent Protocols

A collection of personas and general instructions for agentic AI workflows.

## Project Structure

- `personas/`: Definitions for different agent personas (Architect, Engineer,
  Product, SRE).
- `general/`: Global instructions and core philosophies.
- `stacks/`: Technology stack specific guidelines.

## Development

### Prerequisites

- Node.js (v20 or later)
- npm

### Installation

```bash
npm install
```

### Quality Control

This project uses `markdownlint` for style checking and `prettier` for
formatting.

#### Linting

Check for markdown style issues:

```bash
npm run lint
```

#### Formatting

Automatically fix formatting issues:

```bash
npm run format
```

### Git Hooks

We use `husky` and `lint-staged` to ensure all commits meet our quality
standards. On every commit, changed markdown files are automatically linted and
formatted.

## CI/CD

GitHub Actions automatically runs the markdown linter on every push to `main`
and all pull requests to ensure consistency across the codebase.
