# Clean Code Audit Report

## Executive Summary

The codebase has a **Medium** maintainability index. Following the recent architectural refactoring in the `lib/orchestration` SDK layer, the core Directed Acyclic Graph (DAG) logic and integration processes are isolated. However, clean code and maintainability issues remain in some core scripts. The main themes identified are violations of the Single Responsibility Principle (SRP) — characterized by large, multi-purpose functions — and instances of code duplication where generic platform logic is reinvented rather than utilizing the shared SDK abstractions.

## Detailed Findings

### Monolithic Orchestration in `epic-planner.js`

- **Dimension:** SOLID Principles (Single Responsibility Principle)
- **Impact:** High
- **Current State:** The `planEpic` function is a monolithic procedure exceeding 250 lines. It intertwines multiple distinct concerns: fetching GitHub Epic states, orchestrating complex idempotency state resolution (healing dangling PRDs and purging redundant/duplicate artifacts), reading filesystem documentation (`fs.readFileSync`), invoking the LLM, and generating GitHub ticketing payloads.
- **Recommendation & Rationale:** Extract distinct responsibilities into specialized modules. The idempotency and state-healing blocks (over 100 lines of manual artifact tracking) should be abstracted into a `planning-state-manager` utility. The local filesystem scraping should be moved to a standalone documentation reader component. This refactor makes `epic-planner.js` highly testable, readable, and focused purely on orchestrating the planning sequence.
- **Agent Prompt:**
  `Refactor epic-planner.js: Extract the artifact healing and redundancy closure logic (lines 63-178) into a separate utility module in lib/orchestration (e.g., planning-state-manager.js). Next, extract the documentation file scraping (lines 224-264) into a lightweight helper function. Ensure planEpic retains only high-level workflow orchestration.`

### Duplication of Platform Abstractions in `delete-epic.js`

- **Dimension:** DRY (Don't Repeat Yourself) & Architectural Standards
- **Impact:** Medium
- **Current State:** The `delete-epic.js` script manually manages its own GitHub token resolution via `resolveToken()` (using `process.env` and child processes) and repository resolution via `resolveRepo()`. Furthermore, it implements direct raw HTTP `fetch()` requests against the GitHub GraphQL API.
- **Recommendation & Rationale:** Remove the script-specific implementation and utilize the ecosystem's centralized standards. It should leverage the core `config-resolver.js` to obtain tokens and repository context. It should instantiate the `ITicketingProvider` and utilize a `.graphql()` or equivalent abstraction if direct API querying is required for the experimental `sub_issues` fields. This maintains the consistency of API interactions and guarantees robust handling across tools.
- **Agent Prompt:**
  `Refactor delete-epic.js to remove the manual resolveToken() and resolveRepo() functions. Standardize it to use the core config-resolver and instantiate ITicketingProvider. Delegate GraphQL HTTP calls to a method provided by the provider interface rather than managing raw fetch requests within the script.`

### Registration Bloat in `mcp-orchestration.js`

- **Dimension:** KISS (Keep It Simple, Stupid)
- **Impact:** Medium
- **Current State:** The `registerSDKTools()` method inside the core MCP server comprises roughly 230 lines of sequential `registerTool` commands. Each tool declaration hard-codes JSON Schema properties and inline anonymous handlers within the master server file.
- **Recommendation & Rationale:** Abstract the tool registry logic. Each MCP tool should be defined independently (e.g., inside an array of tool modules in `lib/mcp/`) that exports its `name`, `description`, `schema`, and `handler`. The `mcp-orchestration.js` file should then iterate over these modular definitions to register them. This prevents the server entry point from accumulating massive cognitive load as the toolset expands.
- **Agent Prompt:**
  `Refactor mcp-orchestration.js to simplify registerSDKTools(). Move individual tool schemas and handler bindings out into a separated configurations file (e.g., lib/mcp/tool-registry.js), exposing them as an array of definitions. Update mcp-orchestration.js to iterate over this array and call registerTool dynamically, reducing the file's overall length and complexity.`

## Technical Debt Backlog

- **`.agents/scripts/epic-planner.js`**: Requires significant breakup to adhere to Single Responsibility Principle.
- **`.agents/scripts/delete-epic.js`**: Needs immediate modernization to hook into the `ITicketingProvider` and centralized config system.
- **`.agents/scripts/mcp-orchestration.js`**: The `registerSDKTools` phase needs modularization to support scalable Tool additions.
