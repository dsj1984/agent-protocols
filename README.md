# Agent Protocols 🤖

A structured framework of instructions, personas, skills, and SDLC workflows
that govern AI coding assistants built on **Epic-Centric GitHub Orchestration**
— all planning, execution, and state management lives natively in GitHub Issues,
Labels, and Projects V2.

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
        E["DAG-Based Story Dispatch"]
        F["Context Hydration & Implementation"]
    end

    subgraph Closure ["🤖 Integration & Closure"]
        G["Story Branch Merging & Stabilization"]
        H["Completion Cascade & Release"]
    end

    subgraph Quality ["🔍 Continuous Quality"]
        I["Gate-Based Audit Orchestration"]
        J["85%+ Coverage Ratchet & Mutation Testing"]
    end

    A --> B --> C --> D --> E --> F --> G --> H
    F --> I --> J
```

- **GitHub as SSOT**: Issues, Labels, and Projects V2 are the single source of
  truth. No local playbooks or sprint files.
- **Provider Abstraction**: All ticketing operations flow through
  `ITicketingProvider`, an abstract interface with a shipped GitHub
  implementation using native `fetch()` (Node 20+).
- **Two-Command UX**: `/sprint-plan` generates PRDs, Tech Specs, and a full
  4-tier task hierarchy. `/sprint-execute` dispatches work in Story-grouped
  waves, using shared context branches to minimize integration friction.
- **Self-Contained**: Zero external SDK dependencies for core orchestration. No
  `@octokit/*`, no Axios — just raw HTTP and GraphQL.
- **Gate-Based Quality**: An automated audit orchestration pipeline selects and
  runs relevant audits at four sprint lifecycle gates, enforcing a
  maintainability ratchet that prevents code quality degradation.
- **Autonomous Roadmaps**: Synchronize `ROADMAP.md` directly from GitHub Epics
  using the `/roadmap-sync` workflow, featuring visual progress bars.

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

### 2b. MCP Activation (Optional but Recommended)

For the best agentic experience, add the orchestration server to your IDE or MCP
host:

```json
"agent-protocols": {
  "command": "node",
  "args": ["/absolute/path/to/your/project/.agents/scripts/mcp-orchestration.js"]
}
```

This enables agents to use native tools like `dispatch_wave` instead of raw
shell commands. See [.agents/README.md](.agents/README.md) for full
configuration details.

### 3. Plan Your First Epic

Create a GitHub Issue with the `type::epic` label, then run:

```text
/sprint-plan [EPIC_NUMBER]
```

See [SDLC.md](.agents/SDLC.md) for the full end-to-end workflow and the
[/roadmap-sync](.agents/workflows/roadmap-sync.md) guide for visualization.

---

## Repository Structure

```text
agent-protocols/
├── .agents/                  # Distributed bundle (the "product")
│   ├── VERSION               # Current version (5.2.3)
│   ├── instructions.md       # Primary system prompt
│   ├── SDLC.md               # End-to-end workflow guide
│   ├── README.md             # Detailed consumer reference
│   ├── personas/             # Role-specific behavior (12 personas)
│   ├── rules/                # Domain-agnostic coding standards (8 rules)
│   ├── skills/               # Two-tier skill library
│   │   ├── core/             # Universal process skills (20 skills)
│   │   └── stack/            # Tech-stack-specific guardrails (20 skills)
│   ├── workflows/            # Slash-command automation (24 workflows)
│   ├── scripts/              # Orchestration engine
│   │   ├── lib/              # Core libraries (config, interfaces, factory)
│   │   │   ├── orchestration/  # SDK (dispatcher, hydrator, ticketing)
│   │   │   ├── presentation/   # Manifest rendering
│   │   │   └── mcp/            # MCP tool registry
│   │   ├── mcp/              # MCP tool implementations
│   │   └── providers/        # Ticketing provider implementations
│   ├── schemas/              # JSON Schemas for validation
│   └── templates/            # Context hydration templates
├── docs/                     # Changelog and legacy archive
├── tests/                    # Unit and integration tests
├── package.json              # Tooling: markdownlint, prettier, husky
```

## Development

```powershell
npm run lint           # Check all markdown for lint errors
npm run format         # Auto-format all markdown files
npm test               # Run framework tests
npm run test:coverage  # Run tests with 85% coverage gate
npm run mutate         # Run Stryker mutation testing
```

## Documentation

| Document                                         | Purpose                        |
| ------------------------------------------------ | ------------------------------ |
| [Consumer Guide](.agents/README.md)              | Setup, configuration, and APIs |
| [SDLC Workflow](.agents/SDLC.md)                 | End-to-end sprint lifecycle    |
| [Changelog](docs/CHANGELOG.md)                   | Release history (v5.0.0+)      |
| [Legacy Changelog](docs/archive/CHANGELOG-v4.md) | v1.0.0 – v4.7.2 history        |

## License

ISC
