# Architecture & Clean Code Review

## Executive Summary

The v5.0.0 Epic-Centric architecture introduces powerful new orchestration capabilities and successfully adheres to native dependencies (Node.js 20+). However, the read-only scan has revealed key areas of structural fragility related to cross-module coupling, unoptimized network patterns, and high cognitive load in utility processing. Specifically, the orchestration loop relies on synchronous shell spawning for internal module execution, and the roadmap generator suffers from an N+1 API fetching anti-pattern. Addressing these issues will massively improve maintainability, speed, and safety of the orchestrator.

## Triage Summary

### Quick Wins (Low Effort, High Impact)

- Extract heavy regex-based metadata parsing (`parseTaskMetadata`) out of the core `dispatcher.js` execution flow into a shared utility.
- Prevent LLM God-Object prompt bloating in `epic-planner.js` by capping or specifically targeting documentation file imports rather than scraping the entire directory recursively.

### Structural Changes (Medium/High Effort, Architectural Impact)

- Decouple `dispatcher.js` and `notify.js` by replacing synchronous shell sub-process spawning (`execSync`) with direct module imports.
- Resolve the N+1 API blocking mechanism in `generate-roadmap.js` by leveraging `Promise.all` for parallel ticket resolution.

## Detailed Findings

### Sub-Process Coupling for Internal Modules

- **Category:** Structural Change
- **Dimension:** Coupling & Cohesion / Over-Engineering
- **Current State:** In `dispatcher.js` (line 462), the script detects epic completion and triggers a webhook. To do this, it synchronously spawns a new Node instance: `execSync('node .agents/scripts/notify.js ...')`. However, `notify.js` natively exports an async `notify()` function. Spawning a new shell process creates unnecessary memory overhead, blocks the event loop synchronously, and ties the internal orchestration flow to specific filesystem paths.
- **Recommendation & Rationale:** Import `notify` from `./notify.js` at the top of the file and call it directly `await notify(...)`. This flattens the architecture, enforces standard module cohesion, and reduces execution time constraints.
- **Agent Prompt:**
  `Refactor dispatcher.js to remove the execSync call for notify.js. Instead, import { notify } from './notify.js' and call it asynchronously in detectEpicCompletion(). Do not change any external APIs or the payload sent to notify().`

### N+1 Sequential API Fetching

- **Category:** Structural Change
- **Dimension:** Cognitive Load & Nesting / Pre-mature Optimization
- **Current State:** In `generate-roadmap.js`, the code iterates over all `openEpics` using a `for...of` loop. Inside the loop, it `await`s the result of `provider.getTickets(epic.id)`. If there are 50 open epics, this forces the application to sequentially block and resolve 50 network calls back-to-back, drastically increasing execution time.
- **Recommendation & Rationale:** Since the `getTickets()` calls are entirely independent, they should be mapped to an array of Promises and executed concurrently using `Promise.all()`. This takes the operation from O(N) network latency to roughly O(1) batched latency.
- **Agent Prompt:**
  `Refactor the loop in generate-roadmap.js to resolve 'provider.getTickets' queries for 'openEpics' concurrently using Promise.all(), rather than awaiting each one sequentially in the for...of loop. Do not change the generated markdown structure or external APIs.`

### God-Object Markdown Prompt Injection

- **Category:** Quick Win
- **Dimension:** Cognitive Load & Nesting
- **Current State:** In `epic-planner.js` (lines 88-105), the script reads the `settings.docsRoot` setting, performs a recursive directory scan of all `.md` files, and blindly concatenates all text into `docsContext` before passing it to the Tech Spec LLM prompt. This causes extreme context window inflation and introduces noise by injecting irrelevant reference files (e.g., standard LICENSE or testing logs).
- **Recommendation & Rationale:** Rather than an unbounded recursive search, the system should allow developers to supply an array of specific reference documents in the configuration (`settings.docsContextFiles`), or cap the total byte size read to prevent accidental token budget overflow (which currently crashes the LLM).
- **Agent Prompt:**
  `Update epic-planner.js to restrict the docsContext reading by limiting the recursive scan to an explicit list of filenames defined by 'settings.docsContextFiles' if it exists, falling back to reading only top-level (non-recursive) .md files otherwise. Do not alter the overarching Tech Spec API logic.`

### Boilerplate Regex Parsing Inside Core Orchestration Flow

- **Category:** Quick Win
- **Dimension:** Dead Code & Redundancy
- **Current State:** In `dispatcher.js`, `parseTaskMetadata()` occupies ~40 lines of intricate Regex string parsing to extract parameters like persona, model, skills, and focus areas from Markdown bodies. This is heavy string manipulation sitting right in the middle of standard orchestration logic.
- **Recommendation & Rationale:** Extrapolate this utility into the newly created `lib/dependency-parser.js` alongside `parseBlockedBy()`, then import it. This enforces the Single Responsibility Principle and clears out noise from the dispatcher.
- **Agent Prompt:**
  `Move the parseTaskMetadata function out of dispatcher.js and into lib/dependency-parser.js. Export and import it back into dispatcher.js to use it for metadata extraction. Do not change the regex logic.`
