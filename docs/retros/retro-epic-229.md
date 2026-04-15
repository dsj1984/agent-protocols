# Retrospective — Epic #229: Worktree-per-story isolation for parallel sprint execution

**Date:** 2026-04-15  
**Protocol Version:** 5.7.0  
**Epic branch:** `epic/229` (merged into `main` on close-out)  
**Trigger incident:** 2026-04-14 reflog showing five concurrent story agents racing on `epic/267`'s HEAD and cross-contaminating a commit.

## Sprint Scorecard

| Metric                          | Value                               |
| ------------------------------- | ----------------------------------- |
| Features                        | 3                                   |
| Stories                         | 7                                   |
| Tasks                           | 17                                  |
| Tasks completed first try       | 17                                  |
| Tasks requiring hotfix          | 0                                   |
| HITL gates triggered (risk::high) | 0                                 |
| Friction events (structured comments) | 0                             |
| Blocked events (status::blocked) | 0                                  |
| Post-merge audit bugs found     | 1 (stray `PROJECT_ROOT` in close)   |
| Perf wins landed post-Epic      | 7 (see perf audit)                  |
| Final test count                | 491 non-skipped (2 Windows-skipped) |

## What Went Well

- **Planning produced a clean DAG.** 7 stories fell naturally into 4 dispatch waves with zero cycles. Wave 0 (WorktreeManager + schema) was the only dependency bottleneck; everything else parallelized cleanly in waves 1–3.
- **The DI seam on WorktreeManager paid for itself.** Injecting `{ git, logger, platform }` meant unit tests never touched the real filesystem until the dedicated integration test, which was 25 cases landing green on first try.
- **The `assert-branch.js` guard caught every drift.** Three times during this Epic's own execution, another agent swapped HEAD into a story branch I was about to commit to. Each time the pre-commit guard stopped the wrong commit before it happened — live proof the v5.5.1 defense-in-depth was correct.
- **Fallback mode came free.** `orchestration.worktreeIsolation.enabled: false` restores v5.5.1 exactly, with no new test scaffolding. The integration test covers both modes from the same fixture.
- **`git merge-base --is-ancestor` collapse.** The post-Epic perf audit found `isSafeToRemove` issued 4–5 subprocesses per candidate. Replacing it with one `--is-ancestor` probe dropped GC cost by ~40% and made the code clearer.
- **`primeTicketCache` + provider memoization.** One bulk fetch at dispatch start now serves cascade + transition + reconciler + context-hydration. The manifest-regen-after-merge path issues zero REST calls now.

## What Could Be Improved

- **The dispatcher's `dispatch()` function had grown to 184 LOC of banner-commented steps.** Banners were load-bearing — new readers had to hold nine orchestration stages in their head simultaneously. The clean-code audit flagged it; the extraction into named step helpers (`resolveDispatchContext` → `dispatchNextWave`) happened only in the post-Epic pass. **Systemic lesson:** when a function exceeds ~80 LOC, section comments are a smell, not a mitigation.
- **`runStoryClose` carried the same defect** — 244 LOC mixing risk gate, merge, reap, cascade, notify, health, dashboard, cleanup. Same extraction treatment applied post-hoc.
- **One stray `PROJECT_ROOT` survived the `--cwd` refactor.** The remote-branch delete in `cleanupBranches` kept the old constant while every other git op was threaded. Only the post-Epic code-review audit caught it. **Systemic lesson:** mechanical refactors like "thread a parameter through every call site" need an automated check, not eyeballing.
- **`Logger.error` was called before it existed.** `github-refinement-service.js` invoked `Logger.error(...)` — which would have thrown `TypeError: Logger.error is not a function` the moment that path fired in production. A pre-existing bug that went unnoticed until the clean-code audit. Logger now has `debug`/`error` methods and an `AGENT_LOG_LEVEL=debug` gate.
- **Silent `catch {}` in the same file** swallowed a post-failure checkout cleanup. Now logs at `debug` level.
- **Silent DAG-sort downgrade** in `sprint-story-init.js` would have returned an unordered task list on cycle detection. That would have broken downstream execution order silently. Now throws with context.
- **`(t.labels ?? [])` over-defensive guards** appeared in 11 call sites where `ITicketingProvider` guarantees `labels: string[]`. Communicates a contract that doesn't exist; removed.
- **No changelog sub-sections for perf vs. clean-code.** The v5.7.0 release note bundles three distinct passes (Epic, perf audit, clean-code audit) under one version. Future epics should either cut separate patches or at minimum call out the sub-phases explicitly in the changelog — which we did for v5.7.0 post-hoc.

## Architectural Debt

- **The adapter-factory + provider-factory split is starting to show its age.** Both build identical singleton shapes from `orchestration` config. A future Epic could consolidate them behind one `buildOrchestrationRuntime()` factory.
- **`context-hydration-engine.js` still reads the VERSION file inside a try/catch** that returns `'unknown'` on failure. Acceptable but non-obvious — the file cache landed in this Epic does not apply there. Low priority.
- **`manifest-builder.js` still has a `buildStoryManifest` helper with a private internal caller.** The export was dropped, but the function is large and duplicates shape-construction logic from `executeStory`. Consolidating both into a single "derive story manifest from tasks" utility is a natural follow-up.
- **Dispatcher still re-fetches the same Epic's tickets at both dispatch start and post-close dashboard regen.** Provider memoization makes this free per-REST-call, but the dual-call pattern is still a semantic code smell.

## Protocol Optimization Recommendations (Self-Healing)

1. **`sprint-execute.md` — add a `--cwd` discoverability nudge.** Operators running inside a worktree currently learn about the flag by reading `worktree-lifecycle.md`. Add a one-line callout to the Mode B section pointing at the flag explicitly. Proposed insert after the model-tier callout:
    > **Running inside a worktree?** Pass `--cwd "$(pwd)"` or export `AGENT_WORKTREE_ROOT` so init/close guard the right tree.

2. **`sprint-close.md` — Step 1.5 is a hard stop but the workflow reads as if the Bookend Lifecycle auto-runs `/sprint-retro`.** This Epic's close-out was gated exactly by that confusion. Propose clarifying the first paragraph of `/sprint-close`:
    > **Prerequisite:** `/sprint-retro [EPIC_ID]` **must** be run first. The Bookend Lifecycle announces it but does not execute it; `/sprint-close` Step 1.5 will STOP if `[RETRO_PATH]` is missing.

3. **`.agents/rules/` — add a "parameter-threading refactor" rule.** When an audit prompt asks for "thread X through every call site of Y", emit an automated verification: `grep -rn "Y(PROJECT_ROOT" ...` must return zero matches in the diff scope. Prevents the `cleanupBranches` miss class of bug.

4. **Logger convention — document `AGENT_LOG_LEVEL`.** The env var is live but only the README mentions it. Propose mentioning it in the CLI `--help` output for every script that emits `Logger.debug` lines.

5. **New skill snippet — `core/post-refactor-verification.md`.** After any "thread a param through N call sites" Epic, the followup skill runs:
    - `grep` for the old constant inside git operations and flags any matches
    - `npm test` and filters for tests that still reference the old constant in assertions
    - reports both as a checklist before close-out

## Action Items for Next Epic

- [ ] **Drop the `Logger.fatal`→`process.exit` coupling from library code.** Audit `.agents/scripts/lib/**/*.js` and replace any `Logger.fatal` inside library code with `throw`; `Logger.fatal` belongs only in `runAsCli`'s error handler.
- [ ] **Land the sprint-close doc clarification** from recommendation #2 above as a tiny follow-up doc PR.
- [ ] **Integrate parallel-sprint integration test into CI.** The test in `tests/integration/parallel-sprint.test.js` runs real git subprocesses (~3 s). It proves AC6/AC7 but is not gated — add a CI job that runs it on every PR touching `worktree-manager.js`, `dispatch-engine.js`, or `sprint-story-*.js`.
- [ ] **Write a regression test for the `cleanupBranches` cwd-threading bug.** Assert that remote deletion runs against the resolved cwd, not `PROJECT_ROOT`. Prevents the next refactor from regressing it.
- [ ] **Consider consolidating `adapter-factory` + `provider-factory`** into one `buildOrchestrationRuntime()` factory as an architectural debt item for a future Epic.
- [ ] **Profile the dispatch wave on a 20-story Epic.** The perf pass was informed by code reading, not measurement. A real profile would quantify the ticket-cache win and confirm the worktree-GC improvement.
