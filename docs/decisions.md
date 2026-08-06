# Architecture Decision Records (ADR)

## How to read this log

**ADRs are superseded in place, never archived or deleted.** An entry whose
decided surface no longer exists keeps its number and its date, and gains a
`Superseded by <ref>` or `Reverted (<date>)` status plus a one-line outcome; its
body is collapsed and the full original text stays recoverable at the release
tag named in the entry. Only the accreted history of *living* docs is relocated
under `docs/archive/` — see the Pruning & Archiving section of
[`documentation-and-adrs`](../.agents/skills/core/documentation-and-adrs/reference.md).

Every entry that is still **Accepted** carries a `**Surface:**` line naming the
one primary path the decision governs. What that line is machine-checked for is
**existence only** — `tests/docs/decisions-and-archive-contract.test.js` runs
`existsSync` on the path, nothing more. It catches the loud failure (an ADR
still Accepted after its file was deleted) and cannot catch the quiet one: a
decision whose mechanism was dismantled while the named file lived on, or whose
Surface names a file too broad to witness anything. Treat a passing Surface as
necessary, never sufficient. Entries known to be in that state carry an
explicit `**Materially dead:**` line — grep for it.

**Identifiers are unique and stable.** An entry is cited by its `<date>-<ticket>`
identifier, and the same contract test rejects a collision. Story #4786 resolved
seven: the freshness-gate entry moved from `20260507-1114a` to `-1114b`, and the
six date-only `ADR-20260421` / `ADR-20260422` entries gained their Epic suffix
(`-321a/b`, `-380a/b`, `-413a/b`). Renumber, never reuse.

Backticked paths **inside an entry's body are not maintained**. An ADR records
what was true when it was written, so roughly 60% of them point at files later
renamed or removed — that is the record working as intended, not rot. Trust the
`**Surface:**` line and the status; treat body paths as historical citations.

Four load-bearing entries are cited by most of the others:
[`20260726-v2-story-collapse`](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
(the current ticket and delivery model),
[`20260512-coupling-stance`](#adr-20260512-coupling-stance-two-surface-coupling-stance)
(Claude Code-first, runtime-pluggable),
[`20260512-loop-adoption`](#adr-20260512-loop-adoption-adopt-built-in-loop-no-homegrown-surface-to-reconcile)
(no homegrown loop runner), and
[`20260624-loop-units-division-of-labor`](#adr-20260624-loop-units-division-of-labor-mandrel-owns-content--oracle--contract-the-host-owns-cadence--iteration)
(mandrel owns content, the host owns cadence). The absolute quality floors and
the floor-vs-ratchet policy are tooling commitments rather than ADRs and live in
[`quality-gates.md`](../.agents/docs/quality-gates.md).

## Index

<!-- ADR-INDEX:START -->

**In force (35).** Each governs the surface named beside it.

| Decision | Governs | Surface |
| --- | --- | --- |
| [`20260802-4938-schema-compilers`](#adr-20260802-4938-schema-compilers-a-schema-is-compiled-by-code-or-declares-in-file-why-not) | A schema is compiled by code, or declares in-file why not | `.agents/scripts/check-schema-references.js` |
| [`20260726-v2-story-collapse`](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine) | Story-only ticket model; one /plan, one /deliver, one engine | `.agents/workflows/deliver.md` |
| [`20260624-loop-units-division-of-labor`](#adr-20260624-loop-units-division-of-labor-mandrel-owns-content--oracle--contract-the-host-owns-cadence--iteration) | mandrel owns content + oracle + contract; the host owns cadence +… | `.agents/scripts/sync-claude-commands.js` |
| [`20260610-lifecycle-bus-retained`](#adr-20260610-lifecycle-bus-retained-keep-the-lifecycle-bus-collapse-by-deletion-is-already-done) | Keep the lifecycle bus; collapse-by-deletion is already done | `.agents/scripts/lib/orchestration/lifecycle/bus.js` |
| [`20260610-planning-determinism-dispositions`](#adr-20260610-planning-determinism-dispositions-per-layer-dispositions-for-the-deterministic-planning-proxies) | Per-layer dispositions for the deterministic planning proxies | `.agents/scripts/lib/orchestration/ticket-validator.js` |
| [`Overturn`](#overturn-drain-pending-cleanup-demoted-to-a-helper) | `drain-pending-cleanup` demoted to a helper | `.agents/scripts/drain-pending-cleanup.js` |
| [`20260604-flat-command-projection-revert`](#adr-20260604-flat-command-projection-revert-revert-the-plugin-cutover--project-workflows-as-flat-name-commands) | Revert the plugin cutover — project workflows as flat `/<name>` c… | `.agents/scripts/sync-claude-commands.js` |
| [`20260519-adapter-layer-removed`](#adr-20260519-adapter-layer-removed-delete-the-iexecutionadapter-abstraction) | Delete the `IExecutionAdapter` abstraction | `.agents/scripts/providers/github.js` |
| [`20260514-drop-churn-idle`](#adr-20260514-drop-churn-idle-drop-churn--idle-from-active-perf-signal-taxonomy) | Drop `churn` + `idle` from active perf-signal taxonomy | `.agents/schemas/agentrc.schema.json` |
| [`20260512-coupling-stance`](#adr-20260512-coupling-stance-two-surface-coupling-stance) | Two-surface coupling stance | `.agents/scripts/providers/github.js` |
| [`20260507-1072a`](#adr-20260507-1072a-bounded-fanout-tightened-module-boundaries-dead-module-sweep) | Bounded fanout, tightened module boundaries, dead-module sweep | `.agents/scripts/lib/branch-name-guard.js` |
| [`20260507-1030a`](#adr-20260507-1030a-performance-signal-telemetry--events-local-summaries-on-tickets) | Performance-signal telemetry — events local, summaries on tickets | `.agents/scripts/diagnose-friction.js` |
| [`20260505-990a`](#adr-20260505-990a-audit-remediation--agents-framework-hardening--concept-removal) | Audit remediation — `.agents` framework hardening + concept removal | `.agents/schemas/audit-rules.json` |
| [`20260426-829a`](#adr-20260426-829a-strip-then-analyze-for-typescript-scoring-keep-typhonjs-escomplex) | Strip-then-analyze for TypeScript scoring; keep typhonjs-escomplex | `.agents/scripts/lib/transpile.js` |
| [`20260425-773a`](#adr-20260425-773a-crap-gate-becomes-hard-enforcing) | CRAP gate becomes hard-enforcing | `baselines/crap.json` |
| [`20260425-773b`](#adr-20260425-773b-decompose-two-further-large-modules-behind-byte-identical-facades) | Decompose two further large modules behind byte-identical facades | `.agents/scripts/lib/worktree/lifecycle-manager.js` |
| [`20260425-730a`](#adr-20260425-730a-consolidate-agentsettings-into-a-grouped-schema-validated-contract) | Consolidate `agentSettings` into a grouped, schema-validated cont… | `.agents/scripts/lib/config-settings-schema.js` |
| [`20260424-702a`](#adr-20260424-702a-retire-mandrel-mcp) | Retire mandrel MCP | `.agents/scripts/post-structured-comment.js` |
| [`20260424-668a`](#adr-20260424-668a-resolve-worktreeisolationenabled-from-environment-not-config) | Resolve `worktreeIsolation.enabled` from environment, not config | `.agents/scripts/lib/config/runtime.js` |
| [`004`](#adr-004-gherkin-standards-as-sole-ssot-for-bdd-tags--forbidden-patterns) | Gherkin Standards as Sole SSOT for BDD Tags & Forbidden Patterns | `.agents/rules/gherkin-standards.md` |
| [`ADR: Decompose oversized orchestration modules via facade pattern`](#adr-decompose-oversized-orchestration-modules-via-facade-pattern) | Decompose oversized orchestration modules via facade pattern | `.agents/scripts/lib/worktree-manager.js` |
| [`20260421-321b`](#adr-20260421-321b-retire-riskhigh-runtime-gating) | Retire `risk::high` runtime gating | `.agents/instructions.md` |
| [`20260422-380a`](#adr-20260422-380a-two-stage-windows-worktree-reap-fsrm-retry--deferred-sweep) | Two-stage Windows worktree reap (fs.rm retry + deferred sweep) | `.agents/scripts/lib/worktree/lifecycle-manager.js` |
| [`20260422-441a`](#adr-20260422-441a-force-reap-worktrees-whose-story-branch-is-already-merged) | Force-reap worktrees whose Story branch is already merged | `.agents/scripts/boot-sweep.js` |
| [`20260423-511b`](#adr-20260423-511b-transitionticketstatefromstate-lookup-keeps-its-swallow-now-with-a-debug-log) | `transitionTicketState.fromState` lookup keeps its swallow, now w… | `.agents/scripts/providers/github/tickets.js` |
| [`20260424-596a`](#adr-20260424-596a-crap-as-a-sibling-gate-not-a-replacement-for-mi) | CRAP as a sibling gate, not a replacement for MI | `baselines/maintainability.json` |
| [`20260424-596c`](#adr-20260424-596c-kernel-version-stamp-on-the-crap-baseline) | Kernel-version stamp on the CRAP baseline | `baselines/crap.json` |
| [`20260424-638a`](#adr-20260424-638a-story-566-reap-recovery-is-a-self-inflicted-dirty-tree-bug) | `story-566` reap recovery is a self-inflicted dirty-tree bug | `.agents/scripts/lib/worktree/bootstrapper.js` |
| [`20260426-817a`](#adr-20260426-817a-validation-evidence-is-keyed-by-commit-sha-not-by-build-id) | Validation evidence is keyed by commit SHA, not by build ID | `.agents/scripts/evidence-gate.js` |
| [`20260426-817c`](#adr-20260426-817c-soft-failing-gates-surface-degraded-state-explicitly-not-silently) | Soft-failing gates surface degraded state explicitly, not silently | `.agents/scripts/lib/degraded-mode.js` |
| [`20260426-817d`](#adr-20260426-817d-cli-entrypoints-carry-nodecoverage-ignore-file-their-main-is-exercised-via-integration-tests-not-unit-line-coverage) | CLI entrypoints carry `node:coverage ignore file`; their `main()`… | `.agents/scripts/notify.js` |
| [`20260502-960a`](#adr-20260502-960a-production-code-is-not-shaped-by-test-internals--tests-import-helpers-directly-with-an-explicit-ctx-bag) | Production code is not shaped by test internals — tests import he… | `.agents/scripts/lib/worktree/bootstrapper.js` |
| [`20260507-1114b`](#adr-20260507-1114b-freshness-gate-on-decompose--fail-fast-on-stale-path-references) | Freshness gate on decompose — fail fast on stale path references | `.agents/scripts/lib/orchestration/ticket-validator.js` |
| [`20260512-loop-adoption`](#adr-20260512-loop-adoption-adopt-built-in-loop-no-homegrown-surface-to-reconcile) | Adopt built-in `/loop`; no homegrown surface to reconcile | `.agents/scripts/lib/util/poll-loop.js` |
| [`20260513-command-naming-discipline`](#adr-20260513-command-naming-discipline-domain-vocabulary-command-names-single-mandrel-prefixed-discoverability-entry) | Domain-vocabulary command names; single Mandrel-prefixed discover… | `.agents/scripts/sync-claude-commands.js` |

**Closed (21).** Body collapsed to a one-line outcome; full text
at the release tag named in the entry.

| Decision | Recorded | Status |
| --- | --- | --- |
| [`20260611-two-tier-hierarchy`](#adr-20260611-two-tier-hierarchy-remove-the-feature-tier-epic--story-superseded) | Remove the Feature tier (Epic → Story) (superseded) | Superseded |
| [`20260603-plugin-namespace-cutover`](#adr-20260603-plugin-namespace-cutover-project-workflows-as-a-claude-code-plugin-mandrelname-superseded) | Project workflows as a Claude Code plugin (`/mandrel:<name>`) (su… | Superseded |
| [`20260527-three-tier-hierarchy`](#adr-20260527-three-tier-hierarchy-collapse-the-task-level-epic--feature--story-superseded) | Collapse the Task level (Epic → Feature → Story) (superseded) | Superseded |
| [`20260512-destructive-replan-retired`](#adr-20260512-destructive-replan-retired-epic-1182--retire-delete-epicjs-re-plan--edit-spec--reconcile-superseded) | Epic #1182 — retire `delete-epic.js`; re-plan = edit-spec + recon… | Superseded |
| [`20260510-sdl-collapse`](#adr-20260510-sdl-collapse-5400--collapse-to-epic-plan--epic-deliver-fold-retro-into-deliver-tail-superseded) | 5.40.0 — collapse to `/epic-plan` + `/epic-deliver`, fold retro i… | Superseded |
| [`20260508-flatten`](#adr-20260508-flatten-retire-wave-execute-epic-execute-owns-the-wave-loop-directly-superseded) | Retire `/wave-execute`; `/epic-execute` owns the wave loop direct… | Superseded |
| [`20260507-1114a`](#adr-20260507-1114a-wave-runner-is-a-custom-sub-agent-type-not-general-purpose-superseded) | Wave-runner is a custom sub-agent type, not `general-purpose` (su… | Superseded |
| [`20260501-900a`](#adr-20260501-900a-epic-centric-workflow-rework--four-skill-split-single-session-fan-out-retire-github-triggers-superseded) | Epic-centric workflow rework — four-skill split, single-session f… | Superseded |
| [`20260427-868a`](#adr-20260427-868a-open-root-dispatch-manifest-schema-ajv-fixture-drift-test-as-enforcement-boundary-superseded) | Open-root dispatch-manifest schema; AJV fixture drift test as enf… | Superseded |
| [`20260421-321a`](#adr-20260421-321a-epic-level-remote-orchestration-via-github-label-trigger-superseded) | Epic-level remote orchestration via GitHub label trigger (superse… | Superseded |
| [`20260422-380b`](#adr-20260422-380b-sprint-retro-routes-through-providerpostcomment-not-notifyjs-superseded) | `/sprint-retro` routes through provider.postComment, not notify.j… | Superseded |
| [`20260422-413a`](#adr-20260422-413a-pre-wave-spawn-smoke-test--post-wave-commit-assertion-superseded) | Pre-wave spawn smoke-test + post-wave commit assertion (superseded) | Superseded |
| [`20260422-413b`](#adr-20260422-413b-sprint-story-close-recovery-via-explicit---resume----restart-superseded) | `sprint-story-close` recovery via explicit --resume / --restart (… | Superseded |
| [`20260422-441b`](#adr-20260422-441b-canonical-structured-comment-writer-is-the-mcp-tool-superseded) | Canonical structured-comment writer is the MCP tool (superseded) | Superseded |
| [`20260423`](#adr-20260423-trust-the-ticket-not-the-pipe--idle-timeout-ground-truth-superseded) | Trust the ticket, not the pipe — idle-timeout ground truth (super… | Superseded |
| [`20260423-511a`](#adr-20260423-511a-features-remain-in-the-cascade-epics-and-planning-do-not-superseded) | Features remain in the cascade; Epics and Planning do not (supers… | Superseded |
| [`20260423-511c`](#adr-20260423-511c-dispatch-manifest-writes-are-atomic-tmp--rename-superseded) | Dispatch-manifest writes are atomic (tmp + rename) (superseded) | Superseded |
| [`20260424-553a`](#adr-20260424-553a-bounded-concurrency--ttl-cache-for-epic-runner-fanout-superseded) | Bounded-concurrency + TTL cache for epic-runner fanout (superseded) | Superseded |
| [`20260424-553b`](#adr-20260424-553b-per-phase-timing-as-a-first-class-epic-runner-surface-superseded) | Per-phase timing as a first-class epic-runner surface (superseded) | Superseded |
| [`20260424-596b`](#adr-20260424-596b-base-branch-enforced-anti-gaming-guardrail-reverted) | Base-branch-enforced anti-gaming guardrail (reverted) | Reverted |
| [`20260426-817b`](#adr-20260426-817b-sprint-story-close-is-the-canonical-local-story-validation-gate-superseded) | `sprint-story-close` is the canonical local Story validation gate… | Superseded |

**Not ADR entries (1).**

- [Earlier ADRs (001 / 002 / 003)](#earlier-adrs-001--002--003)

<!-- ADR-INDEX:END -->

## ADR 20260802-4938-schema-compilers: A schema is compiled by code, or declares in-file why not

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** `.agents/scripts/check-schema-references.js`

### Context

`friction-event.schema.json` outlived the Epic #4406 cutover that superseded
it. Nothing compiled it, but it parsed and sat where enforced contracts live,
so readers took it for one — an `/audit-documentation` lens graded a High
finding against it, and that reached an acceptance criterion before a
delivering worker overruled it. Existence plus valid syntax passed for
authority at every layer.

### Decision

A schema under `.agents/schemas/` must be compiled by some code path;
`check-schema-references.js` gates it, resolving a literal basename, a `$ref`,
or a computed-path directory whose stem is the runtime key — comments
stripped, since counting a docblock would let the gate certify itself. One
kept deliberately says so in a root `x-mandrel-uncompiled` block naming the
`runtimeGate` that really enforces the shape: in the document, not a side-car
allowlist, because the failure was a reader trusting the document.

### Consequences

`friction-event.schema.json` is deleted, its shape surviving in the
data-dictionary archive. The first run found a second case,
`model-attribution.schema.json`, now declared in-file. The gate asks "is
anything compiling this?", never "is what compiles it faithful to it?".

## ADR 20260726-v2-story-collapse: Story-only ticket model; one /plan, one /deliver, one engine

**Status:** Accepted
**Date:** 2026-07-26
**Surface:** `.agents/workflows/deliver.md`
**Released:** `mandrel-v2.0.0` (2026-07-15) and the v2.x line since
**Supersedes:**
[`20260611-two-tier-hierarchy`](#adr-20260611-two-tier-hierarchy-remove-the-feature-tier-epic--story-superseded),
[`20260510-sdl-collapse`](#adr-20260510-sdl-collapse-5400--collapse-to-epic-plan--epic-deliver-fold-retro-into-deliver-tail-superseded),
[`20260508-flatten`](#adr-20260508-flatten-retire-wave-execute-epic-execute-owns-the-wave-loop-directly-superseded),
[`20260501-900a`](#adr-20260501-900a-epic-centric-workflow-rework--four-skill-split-single-session-fan-out-retire-github-triggers-superseded),
[`20260512-destructive-replan-retired`](#adr-20260512-destructive-replan-retired-epic-1182--retire-delete-epicjs-re-plan--edit-spec--reconcile-superseded),
[`20260427-868a`](#adr-20260427-868a-open-root-dispatch-manifest-schema-ajv-fixture-drift-test-as-enforcement-boundary-superseded),
and seven Epic-scoped entries flagged in place: `20260422-413a`,
`20260422-413b`, `20260423`, `20260423-511c`, `20260424-553a`,
`20260424-553b`, `20260426-817b`.

Those thirteen are the whole list — each carries the reciprocal
`Superseded by <this entry>` status. The earlier blanket "the Epic-scoped
`ADR-202604*` cluster" was false: most such entries are still Accepted or
superseded by something else.

### Context

The v2 cutover landed across `mandrel-v2.0.0` and the v2.x line without an ADR
of its own, so the newest hierarchy entry in this log
(`20260611-two-tier-hierarchy`) still stamped the retired `Epic → Story`
topology **Accepted** with nothing superseding it. An agent reasoning about the
current ticket model from this file read a shape the runtime had already
deleted. This ADR is the authoritative record of what replaced it; the entries
it supersedes are flagged in place rather than removed.

The v1 model was Epic-centric: an Epic ticket owned a decomposed tree of Story
tickets, an `epic.yaml` spec, a wave DAG, an in-process Epic runner that fanned
Stories out per wave, a dispatch manifest, an `epic/<id>` integration branch,
and a command surface (`/epic-plan`, `/epic-deliver`, `/epic-execute`,
`/wave-execute`, the `sprint-*` scripts) that grew a tier every time the
orchestration needed one. Every tier carried ceremony but only the Story carried
an execution payload — a point `20260527-three-tier-hierarchy` and
`20260611-two-tier-hierarchy` each conceded one tier at a time.

### Decision

**One ticket type.** `type::story` is the only ticket type. `acceptance[]` and
`verify[]` live inline in the Story body alongside a folded Tech Spec under
`## Spec`; over-budget Specs fail closed (split or tighten — never write a Spec
under `docs/`). There is no `type::epic` and no `type::feature` label, no
`epic-spec.schema.json`, no decomposer tree, and no completion cascade. Rare
multi-Story ordering is expressed as `depends_on` edges resolved from live state
at delivery time; the `plan-run::<id>` label is filter metadata only. `/deliver`
refuses any ticket carrying an `Epic: #N` footer — a v1 ticket is a stop-and-
re-plan signal, not a compatibility case.

**Two commands.** `/plan` (interrogate → author → persist) and `/deliver` (the
unified delivery entry point) are the whole SDLC surface. The `/deliver-light`
split introduced during the cutover was folded back into `/deliver`, which
derives the path from the work rather than from a flag; `route::lite` survives
as a human-visible hint that never controls dispatch. `/prototype` was added as
a separate operator-invoked pass for reviewing a UI layout *before* its
acceptance criteria are authored — deliberately outside `/deliver`, because it
produces a throwaway artefact under the gitignored temp tree rather than a
landed change.

**One delivery engine.** `helpers/deliver-story` is the single engine every
Story runs, sub-agent or inline: `single-story-init.js` seeds `story-<id>` from
`main` and materializes a worktree, the agent implements and commits on that
branch, a bounded acceptance self-eval scores the change set against
`acceptance[]`, and `single-story-close.js` runs the close-validation chain,
pushes, opens the PR, watches CI, merges, and emits one schema-validated
terminal envelope. There are no waves, no Epic runner, no dispatch manifest, no
`epic/<id>` integration branch, and no `--no-ff` wave merge. A PR against `main`
is the only merge surface.

### Consequences

- The orchestration surface a reader must hold in context collapsed from a tier
  hierarchy plus a fan-out runtime to one ticket type and one engine. Roughly a
  third of this log's entries describe surfaces that no longer exist; they are
  collapsed in place with a `Superseded by` pointer here.
- Parallelism moved from a wave barrier to a continuously resolved ready set,
  so a Story is dispatchable the moment its dependencies land rather than at the
  next wave boundary.
- Some v1 primitives outlived their decisions and are now consumed elsewhere:
  `lib/util/concurrent-map.js` (bounded fan-out), `lib/util/poll-loop.js`
  (bounded waits), the atomic tmp+rename write, and the lifecycle bus. Their
  originating ADRs are superseded on the Epic-runner axis only, and each says so.
- `lib/util/phase-timer.js` survived the collapse without its consumer: no
  producer posts the `phase-timings` structured comment any more, even though
  the kind is still registered in `ticketing/reads.js`. Recorded here so the
  next reader does not mistake a registered kind for a produced one.

### Alternatives considered

- **Keep the Epic tier as an optional grouping ticket.** Rejected for the same
  reason `20260611-two-tier-hierarchy` rejected an optional Feature tier: an
  optional tier means every consumer keeps both code paths alive forever, which
  is the shim layer the hard-cutover policy forbids.
- **Keep `/deliver-light` as a separate command.** Rejected — two delivery doors
  meant the operator picked the route, and an operator-picked route is a guess
  about the change set. Deriving intent inside one door keeps the guard
  asymmetry honest.
- **Ship a compatibility path for v1 Epics.** Rejected per the hard-cutover
  contract policy; in-flight Epics are drained on the old version instead.

---

## ADR 20260624-loop-units-division-of-labor: mandrel owns content + oracle + contract; the host owns cadence + iteration

**Date:** 2026-06-24
**Surface:** `.agents/scripts/sync-claude-commands.js`
**Status:** Accepted
**Epic:** [#4284](https://github.com/dsj1984/mandrel/issues/4284)
**Builds on:**
[ADR 20260512-coupling-stance](#adr-20260512-coupling-stance-two-surface-coupling-stance)
and
[ADR 20260512-loop-adoption](#adr-20260512-loop-adoption-adopt-built-in-loop-no-homegrown-surface-to-reconcile).

Loop units (`.agents/workflows/loops/*.md`) ship the **content and contract** of
recurring work — the action, the goal, the runnable `verify` oracle (required
for `self-paced`, optional for `interval` / `cron`), and the
observability/escalation contract (`maxRounds` / `onExhaust` + explicit
stop-and-escalate conditions). The **host owns cadence and iteration**: the
built-in `/loop` drives self-paced and interval loops, `/schedule` drives cron
loops. Mandrel ships **no `/goal` command and no `/loop` runner** — building one
would duplicate a Claude Code built-in and create a homegrown surface to
reconcile, which the coupling stance forbids. Read the full ADR before adding a
runner, scheduler, or definition-of-done command to the framework — the decision
to **not** build one is deliberate.

> **Full ADR:**
> [`decisions/loop-units-division-of-labor.md`](decisions/loop-units-division-of-labor.md).

---

## ADR 20260611-two-tier-hierarchy: Remove the Feature tier (Epic → Story) (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-06-11
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Deleted the Feature tier end to end and published Epic → Story as the only shape (`epic-spec.schema.json` v4.0.0, `stories[]` at the spec root). The v2 collapse then removed the Epic tier as well, so no tier hierarchy survives.

---

## ADR 20260610-lifecycle-bus-retained: Keep the lifecycle bus; collapse-by-deletion is already done

**Status:** Accepted
**Date:** 2026-06-10
**Surface:** `.agents/scripts/lib/orchestration/lifecycle/bus.js`
**Scope:** Story #3911 (audit findings — see git history at `409e0529`).
**Depends on:** #3908 (dead-stratum deletion), #3909 (state-surface collapse) —
both merged before this decision was recorded.

### Context

The §4 audit posed a **directional** question (deliberately sequenced last, after
the repairs #3900–#3907 and the deletions #3908/#3909 landed): should the
`/epic-deliver` close-tail lifecycle **bus** be replaced with direct named
function calls plus an `appendLedger()` helper, and should the steady-state wave
loop be collapsed to a minimal hop set? The audit's stated motive for the
bus-replacement was that *"the static call graph would mechanically prevent the
Story #3367 'wrong emit deletes branches' bug class currently fenced with
prose,"* and that direct calls *"would reproduce it in ~1/4 the code."* The
acceptance criteria make the replacement **conditional** ("if yes …").

This ADR records the decision; the post-#3908/#3909 codebase was the input to it.

### Decision

**1. KEEP the lifecycle bus. Do NOT replace it with direct calls.** The audit's
"~1/4 the code" estimate weighed the bus as ceremony, but its surviving
production value is **load-bearing safety**, not boilerplate:

- **Schema validation before any side effect** — `bus.emit()` validates the
  payload against `.agents/schemas/lifecycle/<event>.schema.json` and throws
  *before* a single listener runs, so a malformed close-tail payload never
  triggers a partial finalize.
- **`emitted`-before-`completed` NDJSON ordering** — the privileged
  `onEmitted` / `onCompleted` / `onFailed` hooks that `LedgerWriter` installs
  are the substrate of the **resume contract**: a crash mid-chain leaves a
  recoverable trail with monotonic `seqId`, and listeners are idempotent on
  `(event, seqId)` across replay. Direct calls + a bare `appendLedger()` would
  have to re-derive this ordering guarantee by hand at every call site.
- **Secret-strip and one-place observability** — `LedgerWriter` strips the
  secret denylist from every payload; the ledger is the single forensics
  system-of-record that the idle watchdog and resume both read.

Crucially, the **hot path that did not need those guarantees already bypasses
the bus**: Story #3900 routes `story.dispatch.start` / `story.dispatch.end` /
`story.heartbeat` through thin direct ledger-append helpers
(`lifecycle-emit-story-dispatch.js`, `emit-story-dispatch-end.js`,
`emit-story-heartbeat.js`) precisely because the full listener chain is the wrong
altitude for a per-Story tick. What remains on the bus is exactly the
**close-tail** (acceptance-reconcile → finalize → automerge-arm → merge-watch →
cleanup), where the schema/ordering/resume guarantees matter most. The
architecture has therefore *already* converged on "direct calls where they're
cheap and safe; bus where the resume contract is load-bearing" — the audit's
target end-state, reached by subtraction rather than by a rewrite.

**The audit's one concrete safety motive is already satisfied without the
rewrite.** Story #3901 shipped an event-connectivity contract test asserting
**every schema'd event has ≥1 production emitter and
≥1 production subscriber (or an explicitly classified terminal/external
rationale)**. That is the mechanical "no dead wire / no wrong emit" guard the
audit said a direct call graph would provide — now enforced in CI against the
bus topology itself. The prose fence is replaced by a test; the bus stays.

A full replacement would also be a multi-thousand-LOC rewrite spanning four
production callers (`lifecycle-emit.js`, `story-close.js`, `retro-run.js`,
`epic-deliver-note-intervention.js`), the eight close-tail listeners (~4,600
LOC), 40 event schemas, and 39 test files — directly contradicting the audit's
own "~100 LOC new code" framing and churning the surfaces #3901/#3904 stabilized
days earlier. That is the opposite of a clean hard cutover.

**2. The steady-state wave-loop collapse is ALREADY DONE by the merged
dependencies.** The loop is a single stateless tick planner →
fan-out → `epic-execute-record-wave.js` (the only advancer of `currentWave`) →
loop. Story #3909 already retired the write-only wave **bus** events with no
reader (`wave-tick`, `epic-complete`), consolidating durable wave progress to
**checkpoint + ledger + one `epic-run-progress` comment** — the exact "keep
three" target of §2.2. The working crash-recovery paths are preserved:
Story #3907's mode-B empty-returns reconcile (`--returns '[]'` re-derives
`plan[N]` from GitHub so `currentWave` advances after a
post-children/pre-record crash) and the §2e idle watchdog with branch-commit
liveness (#3900). No further hop-set collapse is available without
reintroducing a write-only surface or removing a crash-recovery branch.

**3. Residual structural cleanup carried by this Story.** The #3908 deletion
left three stale references to deleted modules in surviving code/prose, which
this Story corrects: the wave-loop dispatch prose in
`epic-deliver.md` (the matching `story.dispatch.end` is written by
`epic-execute-record-wave.js`, not "`wave-session`'s bus"), and the
`epic-runner/factory.js` references in `lifecycle/listeners/index.js` and
`lifecycle-emit.js` (the factory was deleted by #3908; `buildDefaultListenerChain`
is now the sole production wiring path).

### Consequences

- The lifecycle bus, its schema-validation seam, the `LedgerWriter` hook
  ordering, and the close-tail listener roster are **retained as the canonical
  architecture**. `docs/LIFECYCLE.md` remains authoritative.
- The "wrong-emit / dead-wire" bug class is mechanically fenced by the
  #3901 connectivity contract test rather than by prose — future contributors
  who add a schema without wiring it (emitter + subscriber) fail CI.
- The wave loop needs no further collapse; §2.2/§6-step-3 closed it via #3909.
- The §4 directional question is **resolved as "no rewrite"** with the rationale
  recorded here, so a future reader does not re-litigate it. Should the resume
  contract or the close-tail roster ever be redesigned wholesale, this ADR is
  the entry point to revisit the keep decision.

---

## ADR 20260610-planning-determinism-dispositions: Per-layer dispositions for the deterministic planning proxies

**Status:** Accepted — dispositions stand; the `/epic-plan` rows are superseded
**Date:** 2026-06-10
**Surface:** `.agents/scripts/lib/orchestration/ticket-validator.js`
**Scope:** Story #3910 (audit findings — see git history at `409e0529`).

> **Superseding note (Story #4786).** The *keep / simplify / defer* dispositions
> below still govern the planning proxies, and the kept layers are live:
> `lib/orchestration/ticket-validator*.js`, `lib/duplicate-search.js`, and the
> evidence-gate skip cache. The rows scoped to the retired `/epic-plan` surface
> — the clarity gate (`lib/epic-plan-clarity.js`), the consolidate critic's
> scope-preservation claim, and `assertNoSingleStoryFeature` — went with the v2
> Story collapse and are historical; read them as rationale, not as a live
> contract.

### Context

The planning pipeline carries several deterministic keyword / regex / Jaccard
proxies for judgment the host frontier model already makes. The §4 audit asked,
per layer, to either simplify/delete the proxy or **explicitly keep it with a
recorded justification**, and flagged two validators that *advertised a
guarantee they did not provide*. This ADR is the single home for those
dispositions so a future reader does not re-litigate each one.

### Decision

**Simplified in Story #3910:**

- **Clarity gate** (`lib/epic-plan-clarity.js`): Acceptance Criteria is now a
  **required** section — `clear` requires `≥ 4/5` sections present **and** the
  AC section present. The pre-#3910 `≥ 4/5` rule passed an Epic with *no*
  Acceptance Criteria, which then hard-failed the `/epic-deliver` start gate
  downstream: the gate advertised a clarity guarantee it did not provide. The
  idempotent persist CLI is unchanged.
- **Consolidate critic "scope-preserving" claim**
  (`skills/core/epic-plan-consolidate/SKILL.md`): the claim that scope
  conservation is "asserted by a test that checks the acceptance/verify union"
  overstated coverage — the unit test exercises a *pure model* of the merge, not
  the critic's actual LLM output, and **no runtime acceptance-union diff** runs
  on the result (the only post-consolidation runtime backstop is
  `assertNoSingleStoryFeature`). The Skill now states this plainly rather than
  promising a machine guarantee. Adding a real runtime acceptance-union diff is
  deferred (it is net-new validation, not a sweep).

**Explicitly kept (high-value determinism — cheap, hard, catches real
hallucinations):**

- **Ticket structural validation** (hierarchy, cycles, dependency resolution in
  `lib/orchestration/ticket-validator*.js`), **file-assumption git probes**, and
  the **`maxTickets` reviewability budget** (soft, `--allow-over-budget`) — the
  highest-value determinism in the pipeline; they catch real authoring
  hallucinations a model cannot self-check.
- **Epic/Story lease + checkout guards**, the **evidence-gate** skip cache, and
  the **PR open/locate** probes — coordination/idempotence primitives with no
  LLM-judgment substitute.
- **`duplicate-search` token-Jaccard ranking** (`lib/duplicate-search.js`,
  consumed by `/epic-plan` Phase 2 and `story-plan.js`) — **explicitly kept**
  (omitted from the original sweep table; added by Story #4021). It is a
  pre-creation triage signal over the open-Epic/Story corpus the model does
  not otherwise see in context; the scoring is pure and cheap, the result is
  HITL-confirmed before any ticket is created, and there is no LLM-judgment
  substitute that does not first require fetching the same corpus. Not a
  guarantee surface — it ranks candidates, it does not block creation.

**Kept for now, simplification deferred to a follow-up (each is net-new
deletion/refactor beyond a prose-and-guarantee sweep, and several touch live
test surfaces or the dead-stratum boundary owned by #3908/#3909/#3911):**

- **Spec-freshness "net-new cue" keyword classifier** — the decompose-side git
  probes are the real gate; the cue classifier is a candidate for deletion.
- **BDD `findBestScenarioMatch` Jaccard matcher** — keep the scanner index;
  the model authors the Disposition column either way, so the matcher is
  removable.
- **Risk-verdict derivation/routing (~180 LOC)** — the schema + audit comment
  stay; the model authors the axes, so the derivation/routing collapse is a
  follow-up.
- **Phase 7.5 section gate** — right check, wrong altitude: fold the one-line
  call inside `runSpecPhase` and delete the standalone CLI + manual phase.

### Consequences

Story #3910 closes the two advertised-guarantee gaps and records keep/defer
rationale for the rest. The deferred simplifications remain tracked by the §4
audit table; they are intentionally **not** bundled into this sweep so the
hard-cutover doctrine (one in-tree migration per contract change) is preserved
and the change set stays reviewable.

---

## Overturn: `drain-pending-cleanup` demoted to a helper

**Status:** Accepted (overturns the `drain-pending-cleanup` row of the
recategorization matrix above).
**Date:** 2026-06-07
**Surface:** `.agents/scripts/drain-pending-cleanup.js`
**Story:** #3706

### Context

The matrix row above kept `/drain-pending-cleanup` as a top-level slash
command on the rationale that "the manual path is load-bearing — an operator
hitting a wedged worktree types `/drain-pending-cleanup` directly." A wiring
audit conducted for Story #3706 tested that assumption against the actual
call graph and found it does not hold:

- The **three automatic callers** —
  the in-process `epic-runner.js` Phase 7 (since retired in Epic #3823 —
  the live `/epic-deliver` loop owns this via the close-tail cleanup path),
  `story-close.js`
  (`drainPendingCleanupAfterClose`), and
  [`worktree-sweep.js`](../.agents/scripts/lib/orchestration/plan-runner/worktree-sweep.js)
  (via `drainPendingCleanupAtBoot`) — all invoke
  `drain-pending-cleanup.js` (`forceDrainPendingCleanup`) **directly**.
  None of them resolve or shell out to the slash command. Demoting the
  `.md` therefore does not touch any automatic path.
- The **manual escape hatch** survives unchanged as
  `node .agents/scripts/drain-pending-cleanup.js` (with its
  `--no-escalate` / `--dry-run` / `--worktree-root` flags). The script is
  not modified by this change.
- The only thing the slash command added was `/`-menu ergonomics, which is
  pure operator-convenience that the operator does not use in practice.

### Decision

Demote `drain-pending-cleanup` from a top-level workflow to a `helpers/`
reference. Its operator content (when-to-run, manual usage, escalation
limitations, constraints, last-resort recipe) is folded into the existing
[`helpers/worktree-lifecycle.md`](../.agents/workflows/helpers/worktree-lifecycle.md),
which already documents the drain caller table. The standalone
`.agents/workflows/drain-pending-cleanup.md` is deleted; the next
`npm run sync:commands` drops the orphan `.claude/commands/drain-pending-cleanup.md`
because the sync filter excludes content the operator no longer surfaces as
a command. This mirrors the `worktree-lifecycle` row's treatment.

### Consequences

- **`/drain-pending-cleanup` no longer resolves as a slash command.** The
  operator runs the drain directly via
  `node .agents/scripts/drain-pending-cleanup.js` when a wedged worktree
  needs a manual nudge.
- **The automatic drain paths never depended on the slash command.** Of the
  three cited here in 2026, only the plan-boot sweep survives
  (`lib/orchestration/plan-runner/worktree-sweep.js` calls
  `forceDrainPendingCleanup()` from `lib/worktree/lifecycle/force-drain.js`);
  the epic-runner Phase 7 and story-close post-merge callers went with the
  in-process stratum.
- **The script is the SSOT for the manual path.** No behaviour changed in
  `drain-pending-cleanup.js`; only the `.md` projection was removed.

### Alternatives considered

- **Keep the standalone `helpers/drain-pending-cleanup.md` file.** Rejected
  — `worktree-lifecycle.md` already owns the drain caller table, so a
  separate helper file would duplicate the same when-to-run / escalation
  content and drift over time. Folding the content into the existing
  lifecycle reference keeps a single home for worktree-cleanup operator
  guidance.

---

## ADR 20260604-flat-command-projection-revert: Revert the plugin cutover — project workflows as flat `/<name>` commands

**Status:** Accepted
**Date:** 2026-06-04
**Surface:** `.agents/scripts/sync-claude-commands.js`
**Supersedes:**
[`20260603-plugin-namespace-cutover`](#adr-20260603-plugin-namespace-cutover-project-workflows-as-a-claude-code-plugin-mandrelname-superseded)
— reverts the plugin projection back to a flat `.claude/commands/` surface.

### Context

ADR 20260603 projected the workflows into a Claude Code **plugin**
(`/mandrel:<name>`) to gain an invocation-level namespace. In practice that
bet failed a load-bearing assumption: **the plugin system is not available in
every Claude Code environment.** An operator on Claude Code 2.1.159 found
`/plugin` reported *"isn't available in this environment"* and **no**
`/mandrel:<name>` commands appeared — even though `.claude/settings.json`
carried valid `extraKnownMarketplaces` + `enabledPlugins` and `claude plugin
validate` passed. Because #3576 was a hard cutover that **deleted** the flat
`.claude/commands/` projection, the entire Mandrel command surface became
unreachable in any environment that cannot load plugins.

The flat `.claude/commands/*.md` projection, by contrast, is the surface that
loads across **every** Claude Code environment (CLI, IDE, GUI, web, SDK)
with no plugin/marketplace/enablement plumbing.

### Decision

Revert to a **flat projection**: `sync-claude-commands.js` writes each
top-level `.agents/workflows/*.md` into `.claude/commands/<name>.md`, invoked
as a bare `/<name>` command. No plugin manifest, no repo-local marketplace, no
`enabledPlugins` / `extraKnownMarketplaces`. On a machine that synced
under #3576, the next sync **reaps** the stale `.claude/plugins/mandrel/` +
`.claude/.claude-plugin/`. The cwd-rooted resolution (Story #3588) and the
frontmatter-preserving header injection (`lib/command-header.js#applyHeader`,
so each command's `description` parses) are kept.

What reverts from ADR 20260513 is the **descriptive base-name discipline**,
not the single-brand affordance: the `/mandrel` catalog entry is **not**
restored. No `mandrel.md` workflow exists and nothing projects a `/mandrel`
command, so the framework ships no discoverability entry point — the `/` menu
is the catalog. The collision-risk and provenance concerns #3576 raised are
accepted as the cost of universal reachability: a command that does not load
has no namespace to protect.

### Consequences

- **Breaking change** for consumers on a #3576 release: commands revert from
  `/mandrel:<command>` to `/<command>`; the next `mandrel sync` reaps the
  plugin tree and writes `.claude/commands/`. No plugin enablement is needed.
- The cross-runtime contract (`.agents/workflows/` + dispatch manifest) is
  untouched, as it was under #3576.

---

## ADR 20260603-plugin-namespace-cutover: Project workflows as a Claude Code plugin (`/mandrel:<name>`) (superseded)

**Status:** Superseded by [`20260604-flat-command-projection-revert`](#adr-20260604-flat-command-projection-revert-revert-the-plugin-cutover--project-workflows-as-flat-name-commands)
**Date:** 2026-06-03
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Projected `.agents/workflows/*.md` into a Claude Code plugin namespace (`/mandrel:<name>`) as a hard cutover from flat `.claude/commands/`. Reverted one day later — the plugin system is unavailable in some Claude Code environments.

---

## ADR 20260527-three-tier-hierarchy: Collapse the Task level (Epic → Feature → Story) (superseded)

**Status:** Superseded by [ADR 20260611-two-tier-hierarchy](#adr-20260611-two-tier-hierarchy-remove-the-feature-tier-epic--story-superseded)
**Date:** 2026-05-27
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Removed the Task tier, leaving Epic → Feature → Story. Both remaining tiers were removed in turn (Feature by 20260611, Epic by the v2 collapse).

---

## ADR 20260519-adapter-layer-removed: Delete the `IExecutionAdapter` abstraction

**Status:** Accepted
**Date:** 2026-05-19
**Surface:** `.agents/scripts/providers/github.js`
**Epic:** [#2646](https://github.com/dsj1984/mandrel/issues/2646) —
hard-cutover cleanup pass
**Story:** [#2688](https://github.com/dsj1984/mandrel/issues/2688) —
Story A: Delete the IExecutionAdapter abstraction
**Supersedes (in part):**
[ADR 20260512-coupling-stance](#adr-20260512-coupling-stance-two-surface-coupling-stance) —
keeps the two-surface stance but retires the "runtime-pluggable
dispatcher" framing in favor of the dispatch manifest as the
cross-runtime contract.

### Context

The shipped `IExecutionAdapter` interface
(`.agents/scripts/lib/IExecutionAdapter.js`), `ManualDispatchAdapter`
(`.agents/scripts/adapters/manual.js`), and `adapter-factory.js`
existed to keep the dispatcher runtime-neutral so future adapters
(Codex, Antigravity, subprocess, MCP) could plug in without
rewriting the orchestration core. In practice:

- The only concrete adapter ever shipped was `manual`. It was
  hardcoded as the factory default.
- The adapter return values (`dispatchId`, in-memory registry,
  `getTaskStatus`, `cancelTask`) were **never observed at runtime** —
  completion is tracked via GitHub `agent::*` labels, not by polling
  the adapter.
- The dispatch *manifest* (the `.md` artifact written under `temp/`
  and the `dispatch-manifest` structured comment posted on the Epic)
  is the load-bearing artifact downstream tooling and operators read.

### Decision

Delete the adapter layer:

- `.agents/scripts/adapters/manual.js` — gone.
- `.agents/scripts/lib/IExecutionAdapter.js` — gone.
- `.agents/scripts/lib/adapter-factory.js` — gone.
- `tests/execution-adapter.test.js` and adapter-coupled assertions in
  `tests/lib/dispatcher-worktree.test.js` — deleted / re-pointed to
  the inline dispatch-record shape.

Inline the trivial dispatch-record shape `{ taskId, dispatchId,
status }` at the two consuming call sites
(`wave-dispatcher.js`, `manifest-builder.js`). The manifest's
`executor` field is fixed to the string literal `'claude-code'`.

The **dispatch manifest** (md + structured comment, formerly schema-backed)
is the cross-runtime contract. Any future host that wants to replay,
audit, or interoperate with a Mandrel dispatch consumes the manifest,
not an in-process interface.

### Consequences

- **Smaller orchestrator surface.** Fewer files, fewer dual-shape
  readers, no factory indirection on the dispatch hot path.
- **Schema-level breaking change.** The legacy `executor` key under
  the pre-reshape `orchestration` block in `.agentrc.json` becomes a
  no-op. Per the "no shim layer / hard
  cutovers only" policy (codified by Epic #2646 in
  [`git-conventions.md`](../.agents/rules/git-conventions.md)),
  consumers who still set it will fail validation on upgrade — the
  PR diff is the migration.
- **Dispatch manifest is byte-stable.** Story A preserved the
  manifest md and structured-comment payload byte-for-byte; the
  only field that changed is `executor` (now always `'claude-code'`).
- **Future runtimes still in scope.** Adding a non-Claude-Code
  runtime later is not blocked — the new host owns the dispatch
  manifest contract directly. There is no in-process interface that
  must be retrofitted.

---

## ADR 20260514-drop-churn-idle: Drop `churn` + `idle` from active perf-signal taxonomy

**Status:** Accepted
**Date:** 2026-05-14
**Surface:** `.agents/schemas/agentrc.schema.json`
**Epic:** [#1721](https://github.com/dsj1984/mandrel/issues/1721) —
performance-signal detectors
**Supersedes (in part):**
[ADR 20260507-1030a — Performance-signal telemetry](#adr-20260507-1030a-performance-signal-telemetry--events-local-summaries-on-tickets)
(updates the active-detector subset; the events-local / summaries-on-
tickets architecture is unchanged)

### Context

ADR 20260507-1030a pinned a seven-kind perf-signal taxonomy
(`friction`, `hotspot`, `rework`, `churn`, `idle`, `retry`, `trace`)
and reserved a slot in `SIGNALS_DEFAULTS` for each of the five
detectors. When Epic #1721 sat down to actually ship the missing three
(`hotspot`, `rework`, `retry`), the design review for `churn` and
`idle` exposed two problems:

- **`churn` semantically duplicates `rework` + `retry`.** The original
  intent was "the same surface keeps getting touched" — but rework
  already counts file edits past a per-file threshold, and retry
  counts repeated failed Bash invocations. Whatever a hypothetical
  churn detector would surface is either a strict subset of one of
  those two, or a noisier rollup that would mostly fire as a duplicate
  of an event that already landed.
- **`idle` (gap between tool calls) is too noisy to act on.** The
  signal as specified — fire when the gap exceeds
  `idle.gapSeconds` — has no meaningful denominator. Plan-mode
  pauses, model thinking time, deliberate human-in-the-loop pauses,
  and the seconds-long startup of a `gh` spawn all look identical to
  the detector. Without a way to distinguish "agent stalled" from
  "agent waiting on an external process or operator", the signal
  generates more friction than it surfaces.

### Decision

1. **Drop `churn` and `idle` from the active detector set.** Neither
   ships a detector module; neither carries a config key on
   `delivery.signals`. The wired detector set is exactly
   `{ rework, retry, hotspot }`.
2. **Keep `CHURN` and `IDLE` in the
   [`EVENT_KINDS`](../.agents/scripts/lib/signals/schema.js)
   enumeration.** The schema entries remain reserved for future use so
   a re-introduction does not need a schema bump or a coordinated
   producer/consumer migration. The aggregator's `signalCounts`
   surface continues to carry both keys at zero so a downstream
   consumer that referenced them does not break.
3. **Drop the unused config keys.** `delivery.signals.churn` and
   `delivery.signals.idle` are removed from `SIGNALS_DEFAULTS` and the
   `agentrc.schema.json` validation block. Operators who carried them
   in `.agentrc.json` from a pre-Epic-#1721 template see them ignored,
   not rejected — the schema is permissive on unknown nested keys
   under `delivery.signals` to keep the migration silent.
4. **Update `docs/architecture.md`** to name the three shipped
   detectors explicitly (no "future" qualifier) and to note that the
   schema retains the two reserved kinds.

### Consequences

- **Smaller shipping surface, same architecture.** The events-local /
  summaries-on-tickets contract from ADR 20260507-1030a is unchanged;
  only the active-detector subset narrows.
- **Detector set is now provable end-to-end.** Each shipped detector
  has a pure module under `lib/signals/detectors/`, a wiring layer in
  the orchestrator (`post-merge-pipeline.js` for rework + retry,
  `epic-runner/progress-reporter.js` for hotspot), and a render-surface
  test in `tests/lib/observability/render/`.
- **Operators with leftover config keys are not punished.** Carrying
  `delivery.signals.churn` or `.idle` in a project's `.agentrc.json`
  is a no-op rather than an error. The next operator-friendly
  template refresh removes the stale keys without an audible failure.
- **Reintroducing churn or idle later is cheap.** The schema entries
  remain; only a detector module + a wiring layer + a render test
  would be required, with no coordination across the producer ↔
  consumer boundary.

---

## ADR 20260512-destructive-replan-retired: Epic #1182 — retire `delete-epic.js`; re-plan = edit-spec + reconcile (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-05-12
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Retired `delete-epic.js` in favour of a declarative `epic.yaml` edited then reconciled, so re-planning was never destructive. The v2 collapse removed the Epic spec, the reconciler, and the whole re-plan surface; a Story is re-planned by editing its `## Spec` in place.

---

## ADR 20260512-coupling-stance: Two-surface coupling stance

**Status:** Accepted
**Date:** 2026-05-12
**Surface:** `.agents/scripts/providers/github.js`
**Supersedes:**

- Implicit assumption that the entire framework — dispatcher, workflow,
  hooks, skills, and slash commands — must remain runtime-neutral.

### Context

The framework spans two distinct surfaces with different portability
profiles:

1. The **dispatcher / `.agents/scripts/` library** is a runtime-neutral
   orchestration core. It runs as plain Node.js, holds the ticket /
   branch / worktree contracts, and is the integration boundary that
   any execution adapter implements against. Keeping this surface
   runtime-neutral preserves the option to add additional execution
   adapters later (Codex, Antigravity, subprocess, MCP) without
   rewriting the orchestration core.
2. The **workflow / `.claude/` / hook / skill surface** consists of the
   slash commands, agent definitions, hook scripts, and skill markdown
   files that operators interact with day to day. This surface is
   tightly coupled to Claude Code as the reference runtime — it relies
   on Claude Code's slash-command execution model, hook lifecycle,
   skill loading, and sub-agent dispatch primitives. Treating it as
   runtime-neutral has produced adapter-layer stubs for runtimes that
   were never implemented (`// antigravity:`, `// 'claude-code':`,
   `// codex:`, `// subprocess:`, `// mcp:` slots in
   `.agents/scripts/lib/adapter-factory.js`) and has discouraged
   adoption of Claude Code built-ins (`/goal`, `/simplify`,
   `/security-review`, `/loop`, `/fewer-permission-prompts`,
   `/insights`) that would shrink the framework's homegrown surface
   area.

The framework is — in practice and by design — a **Claude Code-first
opinionated workflow framework with a runtime-pluggable dispatcher**.
This ADR makes that coupling stance explicit so subsequent phases of
the Mandrel rebrand and downstream Epics reference a single source of truth
instead of re-litigating the question per change.

### Decision

The framework adopts a **two-surface coupling stance**:

- The **dispatcher surface** (`.agents/scripts/`) stays runtime-neutral.
  Adapters are added on demand, not pre-declared. The reference adapter
  is `manual`. Additional adapters are accepted on their own merits as
  separate epics.
- The **workflow surface** (`.claude/` slash commands, agent
  definitions, hooks, skills, and the workflow documents under
  `.agents/workflows/`) is **Claude Code-first**. Portability of this
  surface to other runtimes is an explicit non-goal. Claude Code
  built-ins are preferred over homegrown re-implementations when their
  contracts match or can be wrapped to match the framework's artifact
  expectations.

Where overlap exists between a Claude Code built-in and a homegrown
wrapper, the default reconciliation is the **hybrid pattern**: the
homegrown wrapper remains the public entry point and owns the
artifact contract (structured `audit-*-results.md` files, audit
orchestrator integration, exit codes, evidence-gate hooks); the
built-in supplies the analysis or fix loop as a delegated sub-step.
The wrapper validates the built-in's output against the original
findings before closing.

The ADR is written with name-neutral phrasing — "the framework" rather
than a brand name — so the Mandrel rebrand epic could supply the brand
name without rewriting this ADR text.

### Consequences

- **Adapter-layer stubs come down.** The pre-declared adapter slots in
  `.agents/scripts/lib/adapter-factory.js` for unimplemented runtimes
  are removed. The `IExecutionAdapter` header documentation is
  rewritten to state the two-surface stance and link back to this ADR.
  Adding a future adapter is in scope for that adapter's own epic, not
  a precondition the dispatcher must continually carry.
- **Built-in adoption is in-bounds.** Adopting Claude Code built-ins
  (`/simplify`, `/security-review`, `/loop`, `/fewer-permission-prompts`,
  `/insights`, etc.) inside the workflow surface does not violate the
  framework's coupling contract. Such adoption is encouraged where the
  built-in's contract matches the framework's artifact expectations or
  can be wrapped via the hybrid pattern. As of this writing only
  `/fewer-permission-prompts` is wired in (referenced by `/mandrel-update`
  Step 3.6); the others remain candidates. Note that `/goal` is a
  *prompt-side* directive the operator types — it is not reachable from
  the agent's tool surface and cannot be invoked from a workflow body.
- **The overlap matrix is mandatory.** Each overlapping responsibility
  between a Claude Code built-in and a homegrown surface element must
  be recorded in `docs/decisions.md` with: wrapper name, built-in
  name, exact sub-step delegation point, post-return validation, and
  rationale. Unrecorded overlaps are treated as drift and addressed in
  the next maintenance pass. The catalog of Claude Code commands
  itself is a maintained artifact (`docs/claude-code-catalog.md`) with
  a refresh cadence pinned to Claude Code minor version bumps.
- **Portability of the workflow surface is a non-goal.** Proposals to
  abstract the slash-command, hook, or skill surface away from Claude
  Code primitives are rejected by default. If a future runtime
  warrants a parallel workflow surface, that is a separate epic with
  its own ADR superseding this one.

---

## ADR 20260510-sdl-collapse: 5.40.0 — collapse to `/epic-plan` + `/epic-deliver`, fold retro into deliver tail (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-05-10
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Collapsed the SDLC command surface to `/epic-plan` + `/epic-deliver` and folded the retro into the deliver tail. The two-command shape survives as `/plan` + `/deliver`; the Epic-scoped commands themselves do not.

---

## ADR 20260508-flatten: Retire `/wave-execute`; `/epic-execute` owns the wave loop directly (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-05-08
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Retired `/wave-execute` and gave `/epic-execute` the wave loop directly, with flat host-owned Story fan-out. Waves, the Epic runner, and the fan-out layer were all removed by the v2 collapse; `/deliver` resolves a ready set instead. Supersedes ADR 20260507-1114a (wave-runner sub-agent type).

---

## ADR 20260507-1114a: Wave-runner is a custom sub-agent type, not `general-purpose` (superseded)

**Status:** Superseded by [ADR 20260508-flatten](#adr-20260508-flatten-retire-wave-execute-epic-execute-owns-the-wave-loop-directly-superseded)
**Date:** 2026-05-07
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Dispatched the wave runner as a custom `.claude/agents/wave-runner.md` sub-agent type rather than `general-purpose`. Superseded within a day by the flat fan-out of 20260508-flatten, and the wave surface is gone entirely. This entry is the sole holder of the `20260507-1114a` identifier; the freshness-gate ADR that once shared it is now `20260507-1114b`.

---

## ADR 20260507-1072a: Bounded fanout, tightened module boundaries, dead-module sweep

**Status:** Accepted
**Date:** 2026-05-07
**Surface:** `.agents/scripts/lib/branch-name-guard.js`
**Epic:** #1072

### Context

Audit work on the orchestration scripts surfaced three drift categories
that had accumulated quietly across Epics: (1) several hot loops over
GitHub mutations and the filesystem still used unbounded `Promise.all`,
risking rate-limit storms on large Epics and resource exhaustion on
recursive fs scans; (2) module boundaries had eroded — `lib/orchestration/index.js`
re-exported scripts and providers upward, the audit-suite had no clear
SDK home, and the GitHub HTTP client lived as a sibling of the structured
GitHub provider rather than under `providers/github/`; (3) two `lib/`
modules (`fs-utils.js`, `runtime-context.js`) had no remaining importers
but were still indexed by docs and baselines. The drift was not a single
incident — each item was a known small thing that had been deferred.

### Decision

Treat the cleanup as a single coherent Epic rather than fan-out across
maintenance work:

1. **Bounded concurrency is the default.** Every `Promise.all` over
   GitHub or fs work flows through `concurrentMap` with a story-specific
   cap (3 for mutation paths, 8 for sibling-read fan-outs, 64 for fs
   scans), with tests that assert `maxInFlight ≤ cap` rather than just
   correctness.
2. **Module boundaries are one-way.** `lib/orchestration/index.js` no
   longer re-exports providers or scripts; the audit-suite has its own
   `lib/audit-suite/` SDK exporting `runAuditSuite` / `selectAudits`;
   the HTTP client moved under `providers/github/http-client.js`. The
   barrel imports from these locations, never the other way.
3. **Dead code is deleted, not archived.** `fs-utils.js` and
   `runtime-context.js` are gone; their docs references migrate to the
   surviving three-context pattern in `lib/orchestration/context.js`.
   A canonical `lib/branch-name-guard.js` collapses two duplicate
   safety guards.

### Consequences

- New consumers see uniform `concurrentMap` usage at fan-out sites;
  raw `Promise.all` over network/fs work is now a code-review smell.
- The orchestration barrel becomes a true facade — touching it does
  not pull in the scripts CLI surface or providers, which keeps test
  doubles small.
- Operators have [`.agents/scripts/README.md`](../.agents/scripts/README.md)
  as the operator-scripts catalog. The file documents the optional
  scripts that are not wired into `package.json` / Husky / CI (see
  Story #3048); it is intentionally **not** an exhaustive index of the
  ~90 top-level entrypoints — for those, `package.json` scripts and
  `.agents/workflows/` remain the canonical surface.

## ADR 20260507-1030a: Performance-signal telemetry — events local, summaries on tickets

**Status:** Accepted
**Date:** 2026-05-07
**Surface:** `.agents/scripts/diagnose-friction.js`
**Epic:** #1030

### Context

Before Epic #1030 the framework had a single observability surface:
`diagnose-friction.js` posted one structured comment per friction event
directly onto the originating Task ticket. As the orchestrator grew —
hotspots, rework, churn, idle, retry, plus raw tool-call traces — that
fan-out hit two ceilings simultaneously. Tickets accumulated dozens of
machine-noise comments per Story, drowning the human review surface.
And every event paid a synchronous round-trip through the GitHub API,
forcing detectors to either rate-limit (losing signal) or batch in
process (losing tail records when sub-agents exit abruptly).

A separate gap sat next to that: detector thresholds were hard-coded in
each module. Operators tuning hotspot sensitivity for their own repo
had no override surface, and the framework had no canonical place to
declare default values that the `.agentrc.json` template could mirror.

### Decision

1. **Split events from summaries.** Detectors and the runtime trace hook
   write append-only NDJSON to local disk under
   `temp/epic-<eid>/story-<sid>/signals.ndjson` (and a sibling
   `traces.ndjson` for `kind: trace`). GitHub tickets receive **summary
   payloads only** — one
   `structured:story-perf-summary`
   comment per Story at close, one
   `structured:epic-perf-report`
   per Epic alongside the retro. The seven-kind taxonomy
   (`friction`, `hotspot`, `rework`, `churn`, `idle`, `retry`, `trace`)
   is the closed enum on
   [`signal-event.schema.json`](../.agents/schemas/signal-event.schema.json).
2. **Per-Epic temp tree, reaped with the worktree.** The on-disk layout
   `temp/epic-<eid>/story-<sid>/` lets the analyzer scan a single
   Story's stream cheaply and lets `WorktreeManager.reap` clean every
   in-flight artifact in one sweep when the Epic closes. Lazy directory
   creation on first write keeps zero-signal Stories from touching the
   disk at all.
3. **Best-effort, unbuffered writer.** `signals-writer.js` opens, writes
   one newline-terminated JSON line, and closes per call. fs / JSON
   failures are swallowed via `Logger.warn` so observability MUST NOT
   take down a wave. In-process buffering is forbidden by the Tech Spec
   because per-Story sub-agents may exit abruptly and a buffered tail
   would silently disappear on `process.exit`.
4. **Detector thresholds are operator-tunable.**
   `delivery.signals` is the single declarative surface;
   `SIGNALS_DEFAULTS` in `.agents/scripts/lib/config/limits.js` is the
   canonical default block (`hotspot.p95Multiplier=1.25`,
   `rework.editsPerFile=5`, `churn.repeatCount=4`,
   `idle.gapSeconds=120`, `retry.repeatCount=3`). The resolver
   shallow-merges per-detector overrides so an operator can re-tune a
   single key without re-listing the others, and `getSignals(config)` is
   the runtime accessor the detector layer imports.

### Consequences

- **Bounded ticket surface.** A Story carries at most one perf summary
  comment regardless of how many signals fired; an Epic carries one
  perf report. Reviewers see one consolidated table per closure boundary
  instead of an event log.
- **Detectors can fire freely.** Local NDJSON writes are bounded by
  disk I/O, not GitHub rate limits, so detectors no longer self-throttle.
  Raw tool-call traces become economically viable as a data source.
- **Reap is observability cleanup too.** Closing an Epic and reaping its
  worktrees deletes the corresponding NDJSON streams. There is no
  separate retention policy and no orphan-data risk.
- **Schema rejections become loud at the ticket boundary.** The closed
  `signal-event.schema.json` enum and the `additionalProperties: false`
  guards on the summary schemas mean a producer drift fails AJV at
  close time, not at consumer parse time.
- **Operator overrides survive template re-bootstraps.**
  `.agents/docs/agentrc-reference.json` mirrors `SIGNALS_DEFAULTS` exactly
  (the `tests/config/limits-template-drift.test.js` guard fails on any
  divergence), so an operator who copied the template wholesale and one
  who merged it on top of an existing block resolve to the same
  thresholds.
- **Documentation lock-in.** The Friction Telemetry section of
  `docs/architecture.md` is rewritten to the events-local /
  summaries-on-tickets model; `docs/data-dictionary.md` carries
  field-level rows for `signals.ndjson`, `story-perf-summary`, and
  `epic-perf-report`; this ADR is the canonical why.

---

## ADR 20260505-990a: Audit remediation — `.agents` framework hardening + concept removal

**Status:** Accepted
**Date:** 2026-05-05
**Surface:** `.agents/schemas/audit-rules.json`
**Epic:** #990

### Context

A targeted audit of `.agents/` produced 24 anti-pattern findings spanning
instructions, schemas, orchestration scripts, and templates. After triage,
20 were accepted and 4 were rejected as misapplied. Layered on top, the
operator added four cross-cutting cleanups: remove unused `model_tier`,
reject auto-spec, slim the heavyweight `.agents/README.md`, and strip
residual legacy code paths.

The framework had three classes of drift: half-implemented features the
contract still round-tripped (`model_tier` emitted everywhere, routed
nowhere); loose schema contracts (`additionalProperties: false` largely
absent, free-text discriminators, one schema file containing instance
data); and reference rot in the README (~790 lines mixing activation,
configuration, and engineering runbook content, most duplicated in
canonical docs).

Two real workflow bugs surfaced mid-Epic while dogfooding `/epic-execute`
against the remediation itself: `withEpicMergeLock` failing on the
worktree gitlink (`mkdir <worktree>/.git` throws because `.git` is a
file), and JSON format drift propagating across waves because
`.lintstagedrc` only globbed `**/*.js` and `*.md`. Both were fixed
inline so the Epic could complete.

### Decision

1. **Eliminate `model_tier` end-to-end.** Delete `model-resolver.js`,
   strip the field from the dispatch-manifest schema, every producer,
   the formatter, and the validator's `complexity::high|fast`
   enforcement (its only purpose was tier derivation). The orchestrator
   does not select models; the executing agent or external router does.
2. **Reject auto-spec.** Audit findings 8 and 10 proposed an
   `epic::auto-spec` autonomous-planning branch. The plan-then-confirm
   STOP gate is preserved unchanged.
3. **Slim `.agents/README.md`** to ≤ 150 lines: activation + a single
   "where to look" pointer table. Detailed reference content moves to
   `.agents/docs/configuration.md`, new `.agents/docs/quality-gates.md`, and the
   root `.agents/README.md` sections for distributed-submodule
   conventions. (Windows git-perf guidance was historically a fourth
   target; superseded by `.agents/scripts/check-windows-git-perf.js` in
   5.36.3.)
4. **Tighten schemas:** `additionalProperties: false` on
   `audit-results`, `friction-event`, and `agentrc` root; `if/then`
   conditional requirements on `healthRefresh.cadence`; closed enum on
   `validation-evidence.gateName`; drop the empty-string member from
   `dispatch-manifest.mode`. Mirror everything to the runtime AJV
   schemas.
5. **Rename `audit-rules.schema.json` → `audit-rules.json`** (it is
   instance data, not a schema) and add a real
   `audit-rules.manifest.schema.json` validating it.
6. **Preserve failure signals** in `context-hydration-engine.js` (catch
   handler emits `[failed to load #id: msg]` markers instead of empty
   strings) and `providers/github/issues.js` (`getSubTickets` warns
   when partial-load count diverges).
7. **Strip residual legacy behavior** with proven zero callers:
   `dispatcher.js --epic` flag, the DEBUG-gated CLI exit code, the
   `task/<archivedEpic>/<taskN>` branch shape, residual `Logger.fatal`
   calls inside `lib/`. Annotate surviving callers in 6 files.
8. **Self-heal mid-Epic workflow bugs.** Fix `withEpicMergeLock` to
   resolve the parent gitdir via `git rev-parse --git-common-dir`
   (lock is shared across worktrees by design). Add a
   `runFormatAutofix` step at the start of `story-close.js` that
   creates a `style:` fixup commit when `biome format --write`
   rewrites files. Extend `.lintstagedrc` to format
   `**/*.{json,jsonc,json5}`.

### Consequences

- **Manifest contract change.** `dispatch-manifest.json` no longer
  includes `model_tier` on either shape. Every internal consumer (tests,
  formatters, runners) was updated; no external contract was breaking.
- **Schema rejections become loud.** Payloads with extra keys, free-text
  `gateName` values, or empty `mode` strings now fail validation. This
  is the goal — the previous silent acceptance hid drift.
- **Story-close is self-healing on Windows worktrees.** The lock no
  longer crashes on the gitlink, and format drift carried in from
  upstream waves is committed automatically as a `style:` fixup. The
  `/epic-execute` loop runs hands-off when no real failure occurs.
- **README halved.** The slim version (≤ 150 lines) is the entry point;
  detail lives at stable canonical URLs that downstream consumers can
  bookmark.
- **Audit-rules tooling can validate the manifest.** Future audit
  additions are type-checked against the new manifest schema.

### Out of scope (rejected audit findings)

- **No `epic::auto-spec`** branch (findings 8, 10).
- **No softening of the "output ENTIRE file" rule** (finding 4) — the
  rule guards `Write` safety, not token economy.
- **No conditional / scoped `docsContextFiles` reads** (finding 3) —
  the small mandatory set is the contract.
- **No `console.warn` in `env-loader.js` silent-fail path**
  (finding 14) — `.env` is genuinely optional.
- **No `minItems: 1` cardinality on `listOrExtenderOfStrings`**
  (finding 17) — empty list is a legitimate "explicitly nothing"
  override.

The rationale for each rejection is recorded in
`temp/implementation-plan.md` so the next reviewer of the audit sees
why each was set aside.

---

## ADR 20260501-900a: Epic-centric workflow rework — four-skill split, single-session fan-out, retire GitHub triggers (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-05-01
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Reworked the framework around an Epic-centric four-skill split with single-session fan-out, and retired the GitHub-label remote trigger. The Epic tier, the skill split, and the fan-out session are all gone; the trigger retirement stands and was never revisited.

---

## ADR 20260427-868a: Open-root dispatch-manifest schema; AJV fixture drift test as enforcement boundary (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-27
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Gave the dispatch manifest an open-root JSON schema policed by an AJV fixture-drift test. The dispatcher and its manifest were removed with the v2 collapse; the fixture-drift enforcement pattern survives on the lifecycle-event schemas.

---

## ADR 20260426-829a: Strip-then-analyze for TypeScript scoring; keep typhonjs-escomplex

**Status:** Accepted
**Date:** 2026-04-26
**Surface:** `.agents/scripts/lib/transpile.js`
**Epic:** #829

### Context

The maintainability and CRAP gates only scored `.js` and `.mjs`. TS-first
consumer repos (e.g. athlete-portal) hit a degenerate state on
`mandrel` 5.28.1: 21 candidate files scanned, 0 rows written,
because every `.js`/`.mjs` candidate was build-time scaffolding (eslint
configs, `astro.config.mjs`) not exercised by tests. The actual product
surface — TypeScript — was invisible to both gates, so neither
maintainability nor CRAP could produce a useful baseline against the
code consumers care about. Cyclomatic-complexity gating on the real
source was impossible.

The kernel — `typhonjs-escomplex@0.1.0` — uses an Esprima parser that
rejects TypeScript type annotations and JSX outright.

### Decision

Pre-transpile TypeScript and TSX sources to plain JavaScript in memory
via `ts.transpileModule`, then feed the result to the existing escomplex
kernel. `JsxEmit.ReactJSX` is used so JSX expressions become function
calls escomplex can read; `JsxEmit.Preserve` would leave JSX in the
output and Esprima would choke.

Rationale for keeping escomplex rather than swapping kernels:

1. **Type annotations carry no control flow.** `if (x: string)` and
   `if (x)` produce identical cyclomatic and cognitive complexity.
   A TS file's score via strip-then-analyze equals what its
   `tsc --target esnext` JS output would score under escomplex —
   semantics-preserving for every metric the kernel emits.
2. **Existing JS-only consumers see no scoring drift.** The CRAP
   `kernelVersion` bump (1.0.0 → 1.1.0) and MI report kernel bump
   (1.0.0 → 1.1.0) are version-label changes only; the per-file and
   per-method scores for unchanged JS sources are byte-identical.
   A snapshot test in `tests/baselines-byte-identical-js-only.test.js`
   pins this contract.
3. **Replacing escomplex is a multi-week project.** A `ts-morph` +
   custom walker rewrite would invalidate every consumer's committed
   baseline, force a coordinated refresh across the install base, and
   bake in a new kernel that hasn't seen the years of edge-case
   hardening escomplex has. The strip-then-analyze approach piggybacks
   on a battle-tested kernel and ships in a single point release.

`tsTranspilerVersion` is added to the CRAP baseline envelope so
consumers can detect transpiler drift. Both `kernelVersion` and
`tsTranspilerVersion` mismatches **warn**, not fail — consumers
pin-and-bump and need runway to refresh deliberately rather than
discovering the version bump from a hard CI red. `escomplexVersion`
mismatch continues to fail closed: a different kernel can change
scoring semantics without warning, which is exactly the silent drift
the gate exists to catch.

### Alternatives considered

- **Replace `typhonjs-escomplex` with a TS-native walker (`ts-morph`).**
  Rejected. Multi-week effort, kernel risk, and a forced baseline
  refresh across all consumers with no compensating gain in scoring
  fidelity for the JS path.
- **Run a TS strip via custom regex / `@swc/core` / `esbuild`.**
  Rejected. Each adds a dep that's heavier than `typescript` (which
  most consumers already have as a dev-dep) and offers no upside over
  `ts.transpileModule` for this use case.
- **Use `tsc --noEmit` for a project-wide compile.** Rejected. Requires
  a resolvable `tsconfig.json` in the consumer; we deliberately don't
  trust consumer tsconfigs because they may reference paths the gate
  has no business resolving.

### Known limitations

`ts.transpileModule` does not preserve source line numbers verbatim.
JSX runtime imports add a leading line; interface elision shifts
subsequent code. Per-method coverage lookup against a vitest
`coverage-final.json` (which keys lines on the source) will see drifted
line numbers from escomplex (which sees the transpiled output). The
existing `compareCrap` line-drift fallback (same file + method, nearest
startLine wins) absorbs this for baseline comparison; per-method
coverage values may resolve to null on the first scan of a new TS
method, in which case the row is skipped from the baseline rather than
scored as zero. Sourcemap-based line remapping is a future enhancement
and out of scope for 5.29.0.

### Consequences

TS-first repos can adopt the gates without rewriting their build to
emit JS. Existing JS-only repos see a one-time warning on first
`crap:check` / `maintainability:check` after upgrading, directing them
to `npm run crap:update` / `npm run maintainability:update`. Their
score numbers don't change. The scoring kernel is unchanged, so future
ADRs about complexity ranges and tier thresholds remain valid.

## ADR 20260425-773a: CRAP gate becomes hard-enforcing

**Status:** Accepted
**Date:** 2026-04-25
**Surface:** `baselines/crap.json`
**Epic:** #773

### Context

The CRAP gate (Change Risk Anti-Patterns: `c² · (1 − cov)³ + c`) shipped in
the codebase but no canonical `baselines/crap.json` existed because no
automated coverage capture flowed into the gate. The gate self-skipped on
the missing baseline, producing false-clean reports across all three
firing sites (close-validation, pre-push, CI).

### Decision

Bootstrap `baselines/crap.json` from a real `npm run test:coverage` +
escomplex pass and ship it as the canonical baseline. Remove the
informational early-return from `check-crap.js` so a missing baseline
becomes a hard fail with a clear bootstrap-instruction message at all
three firing sites. Operators bootstrap explicitly via
`npm run crap:update` + a `baseline-refresh:` commit.

### Consequences

A regression now actually blocks merge instead of producing a false
"clean" report. The top-10 method hotspots above CRAP 50 were eliminated
in the same Epic; the long-tail of ten methods at CRAP 50–72 is tracked
as a follow-on story.

## ADR 20260425-773b: Decompose two further large modules behind byte-identical facades

**Status:** Accepted
**Date:** 2026-04-25
**Surface:** `.agents/scripts/lib/worktree/lifecycle-manager.js`
**Epic:** #773

### Context

`providers/github.js` and `lib/worktree/lifecycle-manager.js` were the
next two MI-ratchet outliers after the v5.13.0 facade pass. Both had
absorbed ~50% growth since the previous decomposition and were now the
single largest concentrations of provider-side and worktree-side code.

### Decision

Apply the **facade + responsibility-bounded submodules** pattern (already
documented in `docs/patterns.md`) to both. Each top-level file becomes a
≤250 LOC facade re-exporting submodules under `providers/github/*` and
`lib/worktree/lifecycle/*`. Submodules thread a shared `ctx` rather than
importing each other (ctx-threading discipline). Public class surface and
import paths stay byte-identical; only internals move.

### Consequences

Same pattern as v5.13.0, three more concrete applications. Future growth
in either area lands in a focused submodule rather than re-bloating the
facade. Tests pass unchanged because the public surface is preserved.

## ADR 20260425-730a: Consolidate `agentSettings` into a grouped, schema-validated contract

**Status:** Accepted
**Date:** 2026-04-25
**Surface:** `.agents/scripts/lib/config-settings-schema.js`
**Epic:** #730

### Context

`.agentrc.json` had accumulated a flat `agentSettings` namespace with ~25
peer keys spanning paths, commands, quality gates, limits, and friction
thresholds. The shape made three problems compounded over time:

1. **Discoverability.** A new operator could not tell which keys were
   required, which had defaults, or how related keys grouped — there was no
   typed surface for tooling and no canonical reference for humans.
2. **Validation gaps.** `agentSettings` was schema-permissive; typos in
   optional keys (e.g. `riskGates.heuristics`) silently disappeared during
   the previous template-diff sync, and the resolver's code-level fallbacks
   masked missing required values until a script blew up downstream.
3. **Baseline drift.** Three canonical ratchet baselines lived in three
   different locations under three different naming conventions, and the
   epic-runner's per-wave drift snapshots collided in repo-wide greps with
   the canonical files.

### Decision

Reorganise `agentSettings` into four typed sub-blocks
(`paths`, `commands`, `quality`, `limits`), unify the canonical ratchet
baselines under `/baselines/`, and drive the sync helper from the schema
instead of a structural diff against the template.

Concretely:

- **Grouped contract.** Every former flat key moves under one of the four
  sub-blocks. There are no flat-key reads anywhere in the resolver or in any
  consumer; each sub-block is read through a typed accessor (`getPaths`,
  `getCommands`, `getQuality`, `getLimits`).
- **Hard-required `paths`.** `paths.agentRoot`, `paths.docsRoot`, and
  `paths.tempRoot` are schema-required. The resolver no longer applies
  code-level `?? '.agents'` / `?? 'docs'` / `?? 'temp'` fallbacks; a missing
  value is a validation error with a clear `instancePath`.
- **`null` for disabled commands.** `commands.typecheck` and `commands.build`
  accept `string | null`; an empty string is rejected. `null` is the
  canonical "not applicable" value.
- **Conditional `github` block requirement.** The `github` block (with
  required `owner` and `repo`) is schema-required at the top level
  post-reshape; pre-reshape this was a conditional under the legacy
  `orchestration` umbrella, gated by a `provider` selector.
- **Static JSON Schema mirror.** Both shipped configs declare
  `"$schema": "./.agents/schemas/agentrc.schema.json"`. The runtime AJV
  schemas in `lib/config-schema.js` and `lib/config-settings-schema.js`
  remain authoritative; the static mirror exists for editor tooling and
  human readers, kept in sync by a drift test.
- **Schema-driven sync helper.** `mandrel-sync-config` now validates the
  project config against the schema, adds template-introduced keys, and
  preserves every project-side key that validates — including optional keys
  absent from the template (e.g. the legacy `concurrency`, `closeRetry`,
  `poolMode` blocks). Validation failures abort with a diagnostic instead of
  silently stripping unknown keys.
- **Canonical baselines under `/baselines/`.** `baselines/lint.json`,
  `baselines/crap.json`, and `baselines/maintainability.json` are the
  default-configured paths. The epic-runner's per-wave drift snapshots use
  intentionally distinct filenames (`wave-mi-snapshot.json`,
  `wave-crap-snapshot.json`) under `.agents/state/` so a repo-wide grep
  never confuses one with the other.
- **New configuration reference doc.** `.agents/docs/configuration.md` documents
  every configurable key, its default, whether it is required, and the
  baseline conventions. The `.agents/README.md` "Key Settings" table is
  the high-traffic subset; the doc is the canonical source.

### Consequences

- **Breaking for consumers carrying flat-shaped configs.** Migration is
  mechanical (every former flat key has a single grouped equivalent) and
  documented in the v5.26.0 changelog entry. Validation now fails closed,
  so operators learn about misconfiguration at startup instead of at the
  call site that needed the missing value.
- **Editor support comes for free.** Any editor with JSON Schema support
  picks up autocomplete and inline validation from the `$schema` pointer.
- **Future schema changes are cheaper.** Adding a new sub-block in the
  grouped shape is a localised change (one schema edit, one resolver
  accessor, one row in the reference doc); previously the same change
  threaded through multiple flat-key sites.
- **Sync helper trades silent strip for loud abort.** A typo in an optional
  key now aborts the sync with a diagnostic instead of vanishing on round-
  trip. Operators see misconfiguration; the rare false-positive abort is
  the right trade.

### Alternatives considered

- **Keep the flat shape, add a doc.** Rejected: documentation alone does
  not fix the validation gap or the silent-strip behaviour, and the
  resolver's flat-key fallbacks would still mask missing required values.
- **Split `.agentrc.json` into multiple files** (one per concern).
  Rejected: increases the surface operators must reason about and the sync
  helper must reconcile. A single file with a typed grouped shape captures
  the same separation without the file-count tax.
- **Keep `crap-baseline.json` and `maintainability-baseline.json` at repo
  root.** Rejected: collides in greps with the per-wave drift snapshots
  and offers no upside over the unified `/baselines/` directory.

---

## ADR 20260424-702a: Retire mandrel MCP

**Status:** Accepted
**Date:** 2026-04-24
**Surface:** `.agents/scripts/post-structured-comment.js`
**Materially dead (in part):** the core decision holds — the framework ships no
MCP server — but its "one entry point per capability" consequence does not.
The Surface file has **no production importer**: `code-review.js`,
`run-epilogue.js`, and `single-story-init.js` import `upsertStructuredComment`
from `lib/orchestration/ticketing.js` directly, and the CLI is named only in
two script-name allowlists and its own test. The check passes on a file
nothing calls.
**Epic:** #702

**Supersedes:** ADR-20260422-441b (*Canonical structured-comment writer is the MCP tool*),
which is retained below for historical context only — its conclusion no longer
applies now that the MCP server is gone.

### Context

Version 5.0 introduced the `mandrel` MCP server
(`.agents/scripts/mcp-orchestration script`) as a JSON-RPC 2.0 facade over the
orchestration SDK. The stated goal was letting an MCP-capable host (Claude
Desktop, Cursor) call `dispatch_wave`, `hydrate_context`,
`transition_ticket_state`, `cascade_completion`, `post_structured_comment`,
`select_audits`, and `run_audit_suite` natively instead of spawning shell
subprocesses.

By early 2026-04 two costs had compounded against that value:

- **Surface duplication.** Every orchestration capability already shipped as
  a Node CLI wrapper around the same SDK (`dispatcher.js`,
  `context-hydrator.js`, `update-ticket-state.js`,
  `post-structured-comment.js`, `audit-orchestrator.js`). The MCP server was
  a second entry point to the same code path — two schemas to keep in sync,
  two permission surfaces to validate, two places for a structured-comment
  marker to drift. Epic #380's retro-routing regression (a retro body was
  mis-posted through the webhook because the MCP tool's `type` enum missed
  `retro`) and Epic #441's marker-shape fixes (ADR-20260422-441b) were both
  direct consequences of that duplication.
- **Operator ergonomics.** `.mcp.json` became the canonical home for
  `NOTIFICATION_WEBHOOK_URL` (v5.8.0 consolidation), which meant operators
  had to provision one file for secrets that their IDE's MCP host would
  also read. Fresh checkouts needed the file before `/sprint-execute` would
  find a webhook. Worktrees had to bootstrap-copy it into every isolated
  tree. Every surface that resolved the webhook had to traverse two code
  paths. Epic #710 traced the test webhook leak behaviour back to this
  dual sourcing.

### Decision

Retire the `mandrel` MCP server and its companion artefacts:

- Delete `.agents/scripts/mcp-orchestration script` and everything under
  `.agents/scripts/lib/mcp/` and `.agents/scripts/mcp/`.
- Delete the dedicated MCP docs (`.agents/MCP.md`, `docs/mcp-setup.md`).
- Drop the `mandrel` block from `.agents/default-mcp.json` and stop
  shipping a template that advertises the server.
- Collapse webhook resolution to env-only: `NOTIFICATION_WEBHOOK_URL` is
  read from the process environment (loaded from `.env` locally, or set in
  the Claude Code web environment-variables UI). `.mcp.json` is no longer
  consulted.
- Keep the existing Node CLI wrappers under `.agents/scripts/` as the sole
  consumer interface to the orchestration SDK.

Third-party MCP servers an operator wants to wire into their IDE
(`@modelcontextprotocol/server-github`, `context7`, etc.) remain
unaffected — `.mcp.json` is still a valid file in that role, it just
doesn't carry a framework-shipped entry anymore.

### Where the capabilities live now

Unlike the backticked paths in an entry's body, this table is a migration list
an operator *acts on*, so it is kept current rather than frozen at its
2026-04-24 wording (original: `git show mandrel-v2.16.0:docs/decisions.md`).

| Retired MCP tool                               | Successor                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp__mandrel__dispatch_wave`          | No CLI. Multi-Story ordering is `node .agents/scripts/stories-wave-tick.js` over `lib/wave-runner/ready-set.js`, driven by `/deliver`; the `dispatcher.js` entry script and the dispatch manifest were deleted in v2. |
| `mcp__mandrel__hydrate_context`        | `node .agents/scripts/plan-context.js` for the `/plan` authoring envelope and `node .agents/scripts/resolve-stories.js` for the delivery envelope; the single `hydrate-context.js` CLI was deleted. |
| `mcp__mandrel__transition_ticket_state`| `node .agents/scripts/update-ticket-state.js --ticket <id> --state <state>` (auto-cascades on `agent::done`).                                |
| `mcp__mandrel__cascade_completion`     | Inlined into `update-ticket-state.js`; also runs at Story close inside `single-story-close.js`.                                              |
| `mcp__mandrel__post_structured_comment`| `node .agents/scripts/post-structured-comment.js --ticket <id> --marker <marker> --body-file <path>`; lib code imports `upsertStructuredComment` from `lib/orchestration/ticketing.js` directly. |
| `mcp__mandrel__select_audits`          | No CLI. `selectAudits()` from the `lib/audit-suite/index.js` SDK barrel; the `select-audits.js` entry script was deleted. |
| `mcp__mandrel__run_audit_suite`        | No CLI. `runAuditSuite()` from the same barrel; the `run-audit-suite.js` entry script was deleted. |

The SDK modules under `.agents/scripts/lib/orchestration/` (the things
these tools delegated into) are unchanged — the retirement is a surface
removal, not a logic change.

### Consequences

- **Positive:** One entry point per capability; one schema per argument
  shape; one place for a marker contract to live. Structured-comment
  `type` drift (ADR-20260422-441b) is no longer a possible failure mode
  because there is no parallel writer.
- **Positive:** `.mcp.json` is no longer load-bearing for framework
  orchestration; operators provision secrets in `.env` (local) or the
  Claude Code web env-var UI (web); `.mcp.json` is reserved for the
  MCP host's own discovery of third-party servers.
- **Positive:** Worktree bootstrap drops `.mcp.json` from its copy list;
  one fewer file to keep in sync across isolated trees.
- **Negative (breaking):** Operators who previously relied on the IDE
  invoking tools natively must now invoke the Node CLIs directly (or let
  the `/sprint-*` workflows invoke them, which they already did). The
  CLI mapping above is the migration list.
- **Negative (breaking):** Operators who kept `NOTIFICATION_WEBHOOK_URL`
  or `GITHUB_TOKEN` only in `.mcp.json` must move them to `.env` (local)
  or the Claude Code web env-var UI. The notifier resolver no longer
  reads `.mcp.json`.
- **Negative (fork-aware):** Consumer repos that pulled
  `.agents/default-mcp.json` into their own `.mcp.json` must remove the
  `mandrel` entry during their next submodule bump; leaving it
  in place resolves to a now-missing script path.

### Alternatives considered

- **Keep the MCP server, deduplicate the schemas.** Rejected: the
  duplication was *between* the MCP tool layer and the CLI wrappers, not
  within the tool layer. Consolidating one side still leaves two surfaces.
- **Delete the Node CLIs instead, keep MCP as the only surface.** Rejected:
  the CLIs are invoked directly by the `/sprint-*` workflows, by
  `remote-bootstrap.js` under GitHub Actions, and by consumer projects'
  own scripts. They are not optional; the MCP server was.
- **Keep the MCP server but move webhook resolution to env-only.**
  Rejected: solves the leak symptom without addressing the duplication
  cost. The Epic #710 audit concluded the surface itself was the
  liability, not the specific webhook lookup.

---

## ADR 20260424-668a: Resolve `worktreeIsolation.enabled` from environment, not config

**Status:** Accepted
**Date:** 2026-04-24
**Surface:** `.agents/scripts/lib/config/runtime.js`
**Epic:** #668

### Context

Two execution environments coexist for `/sprint-execute`: local Claude Code
sessions on a developer machine (one shared filesystem, multiple agents) and
web Claude Code sessions at claude.ai/code (each session is its own sandboxed
clone). The shared-filesystem coordination problem that `.worktrees/` solves
locally does not exist on web — the session itself is already an isolated
clone. A single committed `delivery.worktreeIsolation.enabled` value
cannot serve both: flipping it between local and web runs would pollute git
history and confuse other contributors.

### Decision

`delivery.worktreeIsolation.enabled` becomes a **resolved** value, not
just a read value. `resolveWorktreeEnabled(opts, env)` in
`lib/config-resolver.js` consults environment signals before falling back to
the committed config. Precedence:

1. `env.AP_WORKTREE_ENABLED === 'true'` → `true` (explicit operator override).
2. `env.AP_WORKTREE_ENABLED === 'false'` → `false` (explicit operator
   override).
3. `env.CLAUDE_CODE_REMOTE === 'true'` → `false` (web-session auto-detect).
4. Otherwise → committed `delivery.worktreeIsolation.enabled`.

The same resolver also publishes `runtime.sessionId`, preferring
`CLAUDE_CODE_REMOTE_SESSION_ID` when available (set automatically inside web
sessions) and falling back to a hostname+pid+random short-id. The committed
config is read-only at runtime; no workflow writes it.

### Consequences

- **Positive:** One committed config, two execution environments, no git-
  history thrash. Web sessions auto-disable worktrees; local sessions retain
  the v5.7.0 isolation behaviour. Operators can force either mode locally with
  one env var.
- **Positive:** `runtime.sessionId` is available as a stable per-process
  identity surfaced in the startup `[ENV] sessionId=…` log line for
  operator log-correlation, with no separate identity layer required.
  *(The original consumer of this id — the claim-protocol pool mode —
  was retired in story #909; the field is preserved for diagnostics
  only.)*
- **Negative:** The resolver consumes process environment, not config — typos
  in env var names fall through silently to the next rule. Mitigated by
  string-equality matching (`'true'` / `'false'` literal) so `"0"` / `""` /
  truthy-but-non-matching values cannot accidentally flip the flag.
- **Negative:** The worktree-off path is exercised less often than the
  worktree-on path on local machines. Mitigated by a diff test that runs the
  same fixture both ways and asserts the on-branch logs are byte-identical to
  a saved baseline.

### Alternatives considered

- **Two committed configs (`.agentrc.web.json` / `.agentrc.local.json`).**
  Rejected: would require runtime selection logic anyway and operators would
  still hand-edit one to ship.
- **Auto-detect via `git worktree list` size or filesystem inspection.**
  Rejected: indirect signal, unreliable in CI and exotic environments. The
  explicit `CLAUDE_CODE_REMOTE` marker Anthropic ships in web is the right
  contract.
- **Dedicated `/sprint-execute-web` slash command.** Rejected: forks the
  codepath. The Epic's hard requirement was operator parity — the same
  command, with the same contract, working in both environments.

---

## Earlier ADRs (001 / 002 / 003)

ADRs 001–003 (April 9–17, 2026) predate the Epic-#900 terminology rework
and are preserved in the project's Git history. ADR 004
(Gherkin Standards) remains active and is documented below.

## ADR 004: Gherkin Standards as Sole SSOT for BDD Tags & Forbidden Patterns

**Status:** Accepted
**Date:** 2026-04-19
**Surface:** `.agents/rules/gherkin-standards.md`
**Epic:** #269

### Context

Epic #269 introduces a BDD authoring framework: one rule
(`.agents/rules/gherkin-standards.md`), two skills
(`skills/stack/qa/gherkin-authoring`, `skills/stack/qa/playwright-bdd`), one
acceptance-execution workflow (the headless BDD runner, later retired in
Epic #3214 in favor of the agent-driven `/qa-run`), and a pyramid-aware
rewrite of `testing-standards.md`. Without a single source of truth for the tag taxonomy
and forbidden patterns, the two skills and every consuming project would
inevitably drift into parallel vocabularies — exactly the failure mode that
made Cucumber suites unmaintainable in earlier industry cycles.

### Decision

`.agents/rules/gherkin-standards.md` is the **sole** SSOT for:

- the canonical tag taxonomy (`@smoke`, `@risk-high`, `@platform-*`,
  `@domain-*`, `@flaky`);
- the forbidden-pattern list (SQL/ORM calls, status codes, DOM selectors, raw
  URLs, payloads, framework names, explicit waits);
- Scenario Outline conventions, selector discipline, and the step-reuse
  protocol.

Skills and workflows MUST reference the rule rather than restate it. Additions
to the taxonomy require a PR that updates the rule before use. The
`testing-standards.md` pyramid rule is the companion SSOT for tier-placement of
assertions; acceptance-tier scenarios defer shape-of-data concerns to contract
tests rather than encoding them in `.feature` files.

### Consequences

-   **Positive:**
    -   One place to look for the tag grammar; reviewers can mechanically
        reject unknown tags.
    -   `gherkin-authoring` and `playwright-bdd` stay focused on *how* and
        *when* without redefining *what*.
    -   The audit from Task #294 becomes a repeatable pattern — grep the
        skills for redefinition, point at the rule.
-   **Negative:**
    -   Rule-level changes are higher friction than editing a skill; adding a
        new domain tag requires a PR to the rule.
-   **Mitigation:**
    -   `@domain-<slug>` is extensible by design — consumers pick their own
        slug without touching the rule. Only the top-level tag *categories*
        are closed.

---

## ADR: Decompose oversized orchestration modules via facade pattern

**Status:** Accepted
**Date:** 2026-04-20
**Surface:** `.agents/scripts/lib/worktree-manager.js`
**Epic:** #297

### Context

Three orchestration-SDK modules grew past the point where a single file
usefully described a single responsibility: `lib/worktree-manager.js`
(1,234 LOC), `lib/orchestration/dispatch-engine.js` (874 LOC), and
`lib/presentation/manifest-renderer.js` (600 LOC). The 5.12.3 clean-code
audit flagged them as the top structural-complexity outliers in the
repository. The DRY portion of the audit had already been addressed via
new shared utilities (`lib/risk-gate.js`, `lib/label-constants.js`,
`lib/path-security.js`, `lib/error-formatting.js`,
`lib/issue-link-parser.js`). What remained was purely a structural
decomposition.

### Decision

Split each target file into cohesive submodules, then reduce the original
file to a **thin facade** that re-exports the same public symbols.

- `lib/worktree-manager.js` → 223-LOC facade composing `lib/worktree/`
  submodules (`lifecycle-manager`, `node-modules-strategy`,
  `bootstrapper`, `inspector`).
- `lib/orchestration/dispatch-engine.js` → 196-LOC coordinator composing
  `wave-dispatcher`, `risk-gate-handler`, `health-check-service`,
  `epic-lifecycle-detector`, `dispatch-pipeline`, and `dispatch-logger`.
- `lib/presentation/manifest-renderer.js` → 175-LOC facade composing
  `manifest-formatter` (pure) and `manifest-persistence` (fs I/O).

The facade files are the **only** part of the stable public surface;
submodule paths are internal implementation detail.

### Consequences

-   **Positive:**
    -   No caller needs to change — `dispatcher.js`,
        `mcp-orchestration script`, `sprint-story-{init,close}.js`, and every
        test file continue to import from the existing paths.
    -   Each submodule owns one responsibility and is individually
        unit-testable; 65 new per-submodule tests landed alongside the
        refactor (13 manifest + 35 worktree + 17 orchestration).
    -   Future behaviour changes touch the submodule that owns the
        concern, not a 1,000-LOC grab-bag.
-   **Negative:**
    -   The facade carries a handful of backwards-compat `_*` delegate
        methods on `WorktreeManager` so the existing 46-test
        `worktree-manager.test.js` keeps passing without edits. They are
        technical debt to be retired once those tests migrate to
        per-submodule imports.
    -   One new lazy-VerboseLogger implementation (`dispatch-logger.js`)
        duplicates the pattern used elsewhere in the codebase.
-   **Mitigation:**
    -   Retro action items track both the delegate retirement and the
        lazy-logger consolidation.
    -   Downstream consumers are explicitly told (in `architecture.md`
        and this ADR) that only the facade paths are stable — submodule
        paths may be renamed without a major version bump.

---

## ADR-20260421-321a: Epic-level remote orchestration via GitHub label trigger (superseded)

**Status:** Superseded by [ADR 20260501-900a](#adr-20260501-900a-epic-centric-workflow-rework--four-skill-split-single-session-fan-out-retire-github-triggers-superseded)
**Date:** 2026-04-21
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Triggered Epic-level orchestration from a GitHub label via `epic-orchestrator.yml` + `remote-bootstrap.js`. Retired by 900a, which removed GitHub triggers outright; delivery is operator-invoked only.

---

## ADR-20260421-321b: Retire `risk::high` runtime gating

-   **Status:** Accepted (Epic #321 Story #334, v5.14.0).
-   **Surface:** `.agents/instructions.md`
-   **Materially dead:** the outcome holds — no runtime `risk::high` gate
    exists — but every mechanism below is gone and the Surface is a doc file
    that cannot witness it either way. `risk-gate-handler.js`,
    `wave-dispatcher.js`, `story-close.js` are absent;
    `handleRiskHighGate` / `handleHighRiskGate` occur nowhere but here; and
    `hitl.riskHighApproval` / `hitl.riskHighRuntimeGate` are not config keys —
    the escape hatch this ADR preserved went with the in-process stratum.
    Read the Decision as a 2026-04 record, not as live wiring.
-   **Context:** `risk-gate-handler.js` halted the dispatcher on
    `risk::high` tasks, and `story-close.js` halted close for
    `risk::high` stories. In the new HITL-minimal model this becomes
    two per-ticket gates the orchestrator must pause on — incompatible
    with unattended remote runs.
-   **Decision:** The runtime halt is removed. `handleRiskHighGate`
    reduces to a log-only warning; `wave-dispatcher.js` dispatches
    `risk::high` tasks unconditionally; `story-close.js` gates
    only when both `hitl.riskHighApproval` **and**
    `hitl.riskHighRuntimeGate` are explicitly `true` (both default
    `false`). The label is preserved — retros and planning can still
    query it as metadata.
-   **Alternatives considered:** rename the label to
    `metadata::risk-high` to make its informational nature legible —
    deferred to Epic #349 as it is a breaking taxonomy change.
-   **Consequences:**
    -   Destructive-action containment moves from runtime approval to
        (a) GitHub branch protection on `main`, (b) executor sub-agent
        `agent::blocked` escalation when an unauthorized destructive
        action is detected, (c) `epic::auto-close` as a deliberate
        opt-in that must be set at dispatch.
    -   `handleHighRiskGate` in `story-close.js` becomes dead
        code behind a hidden opt-in flag — cleanup tracked in Epic
        #349 Wave 0.

---

## ADR-20260422-380a: Two-stage Windows worktree reap (fs.rm retry + deferred sweep)

-   **Status:** Accepted (Epic #380 Story #386, v5.15.1).
-   **Surface:** `.agents/scripts/lib/worktree/lifecycle-manager.js`
-   **Context:** The v5.7.0 worktree-per-story model ships a clean
    `reap` path for POSIX, but on Windows `git worktree remove` + the
    follow-up `fs.rm` routinely fail with `EBUSY` / `ENOTEMPTY` because
    antivirus, indexing, and `node_modules` file handles hold the
    directory open for seconds after the merge completes. The v5.15.0
    symptom was `branchDeleted: false` from `/sprint-story-close` plus
    orphan `.worktrees/story-<id>/` residue that broke the next
    `npm run lint` (nested `biome.json` in the orphan was picked up).
-   **Decision:** Reap is now a two-stage operation inside
    `lifecycle-manager.js`:

    1. Primary path retries `fs.rm(..., { recursive: true, force: true,
       maxRetries, retryDelay })` on `EBUSY` / `ENOTEMPTY`.
    2. Anything still pinned after retry is queued into
       `.worktrees/.pending-cleanup.json` and drained on the next
       worktree-manager run by `worktree-sweep.js`.

-   **Explicitly rejected approaches:**
    -   **Shelling out to `rm -rf` / `cmd /c rd /s /q`** — makes the
        deletion opaque to Node, silently succeeds while antivirus is
        still scanning, and would require per-platform branching. The
        `fs.rm` retry path surfaces real errors and is test-drivable
        with an injected adapter.
    -   **Switching the default `node_modules` strategy to `symlink` or
        `pnpm-store`** to shrink the reap surface — rejected; the
        `per-worktree` strategy is the only one that is correct on every
        platform and CI image, and the original Epic #229 ADR
        (ADR 003) documents why. The Windows reap problem is worth
        fixing on its own terms without touching the install model.
    -   **Global mutex around reap** — rejected for the same reason the
        fetch path refused one: it would erase the parallelism the
        worktree model is designed to enable.
-   **Consequences:**
    -   `/sprint-story-close` reports `branchDeleted: true` on Windows
        across the common antivirus failure modes; the remaining tail
        is handled asynchronously by the sweep.
    -   New artefact: `.worktrees/.pending-cleanup.json` (see
        `docs/data-dictionary.md#8-epic-380-artefacts-v5151`).
    -   Orphan-worktree biome lint block (documented in operator
        auto-memory) disappears once the sweep drains a queued entry.

---

## ADR-20260422-380b: `/sprint-retro` routes through provider.postComment, not notify.js (superseded)

**Status:** Superseded by [ADR 20260510-sdl-collapse](#adr-20260510-sdl-collapse-5400--collapse-to-epic-plan--epic-deliver-fold-retro-into-deliver-tail-superseded)
**Date:** 2026-04-22
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Routed `/sprint-retro` through `provider.postComment` instead of `notify.js`. The retro command was folded into the deliver tail and then removed; `notify.js` survives as the operator-notification surface only.

---

## ADR-20260422-413a: Pre-wave spawn smoke-test + post-wave commit assertion (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-22
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Guarded wave dispatch with a pre-wave spawn smoke-test and a post-wave commit assertion, so a silent fan-out failure could not read as success. Waves are gone; the equivalent guard is the close pipeline’s wrong-tree guard plus the terminal envelope’s explicit gate verdicts.

---

## ADR-20260422-413b: `sprint-story-close` recovery via explicit --resume / --restart (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-22
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Made `sprint-story-close` recovery explicit via `--resume` / `--restart` rather than inferred. The script is gone; recovery is now a read-only probe (`deliver-recover.js`) that prints one next command.

---

## ADR-20260422-441a: Force-reap worktrees whose Story branch is already merged

-   **Status:** Accepted (Epic #441 Story #451, v5.15.3) — rule stands; the
    `/sprint-close` Phase 4 mechanics below are superseded. The
    force-reap-when-already-merged rule now lives in the protected boot sweep
    (`boot-sweep.js`), which reaps a local branch only when its PR is MERGED
    and HEAD matches the merged `headRefOid`; content-merged branches are
    report-only.
-   **Surface:** `.agents/scripts/boot-sweep.js`
-   **Context:** Epic #413's `/sprint-close` Phase 4 reaper left 3 of 6
    worktrees orphaned (`story-420`, `story-423`, `story-424`) with
    `reap-skipped: uncommitted-changes`, even though every Story branch
    had already merged into `epic/413`. The "uncommitted" content was
    biome-format drift and already-merged agent edits — safe to
    discard, but the reaper's conservative default preserved them and
    required manual `rmdir` + `git worktree prune` + `git branch -D`.
-   **Decision:** When `git merge-base --is-ancestor` confirms the
    Story branch is already part of `epic/<id>`, Phase 4 force-reaps
    the worktree by default (`git worktree remove --force` + prune +
    `branch -D`). The destructive step is bounded to "already-merged"
    state, so the only content at risk is post-merge drift. A
    `--no-reap-discard-after-merge` flag restores the prior
    conservative behavior. Force-reap emits a `friction` structured
    comment naming the Story and listing the discarded paths so the
    signal isn't lost.
-   **Alternatives considered:**
    -   Move the assertion check before the reaper (so the reap runs
        against the still-unmerged branch) — rejected; it conflates
        merge state with reap state and does not solve the "Windows
        worktree is EBUSY because a process holds a file handle" case.
    -   Require every close to commit format drift onto the Story
        branch before merging — rejected; increases pre-merge noise
        without changing the post-merge "discard is safe" property.
-   **Consequences:**
    -   The manual reap recipe becomes obsolete for the `already-merged`
        case; truly-in-progress worktrees are now the exclusive domain
        of the `--no-` override.
    -   Operators who intentionally leave work-in-progress in a
        worktree after close must pass the override explicitly.

## ADR-20260422-441b: Canonical structured-comment writer is the MCP tool (superseded)

**Status:** Superseded by [ADR 20260424-702a](#adr-20260424-702a-retire-mandrel-mcp)
**Date:** 2026-04-22
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Named the mandrel MCP tool the canonical structured-comment writer. The MCP server was retired two days later; `post-structured-comment.js` is the canonical writer.

---

## ADR-20260423: Trust the ticket, not the pipe — idle-timeout ground truth (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-23
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Treated the ticket, not the sub-agent stdout pipe, as ground truth for idle-timeout decisions during Epic fan-out. There is no dispatch pipe and no idle timeout in v2; the ticket-is-ground-truth principle survives in the label-driven state model.

---

## ADR-20260423-511a: Features remain in the cascade; Epics and Planning do not (superseded)

**Status:** Superseded by [ADR 20260611-two-tier-hierarchy](#adr-20260611-two-tier-hierarchy-remove-the-feature-tier-epic--story-superseded)
**Date:** 2026-04-23
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Kept Feature tickets inside the completion cascade while excluding Epics and planning tickets. The Feature tier was deleted, taking the cascade rule with it.

---

## ADR-20260423-511b: `transitionTicketState.fromState` lookup keeps its swallow, now with a debug log

-   **Status:** Accepted
-   **Date:** 2026-04-23
-   **Surface:** `.agents/scripts/providers/github/tickets.js`
-   **Epic:** #511
-   **Context:** `transitionTicketState()` wraps the prior-state label
    lookup in a silent try/catch — any error leaves `fromState` as `null`
    and downstream notifier payloads ship `{ fromState: null, toState: … }`.
    The review under Epic #511 asked: deliberate or accidental?
-   **Decision:** Deliberate — keep swallowing. A transient network flake
    reading the prior label must not block a legitimate state transition;
    the transition itself is the authoritative event. Add a `debug`-level
    log so the operator can correlate a null `fromState` with the
    underlying error, and document `null` as a valid value in the notifier
    payload contract.
-   **Consequences:**
    -   Transitions remain resilient to read flakes.
    -   Consumers that branch on `fromState` must handle `null`
        explicitly (existing contract now documented).
    -   Silent failures are observable at `debug` log level.

---

## ADR-20260423-511c: Dispatch-manifest writes are atomic (tmp + rename) (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-23
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Made dispatch-manifest writes atomic (write-tmp + rename) so a crashed dispatcher could not leave a half-written manifest. The manifest is gone; the atomic-write discipline survives in the baseline and ledger writers.

---

## ADR-20260424-553a: Bounded-concurrency + TTL cache for epic-runner fanout (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-24
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Bounded the Epic-runner fan-out with a concurrency cap and a TTL cache over provider reads. The Epic runner is gone; the primitive survives as `lib/util/concurrent-map.js`, now consumed by `resolve-stories.js` and the provider clients.

---

## ADR-20260424-553b: Per-phase timing as a first-class epic-runner surface (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-24
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Made per-phase timing a first-class Epic-runner surface, posting a `phase-timings` structured comment on Story close. The Epic runner is gone and no producer posts that comment any more; `lib/util/phase-timer.js` survives as an internal span recorder for the close-validation runner.

---

## ADR-20260424-596a: CRAP as a sibling gate, not a replacement for MI

-   **Status:** Accepted
-   **Date:** 2026-04-24
-   **Surface:** `baselines/maintainability.json`
-   **Epic:** #596
-   **Context:** The maintainability (MI) gate ratchets a per-file composite
    score, but is coverage-blind: a 30-branch function scores identically
    whether it has 0% or 100% test coverage. MI tells operators *what to
    refactor*; it does not tell them *what to test next*. Per-method
    cyclomatic complexity (from `typhonjs-escomplex`) and per-method coverage
    (from the `c8` artifact) were already present in CI but unused for risk
    signalling. Folding the new model into the MI baseline envelope would
    have churned every existing consumer baseline and conflated two distinct
    questions (file-level refactor priority vs. method-level test priority)
    onto one ratchet.
-   **Decision:** Ship CRAP as a **sibling pipeline** with its own baseline
    artefact (`crap-baseline.json`), CLIs (`check-crap`, `update-crap-
    baseline`), and config block (`delivery.quality.gates.crap`).
    Wire it at the same three sites as MI (close-validation, ci.yml, pre-
    push) but enforce a **hybrid** model: tracked methods ratchet with line-
    drift fallback; new methods must score ≤ `newMethodCeiling` (default 30,
    the canonical CRAP threshold). Removed methods are surfaced as a counter,
    never a failure. Both gates share an envelope shape
    (`{ kernelVersion, summary, violations }`) so agent workflows can consume
    both with one parser.
-   **Consequences:**
    -   Existing `maintainability-baseline.json` stays valid — no consumer
        repo gets a free baseline reshuffle on adoption.
    -   The two questions separate cleanly: MI = "where is the rot?", CRAP
        = "where is the untested complexity?".
    -   A future Epic can refactor both gates onto a shared envelope/helper
        base if/when symmetry pays off; today's parity is shape-level only.

## ADR-20260424-596b: Base-branch-enforced anti-gaming guardrail (reverted)

**Status:** Reverted (2026-05-12) — see the CHANGELOG 5.42 entry
**Date:** 2026-04-24
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Read quality-gate thresholds from the base branch rather than the PR branch, so a PR could not relax its own ceiling. Reverted with the bot-approver pipeline: `baseline-refresh-guardrail.yml` and its CLI were removed and the `baseline-refresh:` commit-tag convention is now an operator standard, not a machine-enforced one.

---

## ADR-20260424-596c: Kernel-version stamp on the CRAP baseline

-   **Status:** Accepted
-   **Date:** 2026-04-24
-   **Surface:** `baselines/crap.json`
-   **Epic:** #596
-   **Context:** `typhonjs-escomplex` makes scoring decisions that change
    between minor versions. Without a version stamp, an upstream dependency
    bump silently rescores every method, producing a ghost baseline that
    looks healthy but compares against numbers no one ran. Worse, an
    "everything passes" run after a bump masks real regressions in the
    delta. Consumer repos pulling the framework as a submodule absorb the
    bump without warning.
-   **Decision:** Stamp `crap-baseline.json` with two version fields:
    `kernelVersion` (the inline CRAP formula's contract) and
    `escomplexVersion` (the dep). On any mismatch with the running scorer,
    `check-crap` exits 1 with `[CRAP] scorer changed from X to Y — run 'npm
    run crap:update'`. The bootstrap path (no baseline at all) still exits 0
    with a different message — first-run on a consumer repo must never hard-
    fail.
-   **Consequences:**
    -   Dependency bumps surface explicitly with a clear remediation, not
        as a quiet rescore.
    -   Bootstrap and version-mismatch are distinct exit codes (0 vs 1)
        and distinct messages — operators do not have to diff stdout to
        tell a fresh repo from a dependency drift.
    -   The `kernelVersion` field gives us a future-proof seam for
        in-formula changes (e.g., switching from `(1−cov)³` to `(1−cov)²`)
        without a destructive force-rescore on every consumer.

---

## ADR-20260424-638a: `story-566` reap recovery is a self-inflicted dirty-tree bug

-   **Status:** Accepted
-   **Date:** 2026-04-24
-   **Surface:** `.agents/scripts/lib/worktree/bootstrapper.js`
-   **Epic:** #638 (Story #648)
-   **Context:** Epic #553 close fired the `worktree.reap recovered via
    fs-rm-retry … attempts=1 lockReason=contains modified or untracked
    files` warning on `story-566`. The log is shaped for Windows-lock
    recovery, but `attempts=1` and the stderr quoted `git worktree
    remove`'s *own* uncommitted-files guard — not a lock class error.
    Classification required tracing the full reap path on a framework
    checkout (where `.agents/` is a tracked directory, not a submodule).
-   **Root cause:** `removeCopiedAgents()` in
    `.agents/scripts/lib/worktree/bootstrapper.js` unconditionally
    `fs.rmSync`'s `<wtPath>/.agents` before `git worktree remove` runs.
    The three follow-up index operations self-guard on
    `isAgentsSubmodule(repoRoot)` and no-op in framework repos, but the
    physical delete does not. In the framework repo the deletion wipes a
    tracked directory, producing a deliberate dirty state that `git
    worktree remove`'s pre-check flags with "contains modified or
    untracked files, use --force to delete it". The belt-and-braces
    `fs.rm` then removes the whole worktree, so the reap ultimately
    succeeds — but the warn log misattributes the cause to a Windows
    lock, and every framework-repo story close pays the retry cycle.
-   **Why the existing coverage missed it:**
    `tests/lib/worktree-manager.test.js` line 1419 — *"skips index
    scrub in non-submodule (framework) repos"* — creates `wtPath` but
    never materialises `wtPath/.agents`, so `fs.lstatSync` throws and
    the `fs.rmSync` branch is never exercised. Real framework worktrees
    always have a checked-out `.agents/` directory.
-   **Decision:** Classify as a **recoverable bug (outcome b)**. Guard
    the `fs.rmSync`/`fs.unlinkSync` in `removeCopiedAgents` with
    `isAgentsSubmodule(repoRoot)`, matching the self-guard already
    present on the three index-scrub follow-ups. Keep the
    `removeWorktreeWithRecovery` fs-rm fallback in place as
    belt-and-braces for genuine Windows locks. Add a regression test
    asserting that a materialised `.agents/` survives
    `removeCopiedAgents` in a non-submodule repo.
-   **Consequences:**
    -   Framework-repo story closes stop paying the retry cycle and
        stop emitting misleading `fs-rm-retry` warnings on every close.
    -   `git worktree remove` now succeeds on its first attempt in the
        common framework path; Stage 1 recovery resumes being a
        real-failure signal instead of a self-inflicted one.
    -   Submodule-consumer repos are unaffected: `isAgentsSubmodule`
        returns true, the physical delete still runs, and the index
        scrub + modules purge continue as before.
    -   The retained fs-rm fallback still covers the true Windows-lock
        case it was designed for.

## ADR-20260426-817a: Validation evidence is keyed by commit SHA, not by build ID

-   **Status:** Accepted (Epic #817, v5.28.0).
-   **Surface:** `.agents/scripts/evidence-gate.js`
-   **Context:** Epic #817's hot-path audit found lint and tests running
    five-plus times per Story against the same tree (sprint-execute Step 2,
    story-close, sprint-code-review, sprint-close Phase 4, pre-push, CI).
    The dominant local cost was repeat work, not new work, and the
    duplicate runs were the largest source of agents chasing the same
    failure across phases. We needed a skip mechanism that did not let a
    stale pass paper over a fresh regression.
-   **Decision:** Each successful gate (lint, test, biome format, MI, CRAP)
    writes `{ gateName, commitSha, commandConfigHash, timestamp, exitCode }`
    under the per-Epic tree at
    `temp/epic-<epicId>/validation-evidence.json` (Epic-scoped) or
    `temp/epic-<epicId>/story-<storyId>/validation-evidence.json`
    (Story-scoped). Callers thread both the scope id and the owning Epic
    id through `evidence-gate.js`. A subsequent caller skips
    the gate **only** when the current `git rev-parse HEAD` matches the
    recorded `commitSha` AND the resolved command-config hash matches.
    Anything else — dirty tree, new commit, config change, missing
    evidence file — runs the gate. `--no-evidence` is the explicit override
    for iterating on a flaky test.
-   **Consequences:**
    -   Repeat phases against an unchanged tree skip in milliseconds.
    -   False-green risk stays bounded: any working-tree change at the
        commit-SHA granularity invalidates the evidence; config drift
        invalidates it via the command-config hash.
    -   Evidence is `temp/`-local and gitignored, so the skip is per-clone
        — CI gets its own evidence record (or none), and pre-push hooks
        retain authoritative independence.

## ADR-20260426-817b: `sprint-story-close` is the canonical local Story validation gate (superseded)

**Status:** Superseded by [ADR 20260726-v2-story-collapse](#adr-20260726-v2-story-collapse-story-only-ticket-model-one-plan-one-deliver-one-engine)
**Date:** 2026-04-26
**Full text:** `git show mandrel-v2.16.0:docs/decisions.md`

Named `sprint-story-close` the single canonical local Story validation gate, so no other surface could claim to have validated a Story. The rule stands verbatim with `single-story-close.js` as the named gate.

---

## ADR-20260426-817c: Soft-failing gates surface degraded state explicitly, not silently

-   **Status:** Accepted (Epic #817, v5.28.0).
-   **Surface:** `.agents/scripts/lib/degraded-mode.js`
-   **Context:** `select-audits.js` (diff timeout fallback to keyword-only),
    `lint-baseline.js` (zero-error fallback on JSON parse failure), and
    `baseline-refresh-guardrail.js` (empty-changed-files on `git diff`
    failure) all returned permissive zero-error envelopes when their
    inputs failed. The audit found this fail-open behaviour produced
    silent green runs that read identically to genuine clean runs.
    Story #5004 retired `lint-baseline.js`; the ADR's Surface now names
    the shared helper that builds the envelope, which is where the
    contract actually lives.
-   **Decision:** Each soft-failing gate either fails closed under
    `--gate-mode` (or `MANDREL_GATE_MODE=1`) — non-zero exit, no
    permissive output — or returns a structured `{ ok: false, degraded:
    true, reason, detail }` envelope on stdout with a non-zero exit code.
    The caller decides how to interpret. The mute fail-open path is gone.
-   **Consequences:**
    -   Operators can no longer mistake a degraded run for a clean one.
    -   CI / pre-push integrations that previously absorbed the silent
        green now see explicit degraded output and may need a one-line
        adjustment to their handling.
    -   The structured envelope shape is consistent across all three
        gates so a single helper detects degradation.

## ADR-20260426-817d: CLI entrypoints carry `node:coverage ignore file`; their `main()` is exercised via integration tests, not unit-line coverage

-   **Status:** Accepted (Epic #817 follow-on, v5.28.1).
-   **Surface:** `.agents/scripts/notify.js`
-   **Context:** Story #816's long-tail CRAP cleanup attempted to score
    `run-audit-suite.js::main`, only to find the file was silently dropped
    from the CRAP scan because its first comment line is
    `/* node:coverage ignore file */`. Twenty-one other CLI entrypoints
    under `.agents/scripts/*.js` carry the same directive, including
    `epic-runner.js`, `story-close.js`, `story-init.js`,
    `epic-planner.js`, `dispatcher.js`, `epic-plan-spec.js`,
    `epic-plan-decompose.js`, `notify.js`, `health-monitor.js`,
    `post-structured-comment.js`, `pool-claim.js`, `remote-bootstrap.js`,
    `select-audits.js`, `ticket-decomposer.js`, `agents-bootstrap-github.js`,
    `assert-branch.js`, `context-hydrator.js`, `diagnose-friction.js`,
    `hydrate-context.js`, `epic-plan.js`, and `epic-plan-healthcheck.js`.
    The convention pre-dates this Epic but had never been written down,
    making it ambiguous whether the directive on a given file was a
    deliberate convention or an accidental escape hatch.
-   **Decision:** The `node:coverage ignore file` directive is the
    canonical convention for **CLI entrypoint scripts** under
    `.agents/scripts/`. An entrypoint's `main()` orchestrates pure helpers
    that are themselves unit-tested; the orchestrator is exercised
    end-to-end via the framework's integration suite (story-init/close
    happy paths, dispatcher fan-out, manifest generation, friction
    posting) and via the `tests/*-cli.test.js` suites that drive each CLI
    via `runAsCli` with stubbed I/O. We do not chase per-line coverage on
    `main()` itself because (a) its branches are flag-parsing and exit
    code routing whose value at the line level is dwarfed by the helper
    behaviour the integration tests already cover, and (b) running the
    CLI under coverage costs wall-clock time the helper-level tests buy
    cheaper.
-   **Scope of the convention:**
    -   The directive applies to **CLI entrypoints only** — files at the
        top of `.agents/scripts/` that ship a `runAsCli(import.meta.url,
        main, ...)` invocation or are the documented `node ...` target
        of a workflow phase.
    -   It does **not** apply to library files under
        `.agents/scripts/lib/`. Library code remains fully covered.
    -   It does **not** waive the obligation to ratchet helpers exercised
        by the entrypoint. The "extract pure helpers + add tests" pattern
        from Story #792 / #816 still applies — pull complex branching
        out of `main()` into testable helpers in either the same file
        (`export function ...`) or a sibling module under `lib/`.
-   **Consequences:**
    -   The CRAP gate's silent drop of these 22 files is intentional and
        documented; future audits can stop flagging it as a gap.
    -   New CLI entrypoints follow the same convention. If a new
        entrypoint does **not** carry the directive, that is a deliberate
        choice — typically because the file is small enough to remain
        fully testable as a single unit — and should be called out in
        the PR description.
    -   The convention is reviewed if a regression slips past the helper
        tests but would have been caught by main-level coverage. None
        observed to date.

## ADR-20260502-960a: Production code is not shaped by test internals — tests import helpers directly with an explicit `ctx` bag

-   **Status:** Accepted (Epic #946, Stories C1+C2 → #960).
-   **Surface:** `.agents/scripts/lib/worktree/bootstrapper.js`
-   **Context:** `WorktreeManager` historically grew a "Backwards-compat
    delegates for tests that probe private helpers" block — five
    `_`-prefixed methods (`_copyBootstrapFiles`, `_provisionWorkspace`,
    `_copyAgentsFromRoot`, `_removeCopiedAgents`, `_isAgentsSubmodule`)
    that existed solely so the pre-split `tests/lib/worktree-manager.test.js`
    suite could keep calling instance methods after the implementation
    was decomposed into `lib/worktree/bootstrapper.js` and
    `lib/workspace-provisioner.js`. The delegates added no behaviour;
    they were a compatibility shim for the test file. Production
    callers (the lifecycle layer) had already migrated to the helper
    modules and passed an explicit `ctx` bag, so the delegates were
    dead weight on the production code path while the test file
    continued to pretend the manager owned the logic.
-   **Decision:** Production modules do not carry test-shaped surfaces.
    When a class's internal helpers are extracted into pure functions
    that take a `ctx` bag, the corresponding tests **migrate to the
    helper module directly** rather than the class re-exposing the
    helper as a private method. The migration pattern is "test imports
    the helper directly, constructs a `ctx` bag with the fields the
    helper documents, and asserts on the helper's return value or its
    side-effects." The class loses the underscore-prefixed delegate.
    Stories C1+C2 of Epic #946 codified this for the worktree split:
    `tests/lib/worktree-manager.test.js` now calls
    `provision({ sourceRoot, targetWorktree, files, logger })` from
    `workspace-provisioner.js` and
    `copyAgentsFromRoot(ctx, wtPath)` /
    `removeCopiedAgents(ctx, wtPath)` /
    `isAgentsSubmodule(repoRoot)` from `worktree/bootstrapper.js`
    instead of the deleted `wm._*` delegates.
-   **Consequences:**
    -   `WorktreeManager` shrinks: the ~70-line backwards-compat block
        in `lib/worktree-manager.js` is gone, leaving only the public
        lifecycle facade (`ensure`, `reap`, `gc`, `prune`, `list`,
        `pathFor`, `isSafeToRemove`, `sweepStaleLocks`).
    -   Tests for the bootstrap / submodule logic become independent of
        the class's wiring — they exercise the helper contract
        verbatim, so a future split or rename of `WorktreeManager` does
        not invalidate the suite.
    -   New code follows the same rule: a helper extracted "for
        testability" is tested at the helper boundary, not via a
        manager-level passthrough. Reviewers reject `_`-prefixed
        delegates whose only call site is a test file.
    -   The ctx bag fields each helper expects are documented in the
        helper's JSDoc; tests construct bags inline rather than
        reaching through a partially-constructed class instance to
        mutate them (the old `wm._isAgentsSubmodule = () => true`
        pattern is replaced by `ctx.isAgentsSubmodule: () => true`).

## ADR 20260507-1114b: Freshness gate on decompose — fail fast on stale path references

**Status:** Accepted
**Date:** 2026-05-07
**Surface:** `.agents/scripts/lib/orchestration/ticket-validator.js`
**Epic:** #1114
**Identifier note (Story #4786):** this entry was filed as `20260507-1114a`,
colliding with the wave-runner ADR of the same date and Epic. The wave-runner
entry keeps `-1114a` (it is the one cited by name elsewhere in this file); this
one is renumbered `-1114b`. No reference outside `docs/decisions.md` cited
either identifier.

### Context

Epic #1072 surfaced a class of decomposer hallucination that the existing
cross-validation pass could not catch: the planner LLM referenced a code
asset (`aggregate-phase-timings.js`) that had been deleted in a prior Epic
but was still cited by an upstream PRD/Tech Spec excerpt. The resulting
Task #1109 was created on GitHub, dispatched to a Story sub-agent, and
only failed at implementation time when the agent could not find the
file. By then the Story was already executing, the worktree was checked
out, and the planner's mistake had to be unwound by hand
(`state_reason: not_planned` close + Story body edit).

The closing Epic for that cleanup (#1072) deferred the gate itself — the
deleted file was patched over but the structural cause was left open.
Story #1125 of Epic #1114 codifies the gate as a freshness check on the
Task body and AC, run inside `validateAndNormalizeTickets` before any
GitHub creation happens.

### Decision

Add `validateAcFreshness({ tickets, baseBranchRef, gitRunner })` to
`.agents/scripts/lib/orchestration/ticket-validator.js`. The check runs
**only** on tickets whose `type === 'task'` (Features/Stories carry
narrative copy that routinely names docs and templates) and scans every
`body.{goal,changes,acceptance,verify}` string plus a defensive
top-level `acceptance` array. Path references are matched by a single
regex anchored to three repository roots:
`(\.agents/scripts|lib|tests)/.*\.js`. For each unique referenced path,
the validator probes `git cat-file -e <baseBranchRef>:<path>` (existence,
not content); a non-zero exit means the path does not exist at the Epic
base branch tree and the planner is referencing a stale or hallucinated
asset.

When one or more probes fail the validator throws
`ValidationError` with the offending Task slug and missing path for
**every** miss in a single batched message — operators see the full
remediation list in one pass rather than fixing one slug at a time. The
gate is wired into the canonical decompose chain via
`epic-plan-decompose.js → runDecomposePhase → validateTickets →
validateAndNormalizeTickets`, threading `config.baseBranch` (default
`main`) through the call so each project's configured base branch is
honoured.

### Consequences

-   **Decompose now fails fast** when a planner hallucinates a code
    asset that does not exist on the Epic base branch. The failure
    surfaces before any GitHub issue is created, so operators do not
    have to unwind partial decompositions or close hallucinated Tasks
    as `not_planned`.
-   **The validator's signature is a no-op opt-in.** Callers that omit
    `opts.baseBranchRef` (legacy unit tests, ad-hoc replays without a
    git context) keep their pre-1114 semantics — the freshness clause
    is skipped entirely. Production decompose always passes the ref so
    the gate is on by default in the live path.
-   **Regex bounds are intentional.** The three roots
    (`.agents/scripts`, `lib`, `tests`) cover the executable surface
    that decomposer Tasks legitimately edit. Docs (`docs/`), baselines
    (`baselines/`), and fixture data are deliberately out of scope —
    they change frequently and a planner naming a docs path is not a
    structural failure mode worth blocking the decompose pass on.
-   **Probe results are cached per path** within a single decompose
    run. Sibling Tasks that cite the same helper module hit the cache
    instead of re-spawning git, keeping the gate's overhead linear in
    the number of unique referenced paths rather than in the number of
    Tasks.
-   **Story #1089's body was edited as a side cleanup** (Task #1139)
    so a future re-decompose pass against that Story does not re-cut a
    structurally impossible Task. The bullet citing the deleted
    aggregator script is gone; a follow-on note in the Story body
    records the `not_planned` closure of Task #1109 under Epic #1072.

---

## ADR 20260512-loop-adoption: Adopt built-in `/loop`; no homegrown surface to reconcile

**Status:** Accepted
**Date:** 2026-05-12
**Surface:** `.agents/scripts/lib/util/poll-loop.js`
**Epic:** #1471 (v6.0.0 Epic G — Claude Code-first adoption)
**Story:** #1557 (Rebase homegrown loop on built-in `/loop` or document divergence)
**Supporting evidence:** `temp/epic-1471/loop-contract-comparison.md` (ephemeral) — full discovery audit and contract surface table.

### Context

The Epic G phasing (Tech Spec #1545, Phase 2, Story 5) flagged the homegrown `loop` skill as a candidate for one of four reconciliation outcomes against the Claude Code built-in `/loop`: **rebase**, **thin-to-reference**, **delete**, or **document-divergence**. The Tech Spec explicitly noted the homegrown skill's location was "TBD by Story 5 investigation" — the audit was the first deliverable.

### Decision

**Adopt the built-in `/loop` as the sole loop surface.** No homegrown skill is rebased, thinned, or deleted because none exists.

The discovery audit (full table in the supporting comparison file) confirmed:

- `.claude/commands/`, `.claude/skills/`, `.agents/skills/core/`, and `.agents/skills/stack/` contain no `loop` skill or slash command.
- The host skill manifest exposes a single `loop:` entry — the Claude Code built-in (*"Run a prompt or slash command on a recurring interval; e.g. `/loop 5m /foo`. Omit the interval to let the model self-pace."*).
- The historic deletions of `scripts/run-agent-loop.js`, `tests/run-agent-loop.test.js`, and `tests/e2e/run-agent-loop-e2e.test.js` (commits `0d6ef1b8`, `e6a11089`) were the legacy pre-v5 wave runner — a different concept, not a Claude Code skill, and already removed.
- Internal library helpers (`lib/util/poll-loop.js`, `lib/orchestration/epic-runner/phases/iterate-waves.js`) are programmatic loops inside the dispatcher, not operator-facing skills, and are out of scope for the loop-skill comparison.

The Story-level verdict therefore collapses the four candidate outcomes into one: **`document-divergence`** — where the "divergence" being recorded is the absence of any homegrown competitor, which is the desirable end state.

### Consequences

- **No code or workflow files change for this Story.** The verdict is documentation-only.
- **The `loop` row in `docs/claude-code-catalog.md`** (landing in Story 8 of this Epic) carries the classification **`adopt`** with this ADR as the citation.
- **Future contributors reaching for "the homegrown loop"** are pointed at this ADR plus the comparison file, which together demonstrate the audit was performed and re-implementation would be a regression against the two-surface coupling stance (ADR 20260512-coupling-stance above).
- **Cron-style durability** (jobs surviving session restart) is **not** in `/loop`'s contract. The host's separate `schedule:` skill covers that need; if the framework needs it, a follow-on Epic should evaluate `schedule:` adoption explicitly rather than reintroducing a homegrown loop runner.
- **Failure semantics inheritance.** Looping a flaky command (e.g. `/loop 5m /audit-flaky-thing`) does not abort on a single bad tick — the looped command remains responsible for its own retry/backoff. This is the same model the framework's existing internal cadence helpers use, so no behavioural surprise is introduced by adopting `/loop` for operator-facing recurrence.

### Alternatives considered

- **Build a homegrown `/loop` skill anyway** to own a "structured loop" artifact contract. Rejected — the framework's recurring tasks (cadence polls, dashboard regen, PR babysitting) already own their own artifacts via the underlying scripts; a wrapper would add no contract value and would directly violate the Epic's "shrink the framework's homegrown surface area" goal.
- **Defer to a future hybrid wrapper pattern** (built-in delegated to from a homegrown entry point, as `/security-review` is delegated from `audit-security`). Rejected for `/loop` specifically — the hybrid pattern's value is when the wrapper owns a structured artifact (`audit-*-results.md`). `/loop` produces no artifact; it just re-prompts. There is nothing for a wrapper to validate or fold in, so the hybrid pattern collapses to a pass-through.

---

## ADR 20260513-command-naming-discipline: Domain-vocabulary command names; single Mandrel-prefixed discoverability entry

**Status:** Accepted in part — the **base-name discipline below still holds**
(descriptive names, no `mandrel-` prefix, projected as flat `/<name>`
commands). The **single-brand `/mandrel` catalog entry is retired**:
`20260603-plugin-namespace-cutover` replaced it with a `/mandrel:<name>`
namespace, then
[`20260604-flat-command-projection-revert`](#adr-20260604-flat-command-projection-revert-revert-the-plugin-cutover--project-workflows-as-flat-name-commands)
reverted that cutover without restoring the catalog command; no `mandrel.md`
workflow exists. Defer to `20260604` on the projection axis.
**Date:** 2026-05-13
**Surface:** `.agents/scripts/sync-claude-commands.js`
**Epic:** #1184 (v6.0.0 Epic F — Cut-over + Mandrel rebrand)
**Story:** #1601 (Scripts + commands surface audit; `/mandrel` discoverability)
**Supporting evidence:** A full reference-count audit of the script + command surface as of 2026-05-12 (audit report archived post-release with `docs/audits/` in commit `8855ab6c`).

### Context

The Mandrel rebrand from `agent-protocols` surfaces a one-way decision about command naming: do every Mandrel-owned slash command name a brand prefix (`/mandrel-epic-deliver`, `/mandrel-audit-clean-code`, etc.), or does the brand stay out of the per-command surface and live in a single discoverability entry?

Brand-prefixing every command is reverse-coupling: it makes the consumer's `/` menu cluttered with `mandrel-` repetition, hides the descriptive verb (`epic-deliver` says what it does; `mandrel-epic-deliver` says what it does *and* who owns it, which the operator already knows because they installed the framework), and reverses the same logic that keeps `.agents/` and `.agentrc.json` filenames unchanged through the rebrand (those names describe the artifact, not the brand).

### Decision

Adopt a two-part naming-discipline rule for the slash-command surface:

1. **Per-command names describe what the command does** in the harness's domain vocabulary. The framework's domain has a small, stable noun-verb taxonomy: `epic-*`, `story-*`, `audit-*`, `worktree-*`, `git-*`, `agents-*` (the last reserved for operations scoped to the `.agents/` directory itself). A new command picks the noun that describes its surface and a verb that describes its action. No brand prefix.
2. **One Mandrel-prefixed discoverability entry, `/mandrel`,** prints the auto-generated catalog of Mandrel-owned commands. The brand prefix exists exactly once in the runnable surface — at the entry point a consumer types to learn the surface. Day-to-day commands stay descriptive.

The seven-row recategorization matrix from the Epic body (#1184) codifies the specific decisions that flow from the rule. Each row is reproduced below with its rationale so future contributors can resolve the same ambiguities without reopening them:

| Item | Decision | Rationale |
| --- | --- | --- |
| `agents-bootstrap-*` → `mandrel-bootstrap-*` | **Keep `agents-bootstrap-*`** | The name describes what it bootstraps — the `.agents/` directory, which the rebrand explicitly preserves as a stable filename. Brand-prefixing where the artifact name is already more self-describing is reverse-coupling. |
| `agents-update` → `mandrel-update` | **Rename to `mandrel-update`** | The command now runs `npx mandrel update` — it upgrades the `mandrel` **npm package**, then re-materializes `.agents/`. `mandrel-update` names exactly that, and reads as unambiguously "update the framework" from a consumer's seat (the consumer never thinks of `.agents/` by that name). *(Supersedes the original rebrand-era call to keep `agents-update`, whose rationale — "updates the `.agents/` submodule pointer" — was made obsolete by the move from the Git-submodule distribution model to the npm package.)* The sibling `agents-bootstrap-*` row still stands — those commands genuinely scaffold the `.agents/` directory. |
| `delete-epic-*` workflows → scripts-only | **Keep as workflows** | Destructive operations benefit from slash-command discoverability and the workflow-level confirmation step. The scripts are thin, but the operator's entry point and confirmation home is the workflow file. |
| `epic-plan` / `epic-deliver` → `mandrel-plan` / `mandrel-deliver` | **Keep as `epic-*`** | "Epic" is the domain concept the framework operates on. `mandrel-plan` is strictly less informative ("plan what?"). The noun the workflow acts on is the right primary axis for the name. |
| `story-deliver` → helper | **Keep as command** | Operator-facing for individual story re-runs and debugging. The documented argument is a Story ID; the workflow is intended to be human-invocable, not just a fan-out target. |
| `worktree-lifecycle` → helper | **Move to `.agents/workflows/helpers/`** | The file self-describes as "operator and reviewer reference" — it is documentation, not an executable workflow. It is already path-included from `story-deliver.md`. It should not appear in the `/` menu as runnable. After the move, `sync-claude-commands.js` automatically drops `.claude/commands/worktree-lifecycle.md` because the sync filter excludes the `helpers/` subdirectory. |
| `drain-pending-cleanup` → helper | ~~**Keep as command**~~ → **Overturned: moved to `helpers/`** (Story #3706) | Original rationale assumed the manual path was load-bearing as a slash command. A later wiring audit (Story #3706) found it is **not** — see [§ Overturn: `drain-pending-cleanup` demoted to a helper](#overturn-drain-pending-cleanup-demoted-to-a-helper) below. |

### Consequences

- **`/mandrel` becomes the canonical discoverability entry.** A new workflow at `.agents/workflows/mandrel.md` (landed by the companion Task #1619) prints the catalog auto-generated from the on-disk workflow set. The catalog is never stored on disk — generation happens at invocation time, so adding or renaming a workflow is reflected without a sync step.
- **`worktree-lifecycle` is removed from the runnable `/` menu.** The file moves to `.agents/workflows/helpers/worktree-lifecycle.md`; `story-deliver.md`'s path-include is updated to the new location; the next `npm run sync:commands` drops the orphan slash-command file.
- **Future commands inherit the rule.** When introducing a new workflow, the contributor picks the descriptive noun-verb pair and skips the brand prefix unless ambiguity is real. The one place ambiguity is real is the entry point itself, and that slot is now claimed by `/mandrel`.
- **Adopters reading `docs/decisions.md`** can resolve "why isn't this `mandrel-*`?" without reopening the matrix. The seven rows are the load-bearing precedents.

### Alternatives considered

- **Brand-prefix every command** (the maximalist position). Rejected — clutters the `/` menu, makes every consumer-facing example longer, reverses the same naming logic that keeps `.agents/` and `.agentrc.json` stable through the rebrand, and offers no information value because the consumer already knows which framework they installed.
- **No brand prefix anywhere, including a discoverability entry.** Rejected — adopters need *some* affordance to tell Mandrel-owned commands apart from Claude Code built-ins. Without a single entry point, the only path is reading the docs site, which is a worse first-run experience than typing `/mandrel`.
- **Per-command opt-in: prefix only the "Mandrel-distinctive" commands.** Rejected — every framework command is "Mandrel-distinctive" by virtue of being owned by the framework. Drawing the line by judgment regenerates the same ambiguity the rule is designed to eliminate.
