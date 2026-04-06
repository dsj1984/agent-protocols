# Agent Protocols 🤖

Agent Protocols is a structured framework of instructions, personas, skills, and
SDLC workflows designed to optimize agentic AI coding assistants. v5 introduces
a **clean-break, Epic-centric architecture** that replaces local planning files
with native GitHub orchestration.

## v5 Architecture Highlights

- **Ticketing as SSOT**: GitHub Issues, Labels, and Projects V2 are the Single
  Source of Truth. No more `playbook.md` or `docs/sprints/`.
- **Autonomous Planning**: `/sprint-plan` automatically generates PRDs, Tech
  Specs, and a 4-tier task hierarchy (Epic ➔ Feature ➔ Story ➔ Task) in GitHub.
- **DAG-Based Dispatching**: `/sprint-execute` builds a dependency graph of all
  tasks under an Epic and dispatches them in optimized waves.
- **Context Hydration**: Agents receive a fully hydrated virtual context
  assembled from the GitHub hierarchy, persona directives, and skill
  instructions.
- **Automated Roadmap**: `docs/roadmap.md` is a read-only artifact
  auto-generated from your live GitHub Epics and Features.

## Get Started in 3 Steps

### 1. Install & Bootstrap

Add the submodule and initialize your GitHub repository metadata:

```powershell
# Add submodule
git submodule add -b dist https://github.com/dsj1984/agent-protocols.git .agents

# Run idempotent bootstrap (requires GITHUB_TOKEN)
node .agents/scripts/bootstrap-agent-protocols.js --install-workflows
```

### 2. Configure Orchestration

Copy `.agents/default-agentrc.json` to `.agentrc.json` and set your repo
details:

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

### 3. Plan Your First Epic

Create a GitHub Issue with the `type::epic` label, then run:

```powershell
/sprint-plan [EPIC_NUMBER]
```

---

## Repository Structure

```text
agent-protocols/
├── .agents/                 # Distributed bundle (the "product")
│   ├── VERSION              # Current version (v5.0.0+)
│   ├── instructions.md      # Primary system prompt
│   ├── personas/            # Role-specific behavior (12 personas)
│   ├── rules/               # Global coding standards
│   ├── skills/              # Two-tier skill library (core/ + stack/)
│   ├── workflows/           # SDLC automation (37 workflows)
│   ├── scripts/             # v5 Orchestration logic (dispatcher, planner, etc.)
│   └── README.md            # Detailed consumer user guide
├── docs/                    # Roadmap and v5 implementation notes
├── tests/                    # Unit and integration tests
├── package.json             # Tooling: markdownlint, prettier, husky
└── CHANGELOG.md             # Release history
```

## Contributions

See the [Contributing Guide](.agents/README.md#contributions) in the consumer
README for details on how to propose changes to the framework.

## Personal Agentic Dev Stack

- **LLM Engine:** Google AI Ultra / Gemini 2.0
- **Agentic IDE:** Google Antigravity IDE
- **Context Engine:** Context7 (MCP)
