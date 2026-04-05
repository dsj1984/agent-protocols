# Clean Code Audit Report

## Executive Summary

### Maintainability Index: Medium

The codebase demonstrates strong architectural fundamentals — a clear separation
of concerns via `lib/` modules, a unified config resolver with caching, and a
well-defined orchestration pipeline (`PlaybookOrchestrator`). However, the rapid
pace of iterative hardening (v3.x → v4.6.x in ~2 days) has introduced several
DRY violations, an SRP concern in the largest module (`generate-playbook.js`),
and a handful of silent-failure anti-patterns. The primary themes are:

1. **Duplicated Graph Logic**: The auto-serialization pipeline is implemented
   _twice_ — once in `generate-playbook.js` and once in
   `PlaybookOrchestrator.js`.
2. **Bookend Detection Sprawl**: The "is this a bookend task?" boolean check is
   copy-pasted across 7+ locations without a canonical helper.
3. **`loadValidModelNames` re-reads the config file** even though the config is
   already resolved and cached by `config-resolver.js`.
4. **`PROJECT_ROOT` resolution is inconsistent** across modules — some use
   `__dirname` relative paths, others use `process.cwd()`.

---

## Detailed Findings

### 1. Duplicated Auto-Serialization Pipeline

- **Dimension:** DRY (Don't Repeat Yourself)
- **Impact:** High
- **Current State:** The entire auto-serialization loop (scan task pairs for
  overlapping `focusAreas`, check reachability, inject dependency edges, rebuild
  graph, re-check for cycles) is implemented **twice**:
  - `generate-playbook.js` lines 537-589 (`generateFromManifest`)
  - `PlaybookOrchestrator.js` lines 132-189 (`build()`)

  The two implementations have **diverged**: the `PlaybookOrchestrator` version
  uses the optimized bulk-accumulate pattern with `pendingEdges` and `Set`-based
  intersection, while `generateFromManifest` still rebuilds the graph inside the
  inner loop (the O(N⁵) pattern that was supposedly fixed in v4.4.0).

- **Recommendation & Rationale:** Extract the auto-serialization logic into a
  dedicated `autoSerializeOverlaps(manifest, adjacency)` function in `Graph.js`
  (or a new `Serializer.js`). Both `generateFromManifest` and
  `PlaybookOrchestrator.build()` should call this single function. This
  eliminates the divergence risk and ensures the optimized algorithm is used
  everywhere.
- **Agent Prompt:**
  `Extract the auto-serialization logic (focusArea overlap detection, reachability check, pending edge accumulation, graph rebuild, cycle re-check) from PlaybookOrchestrator.js build() into a new exported function autoSerializeOverlaps(manifest, adjacency) in Graph.js. Update both generate-playbook.js generateFromManifest() and PlaybookOrchestrator.build() to delegate to this function. Ensure the optimized bulk-accumulate pattern (pendingEdges array) is the single canonical implementation. Add a test in generate-playbook.test.js to verify auto-serialization produces identical results through both entry points.`

---

### 2. Bookend Detection Repeated Inline

- **Dimension:** DRY | KISS
- **Impact:** Medium
- **Current State:** The boolean expression
  `task.isIntegration || task.isQA || task.isCodeReview || task.isRetro || task.isCloseSprint`
  appears **verbatim** in at least 7 locations across 4 files:
  - `generate-playbook.js` L290, L354
  - `PlaybookOrchestrator.js` L207
  - `Renderer.js` L154, L185, L218, L220
  - `ComplexityEstimator.js` L100-L105

  Any future addition of a new bookend type (e.g., `isReleaseCandidate`) would
  require updating every occurrence — a guaranteed source of regression bugs.

- **Recommendation & Rationale:** Create a `isBookendTask(task)` utility
  function in a shared location (e.g., `lib/task-utils.js` or `Graph.js`).
  Replace all inline boolean expressions with a single call. This also makes the
  definition self-documenting.
- **Agent Prompt:**
  `Create a new file .agents/scripts/lib/task-utils.js that exports a function isBookendTask(task) returning true if any of the bookend flags (isIntegration, isQA, isCodeReview, isRetro, isCloseSprint) are truthy. Replace all 7+ inline occurrences of the compound boolean expression in generate-playbook.js, PlaybookOrchestrator.js, Renderer.js, and ComplexityEstimator.js with calls to this utility. Add a unit test in tests/lib/ to verify the helper.`

---

### 3. `generateFromManifest` — God Function (SRP Violation)

- **Dimension:** SOLID Principles (SRP)
- **Impact:** Medium
- **Current State:** `generateFromManifest()` in `generate-playbook.js`
  (L478-L621, 143 lines) performs enrichment, complexity analysis, validation,
  graph construction, auto-serialization, layer assignment, session grouping,
  transitive reduction, chat dependency computation, bookend warnings, and
  rendering. This is identical to the pipeline that `PlaybookOrchestrator.run()`
  already handles via its phased methods (`validate`, `build`, `render`).

  `generateFromManifest` appears to be a legacy entry point that predates the
  `PlaybookOrchestrator` refactor. The `main()` function already uses
  `PlaybookOrchestrator.runFromFile()`, so `generateFromManifest` is only
  consumed by the test suite.

- **Recommendation & Rationale:** Migrate test consumers to use the
  `PlaybookOrchestrator` directly (instantiate with injected deps, call
  `run(manifest)`). Then deprecate `generateFromManifest` or reduce it to a thin
  wrapper around `buildOrchestrator().run()`. This eliminates the duplicated
  pipeline and ensures tests always exercise the production code path.
- **Agent Prompt:**
  `Refactor generateFromManifest() in generate-playbook.js to delegate entirely to PlaybookOrchestrator. Replace its body with: const orchestrator = buildOrchestrator(options); orchestrator.validate(manifest); const { chatSessions, chatDeps } = orchestrator.build(manifest); const markdown = orchestrator.render(manifest, chatSessions, chatDeps); return { markdown, chatSessions, chatDeps };. Update generate-playbook.test.js to verify the tests still pass through this delegation path. Confirm the auto-serialization divergence from Finding #1 is eliminated.`

---

### 4. `loadValidModelNames` Redundant File I/O

- **Dimension:** KISS | DRY
- **Impact:** Low
- **Current State:** `loadValidModelNames()` (L172-L195) reads and parses
  `.agentrc.json` from disk a **second time**, despite the fact that
  `resolveConfig()` already parsed and cached it at module initialization (L37).
  The function comments acknowledge this: _"We still need the top-level `models`
  key which is outside agentSettings, so we read the raw file"_.

  The real issue is that `resolveConfig()` only returns `agentSettings`, not the
  full config object. Rather than re-reading the file, the solution is to extend
  `resolveConfig()`.

- **Recommendation & Rationale:** Extend `resolveConfig()` to return a `raw`
  property (the full parsed config) alongside `settings`. Then
  `loadValidModelNames` can access `raw.models.categories` without any
  additional disk I/O.
- **Agent Prompt:**
  `Extend the resolveConfig() function in config-resolver.js to also return a 'raw' property containing the full parsed JSON object (not just agentSettings). Update the _cachedConfig object shape to { settings, raw, source }. Then refactor loadValidModelNames() in generate-playbook.js to use resolveConfig().raw.models.categories instead of re-reading .agentrc.json from disk. Remove the now-unnecessary fs.readFileSync call.`

---

### 5. Inconsistent `PROJECT_ROOT` Resolution

- **Dimension:** DRY | KISS
- **Impact:** Medium
- **Current State:** `PROJECT_ROOT` is computed independently in at least 6
  files using 3 different strategies:
  - `path.resolve(__dirname, '../..')` — `generate-playbook.js`,
    `sprint-integrate.js`, `update-task-state.js`, `harvest-golden-path.js`,
    `hydrate-cache.js`, `CacheManager.js`
  - `path.resolve(__dirname, '../../..')` — `config-resolver.js` (deeper nesting
    in `lib/`)
  - `process.cwd()` — `context-indexer.js`, `verify-prereqs.js`

  The `process.cwd()` variant is dangerous because it assumes the script is
  always invoked from the project root, which breaks if a developer runs it from
  a subdirectory or a CI environment uses a different working directory.

- **Recommendation & Rationale:** Centralize `PROJECT_ROOT` in
  `config-resolver.js` and export it. All scripts should import this single
  source of truth. The `context-indexer.js` and `verify-prereqs.js`
  `process.cwd()` references should be replaced.
- **Agent Prompt:**
  `Add an exported constant PROJECT_ROOT = path.resolve(__dirname, '../../..') to config-resolver.js. Import and use this constant in every script that currently computes its own PROJECT_ROOT or uses process.cwd() for root resolution: generate-playbook.js, sprint-integrate.js, update-task-state.js, harvest-golden-path.js, hydrate-cache.js, CacheManager.js, context-indexer.js, verify-prereqs.js, aggregate-telemetry.js. Remove all local PROJECT_ROOT declarations.`

---

### 6. Silent Error Swallowing in Config Resolver

- **Dimension:** Error Handling
- **Impact:** Medium
- **Current State:** `config-resolver.js` L47 has a bare `catch` block with only
  `console.warn` when `.agentrc.json` fails to parse. Similarly, `CacheManager`
  L47 silently returns `null` on cache parse failures with only a
  `console.warn`. `loadComplexityConfig()` (L374) uses a bare `catch` that
  silently swallows **all** errors, including permission errors or disk
  failures.

  These patterns mask configuration corruption, which can cause downstream
  scripts to silently use defaults instead of the user's intended settings — a
  very difficult failure mode to debug.

- **Recommendation & Rationale:** For `config-resolver.js`: Re-throw JSON parse
  errors (the config file exists but is corrupt — this is a fatal error, not a
  fallback scenario). Only fall through to defaults when the file does **not
  exist**. For `CacheManager`: Log the specific error message. For
  `loadComplexityConfig`: Catch only `ENOENT`-style errors, re-throw parse
  errors.
- **Agent Prompt:**
  `In config-resolver.js, refactor the catch block at L47 to distinguish between ENOENT (file not found → fall through to defaults) and JSON.parse errors (file exists but is corrupt → throw a fatal error via Logger.fatal). In CacheManager.js getCache(), log the actual error message alongside the filename in the console.warn. In ComplexityEstimator.js loadComplexityConfig(), change the bare catch to only suppress ENOENT errors and re-throw all others. Add a test in tests/lib/ that verifies a malformed .agentrc.json throws rather than silently falling back.`

---

### 7. `CacheManager` Lazy Singleton — Proxy Object Anti-Pattern

- **Dimension:** KISS | Testability
- **Impact:** Low
- **Current State:** `CacheManager.js` L79-80 exports a `instance` proxy object
  with hand-written method forwarders:

```js
export const instance = {
  get config() {
    return getInstance().config;
  },
  computeHash: (...a) => getInstance().computeHash(...a),
  getCache: (...a) => getInstance().getCache(...a),
  setCache: (...a) => getInstance().setCache(...a),
  hasMatch: (...a) => getInstance().hasMatch(...a),
};
```

This is fragile: adding a new method to `CacheManager` requires manually
updating the proxy. It also breaks `instanceof` checks and makes the type opaque
to IDE tooling.

- **Recommendation & Rationale:** Replace the hand-rolled proxy with a `Proxy`
  object that auto-forwards, or simply export `getInstance` as the default and
  let consumers call `getInstance()` directly. The latter is simpler and more
  idiomatic.
- **Agent Prompt:**
  `Replace the hand-rolled instance proxy object in CacheManager.js with a simple re-export: export { getInstance as instance }. Update all consumers (generate-playbook.js, hydrate-cache.js) to call instance() as a function: const cache = instance(); cache.hasMatch(...). This makes the lazy singleton idiomatic and self-maintaining.`

---

### 8. `verify-prereqs.js` — Mixed Line Endings and Stale `Logger.fatal` Flow

- **Dimension:** SOLID (SRP) | Error Handling
- **Impact:** Low
- **Current State:** The file has mixed `\r\n` and `\n` line endings (visible in
  the raw content). Additionally, `Logger.fatal()` calls `process.exit(1)`, but
  the calling code in `verify-prereqs.js` has unreachable empty statements after
  `Logger.fatal()` calls (L11, L22, L39, L141) — evidence of a previous
  `process.exit(1)` that was replaced with `Logger.fatal` without cleaning up
  the trailing code.

  The import statement on L4 also concatenates two imports on the same line
  without a newline: `import { resolveConfig } from ...` and
  `import { Logger } from ...`.

- **Recommendation & Rationale:** Run the formatter (`npm run format`) on the
  file to normalize line endings, then remove the dangling empty statements
  after `Logger.fatal()` calls. Fix the concatenated import statements.
- **Agent Prompt:**
  `Clean up verify-prereqs.js: 1) Separate the concatenated import statements on line 4 into distinct lines. 2) Remove all unreachable empty statements that follow Logger.fatal() calls (lines 11, 22, 39, 141). 3) Run npm run format to normalize line endings. Apply the same cleanup to update-task-state.js and hydrate-cache.js which exhibit the same dangling-statement pattern.`

---

### 9. `Renderer.js` — renderPlaybook Monolith (281 Lines)

- **Dimension:** SOLID (SRP) | Testability
- **Impact:** Medium
- **Current State:** `renderPlaybook()` (L80-280, ~200 lines of dense string
  concatenation) builds the entire markdown output as a single function. This
  function handles: header rendering, mermaid diagram embedding, task iteration,
  metadata rendering, branching instructions, execution protocol injection,
  close-out injection, complexity warnings, code-review manual fix blocks, and
  the fenced code block wrapper.

  This monolith is extremely difficult to unit-test in isolation. Any change to,
  say, the branching instructions requires reading through 200 lines of string
  concatenation to find the right location.

- **Recommendation & Rationale:** Decompose `renderPlaybook` into focused
  sub-functions: `renderHeader(manifest, options)`,
  `renderSessionBlock(session, ...)`, `renderTaskBlock(task, session, ...)`, and
  `renderAgentPrompt(task, session, ...)`. Each sub-function can be
  independently tested. The top-level `renderPlaybook` becomes a thin
  composition layer.
- **Agent Prompt:**
  `Decompose renderPlaybook() in Renderer.js into 4 focused sub-functions: renderHeader(manifest, options) for the playbook header + summary, renderMermaidSection(chatSessions, chatDeps) for the topology diagram, renderSessionHeader(session, chatDeps) for each chat session's header and prerequisite warning, and renderTaskBlock(task, session, taskIdToNumber, options) for the full task block including metadata, agent prompt, branching, and close-out. renderPlaybook should compose these. Export all sub-functions for independent unit testing. Add tests in tests/lib/renderer.test.js to verify each sub-function produces correct markdown fragments.`

---

### 10. `context-indexer.js` — Hardcoded Sprint Padding

- **Dimension:** DRY | KISS
- **Impact:** Low
- **Current State:** `aggregate-telemetry.js` L33 hardcodes
  `String(n).padStart(3, '0')` instead of reading `sprintNumberPadding` from the
  config. This diverges from the configurable padding used elsewhere. Similarly,
  `context-indexer.js` hardcodes paths like `process.cwd()` and `'temp'` instead
  of using the configurable `tempRoot` and `docsRoot` from `.agentrc.json`.

- **Recommendation & Rationale:** Both scripts should use `resolveConfig()` to
  read the padding and path settings, consistent with the rest of the pipeline.
- **Agent Prompt:**
  `Update aggregate-telemetry.js to import resolveConfig and use settings.sprintNumberPadding instead of the hardcoded 3 in getPaddedSprint(). Also use settings.sprintDocsRoot instead of hardcoding 'docs/sprints'. Update context-indexer.js to use resolveConfig() for tempRoot and docsRoot paths instead of hardcoded 'temp' and 'docs' strings.`

---

## Technical Debt Backlog

| Priority | File                                                            | Issue                                       |
| :------- | :-------------------------------------------------------------- | :------------------------------------------ |
| **P0**   | `generate-playbook.js` (L537-589)                               | Duplicated + diverged auto-serialization    |
| **P1**   | `generate-playbook.js` (L478-621)                               | `generateFromManifest` god function         |
| **P1**   | `Renderer.js` (L80-280)                                         | `renderPlaybook` 200-line monolith          |
| **P1**   | 7 files                                                         | Bookend detection boolean sprawl            |
| **P2**   | 6+ files                                                        | Inconsistent `PROJECT_ROOT` resolution      |
| **P2**   | `config-resolver.js` (L47)                                      | Silent config parse error swallowing        |
| **P2**   | `ComplexityEstimator.js` (L374)                                 | Bare `catch` in `loadComplexityConfig`      |
| **P3**   | `generate-playbook.js` (L172-195)                               | Redundant file I/O in `loadValidModelNames` |
| **P3**   | `CacheManager.js` (L79-80)                                      | Hand-rolled proxy anti-pattern              |
| **P3**   | `verify-prereqs.js`, `update-task-state.js`, `hydrate-cache.js` | Mixed line endings + dangling statements    |
| **P3**   | `aggregate-telemetry.js`, `context-indexer.js`                  | Hardcoded config values                     |
