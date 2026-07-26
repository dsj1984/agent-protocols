# Archived design patterns — 2026-07

Retired sections relocated verbatim out of [`docs/patterns.md`](../patterns.md)
by Story #4786. Each documents a surface the repository no longer implements —
the in-process Epic runner, the Epic tier, the `mandrel` MCP server, and the
Epic retro path all went with the v2 Story collapse
([ADR 20260726-v2-story-collapse](../decisions.md)).

**Archived, not deleted.** The bodies below are word-for-word as they stood in
`docs/patterns.md` at `mandrel-v2.16.0`. The only edits are link re-rooting: two
relative links were re-pointed one level up (`../.agents/…` → `../../.agents/…`,
`data-dictionary.md` → `../data-dictionary.md`) so they still resolve from this
directory. No prose was rewritten, summarized, or reordered.

**Still-live guidance was lifted out before the move.** Every constraint in
these sections that still binds current code now lives in the
§ Standing gotchas section of [`docs/patterns.md`](../patterns.md). Read the
live doc for what applies; read this file for the record of what was decided
and why.

| Section | Retired because |
| --- | --- |
| OrchestrationContext Dependency Injection | `lib/orchestration/context.js` deleted with the in-process Epic-runner stratum (PR #3936). |
| Whole-epic progress reporting via `epic-run-progress` | The Epic tier and its progress-reporter were deleted in v2.0.0; no Epic-level rollup comment exists. The table below is a reproduction, not a live artefact. |
| MCP tool-argument schema enforcement | The `mandrel` MCP server was retired by ADR 20260424-702a; `post-structured-comment.js` and its siblings are the CLI successors. |
| Per-phase timer with `snapshot` / `restore` | `lib/util/phase-timer.js` survives but has no production importer, and **no producer writes the `phase-timings` structured comment** the section promises — the kind is registered in `ticketing/reads.js` and never emitted. |
| Compact-path short-circuit with escape hatch | `helpers/epic-retro.md` and `lib/orchestration/retro-heuristics.js` were deleted with the Epic retro path in v2. |

---

## Historical note: OrchestrationContext Dependency Injection (retired)

This document previously taught an `OrchestrationContext` /
`EpicRunnerContext` / `PlanRunnerContext` typed-ctx DI pattern backed by
`lib/orchestration/context.js`. That substrate was deleted with the
in-process epic-runner stratum (PR #3936; the host-LLM-drives-CLIs model
superseded it), and no live module demonstrates the pattern. Do **not**
re-introduce a shared ctx object for new orchestration code — the
surviving style is **explicit named arguments**: each module declares
the collaborators it needs (`provider`, `logger`, `config`, …) as plain
destructured parameters, and tests pass stubs directly. See
[`rules/git-conventions.md` § Contract Cutovers](../../.agents/rules/git-conventions.md)
for why the old stratum was removed wholesale rather than shimmed.

---

## Whole-epic progress reporting via `epic-run-progress` (historical)

> **Historical.** The progress-reporter module and its caller were
> deleted with the Epic tier in v2.0.0 — there is no Epic-level rollup
> comment any more (see the matching historical note in
> [`docs/data-dictionary.md`](../data-dictionary.md)). The *pattern* —
> one idempotent, marker-keyed rollup covering every unit of work, not
> just the active ones — remains the reference shape for any future
> multi-Story progress surface.

The progress-reporter module
(`lib/orchestration/epic-runner/progress-reporter/composition.js`,
`upsertEpicRunProgress`) rendered the `epic-run-progress` snapshot
covering every story in the Epic — queued, in-flight, done, blocked —
so operators saw the full Epic at a glance.

`upsertEpicRunProgress` was called by `/deliver`'s per-Story status
recorder (`epic-execute-record-wave.js`) after each recorder beat.
Story #4155 (Epic #4151) cut the runtime over from the wave-batch
scheduler to the continuous ready-set core, so the rollup was a **flat
per-Story table** keyed by the checkpoint's `stories` status map — there
was no `Wave` column and no `waves[]` grouping:

```text
### 📊 Epic Progress — 5/6 stories done
| ID | State | Title |
|---|---|---|
| #419 | ✅ done | Spawner hardening suite |
| #420 | ✅ done | Post-wave commit assertion |
| #421 | ✅ done | story-close --resume / --restart |
| #422 | ✅ done | Biome format gate + tagging sanity check |
| #423 | ✅ done | error-journal parse-fix, validator wiring |
| #424 | 🔧 in-flight | ProgressReporter detectors + CI Node matrix |
```

There was no separate per-Story structured comment — `epic-run-progress`
was the single operator-facing summary, and the upsert was idempotent by
marker (see the structured-comment pattern above).

**Why it mattered (and still generalises):** a progress signal is what
operators read while a delivery loop runs. A snapshot that only shows
the active stories hides "is the run 20% done or 80% done?" — exactly
the question the operator is trying to answer when checking in. A flat
all-rows table collapses that question into a single glance; row-level
columns should be added only when every row benefits, with once-per-
snapshot detectors relegated to a `Notable` section under the table.

---

## MCP tool-argument schema enforcement

### Problem

Declaring an `inputSchema` per tool in the MCP registry does not enforce
it — the server had been validating the JSON-RPC envelope with AJV but
not the `tools/call` arguments themselves. A malformed payload (negative
`epicId`, string where a number was expected) reached the handler
unchecked and surfaced as a GraphQL 422 or a `Cannot read properties of
undefined` downstream, disguising a caller bug as a backend error.

### Solution

Compile each tool's `inputSchema` with AJV at registration time, then
validate `params.arguments` before invoking the handler. On failure,
respond with JSON-RPC `-32602 Invalid params` including the AJV error path
and a human-readable reason — the caller sees exactly which field failed,
at the protocol boundary.

### Consequences

- Tool schemas are no longer documentation-only; the registry is the
  enforced contract.
- Caller errors surface as protocol-level `-32602` with a precise path,
  not as opaque downstream exceptions.
- Tightened schemas catch subtle drifts (e.g. a `type::*` enum missing on
  one tool but present on its siblings) at the boundary.

---

## Per-phase timer with `snapshot` / `restore`

### Problem

Framework overhead was not directly observable. A slow Story could be
slow because `.agents/` copy was slow, or because `npm ci` was slow,
or because lint was slow — the runner's log said only "Story took 12
minutes." Consumer projects blaming framework overhead had no way to
prove it; framework maintainers had no way to refute it.

### Solution

`lib/util/phase-timer.js` + `phase-timer-state.js`. The timer records
`{ phase, elapsedMs }` spans and exposes `snapshot` / `restore` so
state survives the `story-init` → sub-agent →
`story-close` boundary (where three separate phases handle
one Story). Per-phase lines are emitted during the lifecycle; on
close, a `phase-timings` structured comment is posted to the Story
ticket. Story #4545 deleted the aggregator that rolled those timings into
a median / p95 report; the per-Story comment is what remains.

### Consequences

- The phase-timings comment is a machine-readable artefact — consumer
  dashboards don't have to grep logs.
- Framework vs. consumer overhead is now attributable in a single
  report: `.agents/` copy, worktree create, bootstrap are framework;
  install, lint, test, implement are consumer.
- Future perf work starts with measurement. The next regression is
  caught by the p95 column drifting, not by a user filing an issue.

---

## Compact-path short-circuit with escape hatch (historical)

### Context

`helpers/epic-retro.md` historically walked through six sections
regardless of sprint shape. On clean-manifest Epics (zero friction,
zero parked, zero recuts, zero hotfixes, zero HITL) four of those
sections degenerated to "nothing notable" boilerplate.

### Solution (pre-v2)

A cheap predicate decided the branch up-front; the verbose path stayed
one flag away.

1. **Pure-function predicate.** `isCleanManifest({ friction, parked,
   recuts, hotfixes, hitl })` returned `true` iff every signal was zero.
   Lived in `lib/orchestration/retro-heuristics.js` (deleted in v2 with
   the Epic retro path).
2. **Preserved downstream contract.** The compact body was still a
   `type: 'retro'` comment ending with `<!-- retro-complete: <ISO> -->`.
3. **Operator override.** `--full-retro` forced the six-section body.

### When this pattern still applies

The *pattern* (predicate + shorter body + escape hatch) generalises to
any stage whose body is mechanically populated from usually-zero
signals. The Epic-retro *instance* of the pattern is gone in v2.

Use only when (a) the short path genuinely produces less work, not
less signal, and (b) the short path is the common case. If "clean" is
the outlier, skip — the short path becomes the one you forget to
update.
