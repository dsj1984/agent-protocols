# Agent Protocols 🤖

A structured framework of instructions, personas, skills, and SDLC workflows
that govern AI coding assistants. Version 5 is a **ground-up rewrite** built on
**Epic-Centric GitHub Orchestration** — all planning, execution, and state
management lives natively in GitHub Issues, Labels, and Projects V2.

## Architecture Overview

```mermaid
graph LR
    subgraph Human ["👤 Human"]
        A["Create Epic Issue"]
        B["Trigger /sprint-plan"]
    end

    subgraph Planning ["🤖 Autonomous Planning"]
        C["PRD & Tech Spec Generation"]
        D["4-Tier Ticket Decomposition"]
    end

    subgraph Execution ["🤖 Agentic Execution"]
        E["DAG-Based Task Dispatch"]
        F["Context Hydration & Implementation"]
    end

    subgraph Closure ["🤖 Integration & Closure"]
        G["Branch Integration & Stabilization"]
        H["Completion Cascade & Release"]
    end

    A --> B --> C --> D --> E --> F --> G --> H
```

- **GitHub as SSOT**: Issues, Labels, and Projects V2 are the single source of
  truth. No local playbooks or sprint files.
- **Provider Abstraction**: All ticketing operations flow through
  `ITicketingProvider`, an abstract interface with a shipped GitHub
  implementation using native `fetch()` (Node 20+).
- **Two-Command UX**: `/sprint-plan` generates PRDs, Tech Specs, and a full
  4-tier task hierarchy. `/sprint-execute` dispatches work in dependency-ordered
  waves.
- **Self-Contained**: Zero external SDK dependencies for core orchestration. No
  `@octokit/*`, no Axios — just raw HTTP and GraphQL.

## Get Started

### 1. Install & Bootstrap

```powershell
# Add submodule (uses the dist branch)
git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents

# Run idempotent bootstrap (creates labels, project fields)
node .agents/scripts/bootstrap-agent-protocols.js --install-workflows
```

### 2. Configure

Copy `.agents/default-agentrc.json` to your project root as `.agentrc.json` and
set your repository details:

```json
{
  "orchestration": {
    "provider": "github",
    "github": {
      "owner": "your-org",
      "repo": "your-repo",
      "operatorHandle": "@your-username"
    }
  }
}
```

Set `GITHUB_TOKEN` in your environment (or a `.env` file at the project root)
for background script authentication.

### 3. Plan Your First Epic

Create a GitHub Issue with the `type::epic` label, then run:

```text
/sprint-plan [EPIC_NUMBER]
```

See [SDLC.md](.agents/SDLC.md) for the full end-to-end workflow.

---

## Repository Structure

```text
agent-protocols/
├── .agents/                  # Distributed bundle (the "product")
│   ├── VERSION               # Current version (5.0.0)
│   ├── instructions.md       # Primary system prompt
│   ├── SDLC.md               # End-to-end workflow guide
│   ├── README.md             # Detailed consumer reference
│   ├── personas/             # Role-specific behavior (12 personas)
│   ├── rules/                # Domain-agnostic coding standards (8 rules)
│   ├── skills/               # Two-tier skill library
│   │   ├── core/             # Universal process skills (20 skills)
│   │   └── stack/            # Tech-stack-specific guardrails (19 skills)
│   ├── workflows/            # Slash-command automation (25 workflows)
│   ├── scripts/              # Orchestration engine
│   │   ├── lib/              # Core libraries (config, interfaces, factory)
│   │   └── providers/        # Ticketing provider implementations
│   ├── schemas/              # JSON Schemas for validation
│   └── templates/            # Context hydration templates
├── docs/                     # Roadmap and legacy changelog archive
├── tests/                    # Unit and integration tests
├── package.json              # Tooling: markdownlint, prettier, husky
└── CHANGELOG.md              # Release history (v5.0.0+)
```

## Development

```powershell
npm run lint           # Check all markdown for lint errors
npm run format         # Auto-format all markdown files
npm test              # Run framework tests
```

## Documentation

| Document                                | Purpose                        |
| --------------------------------------- | ------------------------------ |
| [Consumer Guide](.agents/README.md)     | Setup, configuration, and APIs |
| [SDLC Workflow](.agents/SDLC.md)       | End-to-end sprint lifecycle    |
| [Changelog](CHANGELOG.md)               | Release history (v5.0.0+)     |
| [Legacy Changelog](docs/CHANGELOG-v4.md) | v1.0.0 – v4.7.2 history     |

## License

ISC
