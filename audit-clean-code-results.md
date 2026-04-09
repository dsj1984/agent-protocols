# Clean Code Audit Report

## Executive Summary

The orchestration SDK and workflow scripts demonstrate a Medium-to-Low maintainability index due to rapid iteration and architectural shifts. While the system operates deterministically, several primary scripts suffer from high cyclomatic complexity, component bloat, and violations of SOLID principles. Core orchestration files handle multiple disparate responsibilities procedurally instead of delegating to domain-specific services or abstractions. Technical debt is concentrated in the top-level CLI scripts and the main MCP integration layer.

## Detailed Findings

### [Monolithic Procedures in Sprint Scripts]

- **Dimension:** SOLID Principles (Single Responsibility) & KISS
- **Impact:** High
- **Current State:** Scripts like `.agents/scripts/sprint-story-init.js` and `.agents/scripts/sprint-story-close.js` consist of completely procedural logic housed within massive `main()` functions (~300+ lines). For example, `sprint-story-close.js` parses arguments, resolves Epic/Story IDs from tickets, manually forks `gitSpawn` for PRs and merges, cleans up branches, iterates over ticket transitions, and triggers secondary scripts using `execFileSync` all in sequence.
- **Recommendation & Rationale:** Refactor these massive entry points by breaking the sequence down into granular, exported lifecycle/orchestrator functions (e.g. `checkPreconditions`, `performMerge`, `cleanupBranches`, `transitionTickets`). By relying entirely on smaller testable modules, error handling becomes cleaner, and unit testing is possible without spawning child processes or relying on deep API mock chains.
- **Agent Prompt:**
  `Please refactor .agents/scripts/sprint-story-close.js. Break down the giant main() function into isolated module-level helper functions for Git operations, ticket state transitions, and downstream script spawning. Ensure main() acts purely as a high-level orchestrator that passes state between these helpers.`

### [Hardcoded Manifest Persistence in MCP Server]

- **Dimension:** SOLID Principles, DRY, and KISS
- **Impact:** High
- **Current State:** `.agents/scripts/mcp-orchestration.js` (lines 209-254) contains ~45 lines of inline, procedural logic specifically hardcoded to `dispatch_wave` that dynamically imports `fs`, `path`, and manifest renderers to write outputs to a `temp/` folder. This breaches the abstraction of the MCP protocol handler, binding presentation-layer logic deeply inside the server's message dispatch.
- **Recommendation & Rationale:** Extract this persistence logic entirely out of `mcp-orchestration.js`. The `handleRequest` logic shouldn't know what `dispatch_wave` is or how to physically write its result. Instead, this should occur within the `dispatch_wave` tool handler itself, or via a new presentation service (e.g. `saveManifestFiles`). This separation of concerns preserves the cleanliness of the MCP dispatcher.
- **Agent Prompt:**
  `Extract the 'PERSISTENCE SYNC' logic found inside mcp-orchestration.js (inside 'handleRequest' for tools/call dispatch_wave) into a separate utility function inside lib/presentation/manifest-renderer.js (or a new file). Refactor mcp-orchestration.js to delegate to this utility or handle persistence inside the 'dispatch_wave' tool implementation directly.`

### [Brittle Subprocess Execution for Telemetry]

- **Dimension:** KISS & Reliability
- **Impact:** Medium
- **Current State:** Both `sprint-story-init.js` and `sprint-story-close.js` make raw Node `execFileSync` calls to `health-monitor.js` and `dispatcher.js` to refresh downstream artifacts. This results in heavy subprocess overhead, duplicated stream management (`stdio: 'inherit'`), and hidden side effects when processes fail non-fatally.
- **Recommendation & Rationale:** Because both the host script and the child scripts share the same Node execution context and internal SDKs, these side-effects should exist as exported functions. Replace `execFileSync('node', ['dispatcher.js', ...])` with modular calls like `await generateAndSaveManifest(epicId)`. This eliminates process creation latency and unifies error handling.
- **Agent Prompt:**
  `Refactor the external script executions (health-monitor.js and dispatcher.js) in sprint-story-close.js. Replace the standard execFileSync calls with programmatic imports of the core logic from those modules. Update those scripts to export their main logic as reusable asynchronous functions.`

### [Inconsistent Argument Parsing and Error Raising]

- **Dimension:** DRY
- **Impact:** Low
- **Current State:** There is scattered, re-implemented argument validation logic across the repository. Each script re-instantiates `parseArgs`, manually converts strings to `parseInt`, checks `Number.isNaN`, provides its own inline fatal strings, and sometimes logs via `Logger.fatal()` or `console.error()` accompanied by `process.exit(1)`.
- **Recommendation & Rationale:** Create a standardized CLI options parser or decorator in `lib/` to handle common parameters like `--epic`, `--story`, `--dry-run`, ensuring validation guarantees are uniform and preventing typos in usage strings.
- **Agent Prompt:**
  `Create a standard CLI argument resolution utility in lib/ that unifies parsing of --epic, --story, and --dry-run flags. Implement this unified parser across sprint-story-init.js and sprint-story-close.js.`

## Technical Debt Backlog

- `.agents/scripts/mcp-orchestration.js`: Needs strict boundary lines drawn between standard MCP boilerplate (versioning/transports) and project-specific rendering/presentation fallbacks.
- `.agents/scripts/sprint-story-init.js`: Rework massive procedural script into step-based adapter pattern.
- `.agents/scripts/sprint-story-close.js`: Refactor monolithic implementation steps into distinct domain operations (Git, Ticketing, Telemetry).
- Subprocess dependencies: Eliminate shell-outs to other node scripts (`health-monitor`, `dispatcher`) by utilizing them programmatically via imports.
