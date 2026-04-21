# Changelog

All notable changes to this project will be documented in this file.

## [5.12.3] - 2026-04-20

### Clean-code audit remediation pass

Addresses the findings in `temp/audit-clean-code-results.md`. Internal
refactor only — no behavior change, no public-API change, all 572 tests
still pass.

**New utility modules (single source of truth for cross-cutting concerns):**

- `lib/error-formatting.js` — `formatError(err)` and `logNonfatalError(context, err)`
  replace the scattered `err?.message ?? String(err)` idiom.
- `lib/path-security.js` — `assertPathContainment(root, target, label)`
  consolidates the duplicated path-traversal guard previously inlined in
  both `worktree-manager.js` and `config-resolver.js`.
- `lib/issue-link-parser.js` — `parseLinkedIssues(body)` replaces the inline
  PRD / Tech-Spec regex that lived inside `providers/github.js` `getEpic()`.
- `lib/risk-gate.js` — `postHitlGateNotification(...)` + exported
  `RISK_HIGH_LABEL` unify the risk-high HITL logic previously duplicated
  between `dispatch-engine.js` and `sprint-story-close.js`.
- `lib/label-constants.js` — central registry of all GitHub label names
  (`AGENT_*`, `TYPE_*`, `STATUS_*`, `RISK_*`, `PERSONA_*`, `CONTEXT_*`,
  `EXECUTION_*`, `FOCUS_*`) and the `LABEL_COLORS` palette. `label-taxonomy.js`
  now derives its entries from these constants; `dispatch-engine.js`
  re-exports `RISK_HIGH_LABEL` from `risk-gate.js` so the string literal
  `'risk::high'` lives in exactly one place.

**Consolidations inside existing files:**

- `lib/config-resolver.js` — the two hand-rolled default dictionaries
  (loaded-config path vs zero-config fallback) are hoisted into module-scope
  `LOADED_CONFIG_DEFAULTS` and `ZERO_CONFIG_DEFAULTS` constants. The 27-line
  `settings.X = settings.X ?? defaults.X` block is now a single loop over
  `LOADED_CONFIG_APPLY_KEYS`. Loaded-config behavior is preserved exactly —
  keys not present in the loaded defaults (e.g. `baseBranch`, `tempRoot`)
  still resolve to `undefined`, matching prior semantics.
- `lib/config-schema.js` — pulls the shell-injection regex source into a
  single `SHELL_INJECTION_PATTERN_STRING` constant used by all four
  `not.pattern` schema sites. The pipe-joined list of validated string
  fields is now an `AGENT_SETTINGS_STRING_FIELDS` array; the `patternProperties`
  regex is generated from it.
- `lib/cli-args.js` — new `parseTicketId(value)` helper centralises the
  "strip optional `#`, coerce to positive integer" dance. `parseSprintArgs`
  uses it for `--epic`, `--story`, `--recut-of`, and the positional.
- `providers/github.js` — removes the `_rest`, `_graphql`, `_restPaginated`
  transport proxy methods (which only delegated one line each to `_http.*`).
  All internal call sites now invoke `this._http.rest(...)` etc. directly.
  `graphql()` remains because it is part of the public `ITicketingProvider`
  interface. The inline PRD / Tech-Spec regex in `getEpic()` is replaced with
  a call to `parseLinkedIssues()`.
- `sprint-story-close.js` — ~10 repeated `try { ... } catch { Logger.error(...) }`
  phase wrappers collapse to a single `runPhase(name, fn, fallback)` helper.
  The `handleHighRiskGate` notification call flows through
  `postHitlGateNotification`.

**Consistency sweep:**

- All call sites now use `Number.parseInt(...)` instead of the global
  `parseInt(...)` (43 occurrences across 27 files).

**Documented deferrals (intentionally out of scope for this patch):**

- The full three-way split of `lib/worktree-manager.js` (1,234 LOC),
  `lib/orchestration/dispatch-engine.js` (841 LOC), and
  `lib/presentation/manifest-renderer.js` (600 LOC) into 4+ cohesive
  submodules per the audit's Finding #5, #6, and #16 is a dedicated
  refactor sprint, not a patch-version tidy-up. Each of those carries
  enough public-API and test-fixture surface area that they need their
  own Epic. The utility extractions above resolve the DRY portion of
  those findings (risk-gate, label constants, path-security,
  error-formatting) so the remaining work is purely structural.

## [5.12.2] - 2026-04-20

### Runtime `--cwd` honored for config resolution; worktree reap recovery

- `runStoryClose()` and `runStoryInit()` now pass `cwd` to `resolveConfig()`
  so the runtime `--cwd` actually controls which `.agentrc.json` is read.
  Previously, `--cwd` could be ignored for config lookup, so
  `worktreeIsolation` might appear disabled and reap would be skipped
  entirely — producing no `WORKTREE` log, after which the branch delete
  step would fail because the worktree still held the branch.
- `WorktreeManager._removeWorktreeWithRecovery()` now uses a longer
  Windows retry schedule (up to 6 attempts with 150ms–2s backoff) for
  lock races, and — if repeated `git worktree remove` fails but
  `git worktree prune` clears the registration — reap is treated as
  successful for branch cleanup (with a warning). This prevents a
  lingering folder from blocking branch deletion.
- Added regression tests for runtime-`cwd` config control in
  `sprint-story-close` and `sprint-story-init`, plus a prune-cleared
  registration recovery test for `WorktreeManager.reap()`.

## [5.12.1] - 2026-04-20

### Harden `WorktreeManager.reap()` against submodule guard and Windows locks

`reap()` now performs targeted recovery when `git worktree remove` fails:

- **Submodule guard retries** — before remove, the index is scrubbed of
  *all* mode-160000 gitlinks (not just `.agents`) via a new generic
  `_dropAllSubmoduleGitlinksFromIndex()` helper, so consumer repos with
  additional submodules are covered. If the guard still fires, the retry
  loop scrubs residual gitlinks and the per-worktree `modules/` dir, then
  retries.
- **Windows lock-like retries** — "Permission denied", "Access is denied",
  "Directory not empty", "resource busy", and "sharing violation" now
  trigger short bounded backoff (100ms, 300ms) up to 3 attempts on win32.
- **Clear failure reason** — when all attempts fail, `remove-failed: <reason>`
  surfaces the real git stderr instead of a generic message.
- `_purgePerWorktreeSubmoduleDir()` no longer gates on `.agents` submodule
  detection, so stale `worktrees/<name>/modules/` directories from prior
  runs no longer trip the guard in framework-consumer repos.

## [5.12.0] - 2026-04-20

### Protocol self-healing — code-review calibration, recuts, and parked follow-ons

Four related fixes that close gaps found during the v5.11 retro. All four
land together because they share the same data path (Epic-level structured
comments consumed by `/sprint-close` at the wave-completeness gate).

**Maintainability scorer calibration**
[`lib/maintainability-engine.js`](../.agents/scripts/lib/maintainability-engine.js)
now exposes `calculateReport()` / `calculateReportForFile()` returning a
per-method breakdown alongside the module-level index, plus a
`classifyReport()` helper that tiers results. `sprint-code-review.js` uses
the report to drive severity: a **critical** finding now requires an actual
complexity hotspot (a method scoring < 20, or a method-less module below
40). File-size-driven module-score drops reclassify as **🟡 Medium** instead
of poisoning the Critical tier — the v5.11.6 issue where well-structured
multi-hundred-line scripts scored `0` no longer surfaces as a blocker.

**Structured lint output**
`sprint-code-review.js` now spawns the lint runner directly (previously
misrouted through `gitSpawn`, which always failed) and parses the combined
stdout/stderr to separate **errors** from **warnings**. Errors → 🟠 High
Risk; warnings → 🟢 Suggestion; unparseable failures conservatively default
to one error so a broken runner is never mis-reported as clean.

**Recut markers on mid-sprint Stories**
New `<!-- recut-of: #N -->` HTML marker convention, parsed and written via
the new [`lib/orchestration/recut.js`](../.agents/scripts/lib/orchestration/recut.js).
`sprint-story-init.js --recut-of <parentId>` injects the marker into the
Story body at init time. The retro workflow and the wave-completeness gate
both attribute recut Stories back to their manifest parent so sprint counts
line up with the frozen manifest (fixes the "manifest says 9, closed says
10" discrepancy).

**Parked follow-on protocol**
The dispatcher now upserts a `parked-follow-ons` structured comment on the
Epic at every dispatch cycle, classifying every `type::story` under the Epic
as manifest / recut / parked. `sprint-wave-gate.js` reads the comment and
halts `/sprint-close` if any recut or parked Story is still open — giving
the operator a single checkpoint to adopt (re-dispatch) or explicitly defer
(`state_reason=not_planned`). `--allow-parked` / `--allow-open-recuts` waive
the gate when the operator has made that decision consciously.

## [5.11.6] - 2026-04-20

### Fix: v5.11.5 regression — worktree reap silently failed on drive-case mismatch

v5.11.5's reap hardening did not reach the common Windows failure mode
reported by downstream consumers (e.g. athlete-portal). `reap()` still
probed `git worktree list --porcelain` via `_findByPath`, which compared
paths with case-sensitive `===` on `path.resolve()` output. On Windows,
`path.resolve()` preserves drive-letter case, and consumers routinely
invoke `sprint-story-close.js --cwd c:\repo` while git's porcelain
reports `C:\repo` — the mismatch caused `reap()` to return
`{ reason: 'not-a-worktree' }`, which `reapStoryWorktree` intentionally
swallowed. Branch delete then failed with "cannot delete branch
'story-<id>' used by worktree".

- `WorktreeManager._findByPath` now delegates to `_samePath`, which
  already handles Windows case-insensitive path comparison.
- The `gc()` snapshot-based comparison in `reap()` uses `_samePath`
  for the same reason.
- `sprint-story-close.js` no longer silences the `not-a-worktree`
  branch — every non-removed outcome is logged with a remediation hint.
- After reap, `sprint-story-close.js` re-probes `git worktree list`
  and emits a louder warning if the story worktree is still
  registered, so the operator sees the real failure instead of the
  downstream branch-delete error.

**Cleanup for worktrees inherited from the v5.11.5 era:**

    git worktree remove <path> --force && git worktree prune && git branch -D story-<id>

## [5.11.5] - 2026-04-20

### Worktree reap hardening (Windows)

- `WorktreeManager.reap()` now detects when the Node process's `cwd` is
  inside the target worktree and `chdir`s to `repoRoot` before
  `git worktree remove`. On Windows the cwd holds a directory handle, so
  leaving the process inside the worktree caused silent removal failures
  even when `git worktree remove` reported success.
- After `git worktree remove` succeeds, `reap()` verifies the directory
  is gone and falls back to `fs.rmSync(wtPath, { recursive, force })` if
  git left the tree behind (lingering submodule metadata on Windows).

## [5.11.4] - 2026-04-19

### playwright-bdd skill: Epic C retro hardening

- Added a top-level **Pre-authoring checklist (mandatory)** section to
  `.agents/skills/stack/qa/playwright-bdd/SKILL.md`, promoting the
  grep-before-you-write requirement from prose into a numbered
  report-back contract that subagents must satisfy before authoring any
  scenario text.
- Added a **Recommended invocation template** section with the verbatim
  `{{AC_TEXT}}` / `{{STEPS_DIR}}` / `{{OUTPUT_PATH}}` prompt that drove
  the Epic C pilot result (4/5 step reuse, zero Forbidden-Patterns
  violations, one clean named gap).

## [5.11.3] - 2026-04-19

### Worktree `.agents` gitlink safeguards

- `WorktreeManager.ensure()` / `_copyAgentsFromRoot` no longer runs
  `git rm --cached .agents` at worktree setup. Instead it marks the
  `.agents` gitlink entry with `update-index --skip-worktree`, so
  routine task commits inside the worktree cannot accidentally stage
  a submodule deletion.
- `WorktreeManager.reap()` / `_removeCopiedAgents` now clears the
  skip-worktree bit (`--no-skip-worktree`) before the existing gitlink
  scrub, keeping index mutations deterministic across platforms.
- New helper `_setAgentsGitlinkSkipWorktree(wtPath, enable)` encapsulates
  both toggles; guarded by `_isAgentsSubmodule()` and by a `160000`
  gitlink-mode check so it is a no-op in framework-style repos.
- Docs (`.agents/workflows/worktree-lifecycle.md`) updated to describe
  the skip-worktree on ensure / clear-and-scrub on reap contract.

## [5.11.2] - 2026-04-19

### Worktree reap + cancellation GC fixes

- `sprint-story-close.reapStoryWorktree` now roots `WorktreeManager` at the
  resolved runtime repo root (`--cwd` / `cwd` param) instead of module
  `PROJECT_ROOT`. This ensures reap targets the real main checkout when
  close is invoked from a copied `.agents` tree inside a story worktree.
- `dispatch-engine.collectOpenStoryIds` now honors
  `orchestration.worktreeIsolation.reapOnCancel`. Cancelled stories
  (closed without `agent::done`) are treated as reapable by the GC pass
  when `reapOnCancel=true` (default); retained for manual recovery when
  `false`. Previously the config flag had no effect on GC behaviour.
- Manual dispatch output and rendered story manifests now emit the safe
  close command with `<main-repo>` prefix and `--cwd <main-repo>` so
  operators run the closer against the real checkout by default.

## [5.11.1] - 2026-04-19

### HITL gate notifications

- `dispatch-engine.handleRiskHighGate` and
  `sprint-story-close.handleHighRiskGate` now fire the configured action
  webhook (via `notify.js --type action`) in addition to posting the GitHub
  comment / stderr pause prompt. When
  `orchestration.notifications.webhookUrl` is unset the webhook call is a
  graceful no-op, preserving existing behaviour for operators who rely only
  on the in-chat prompt.
- Failures in the webhook/mention path are logged as non-fatal warnings and
  never abort the HITL halt itself — the gate still pauses for the operator
  decision regardless of notification delivery.

## [5.11.0] - 2026-04-19

BDD / acceptance-tier standardisation across the framework. Epic #269
introduces a pyramid-aware testing contract: `.feature` files are authored
against a single canonical rule, executed via a dedicated workflow, and
ingested as sprint evidence through the QA lifecycle.

### New rule

- **`.agents/rules/gherkin-standards.md`** — sole SSOT for Gherkin authoring:
  tag taxonomy (`@smoke`, `@risk-high`, `@platform-*`, `@domain-*`, `@flaky`),
  forbidden patterns (SQL, status codes, selectors, URLs, payloads, framework
  names, explicit waits), Scenario Outline conventions, selector discipline,
  and the grep-before-you-write step-reuse protocol.

### New skills (`skills/stack/qa/`)

- **`gherkin-authoring`** — canonical Given/When/Then phrasing, PRD AC →
  Scenario translation, Background vs. Given, Outline vs. multi-Scenario,
  step-definition library layout, and an authoring checklist. Defers to
  `gherkin-standards.md` for enforcement rules.
- **`playwright-bdd`** — runtime wiring between `.feature` files and
  Playwright: config patterns, fixture composition, tag-filtered execution,
  trace/debug workflow, and sharding/CI notes. References
  `gherkin-standards.md` for the tag taxonomy rather than redefining it.

### Rewritten rule

- **`.agents/rules/testing-standards.md`** — now pyramid-aware. Every test
  belongs to exactly one of three tiers (unit, contract, e2e / acceptance)
  with explicit scope, dependency, assertion, and location rules per tier.
  Status-code and wire-shape assertions are tier-placed at contract; the
  acceptance tier defers to `gherkin-standards.md`.

### New workflow

- **`.agents/workflows/run-bdd-suite.md`** (`/run-bdd-suite`) — tag-filtered
  acceptance runner. Generates step bindings, executes the tagged subset,
  and emits a Cucumber HTML/JSON report as the canonical evidence artifact.

### Updated workflow

- **`.agents/workflows/sprint-testing.md`** — now consumes the Cucumber
  report produced by `/run-bdd-suite` as QA evidence. The sprint-testing
  ticket is gated on all scenarios being `passed`; `failed` or `pending`
  runs keep the ticket open.

### Docs refresh

- **`.agents/SDLC.md`** — new Testing Strategy section pointing at
  `testing-standards.md`, `gherkin-standards.md`, `run-bdd-suite.md`, and
  `sprint-testing.md`; PRD-authoring tip now recommends Gherkin-compatible
  `Given/When/Then` phrasing for acceptance criteria so ACs lift straight
  into `.feature` files.
- **`.agents/README.md`** and root **`README.md`** — skill and rule indices
  updated for the new entries; stack skill count is now 22 and rule count
  is now 9.

### Upgrade notes

- No breaking changes. Consumers on v5.10.x can upgrade by pulling the
  updated `.agents/` submodule; no `.agentrc.json` migration is required.
- Projects that already author `.feature` files should audit their tag
  usage against the new canonical taxonomy — ad-hoc tags now require a PR
  to `gherkin-standards.md` before use.

## [5.10.10] - 2026-04-18

Follow-up hardening pass on the v5.10.x worktree/sprint-close work, plus
fixes to issues surfaced during code review of the in-flight changes.

### Worktree safety (`lib/worktree-manager.js`)

- `isSafeToRemove` now fails closed when `git merge-base` returns an
  unexpected exit (e.g. missing epic branch or ref-lookup failure) rather
  than silently treating the worktree as safe to reap.
- `remove` (and therefore `reap`/`gc`) refuses to act on managed
  `story-N` worktrees unless the caller supplies `epicBranch`, so merge
  verification cannot be bypassed by omission.
- New `WorktreeManager.prune()` centralises `git worktree prune` so all
  mutations flow through a single helper. `sprint-close` now calls it
  instead of shelling out directly.
- `.gitmodules` submodule detection accepts quoted `path = ".agents"`
  entries (previously required an unquoted bareword).
- Symlink `nodeModulesStrategy` restored to Windows-safe behaviour:
  `junction` on real Windows hosts (no Administrator required), `dir`
  elsewhere. Keys off `process.platform`, not the injected test hook.
- Retry loop replaces a shelled-out `sleep` with `Atomics.wait` on a
  `SharedArrayBuffer` — no more cross-platform shell contortions.

### CLI and workflows

- `notify.js` extracts `parseNotifyArgs` for testability and adds
  explicit `--ticket` / `--issue` flags alongside the existing
  positional-argument modes. Multi-word messages are now joined
  correctly.
- `sprint-close.js` reuses a single `WorktreeManager` instance for reap
  + prune and drops the redundant `git stash clear` step (the workflow
  doc is updated to match).
- `sprint-story-init.js` now treats blocker fetch failures as blocking.
  Proceeding while dependency state is unknown is riskier than requiring
  the operator to retry once the provider is healthy.
- `sprint-plan.md` workflow snippets rewritten as PowerShell to match
  the documented Windows-first development environment.
- `detect-merges.js` adopts the shared `runAsCli` bootstrap.

### Release-path reliability (second review pass)

- `sprint-close.js` now records Epic-close failures in the top-level
  `warnings[]` buffer. Previously a failed `provider.updateTicket(...,
  { state: 'closed' })` only printed to stderr, and if subsequent branch
  cleanup happened to succeed the script still exited 0 and printed the
  🎉 banner — a dangerous false-positive for release operators.
- `AGENT_SETTINGS_SCHEMA` gained a `release` block validating `docs`
  (array of shell-safe strings), `versionFile` (shell-safe string or
  `null`), `packageJson` and `autoVersionBump` (booleans). Malformed
  release config previously slipped through silently because the schema
  had no knowledge of that subtree.
- `sprint-close.md` moves tag-publication verification to a new
  Step 7.1, immediately after the push. A failed remote tag is now
  surfaced before Epic closure and branch cleanup, rather than after the
  sprint visibly looks shipped. Step 10 is reframed as a final sanity
  re-check.

### Tests

- New coverage for: merge-check failure path, `epic-branch-required`
  guard, `prune` helper, Windows junction symlink, quoted-submodule
  `.gitmodules` parsing, blocker-verification-fails-closed policy, and
  `release`-block schema validation (type mismatch + shell injection).

### Known limitation

- `/sprint-close` remains a partial orchestrator: the script still only
  owns the terminal cleanup stage, while `sprint-close.md` documents
  Steps 1.4–10 as the operator's responsibility. Promoting those stages
  into executable code with explicit stage results, override handling,
  and failure semantics is tracked as the next major release-path
  refactor and is intentionally out of scope for v5.10.10.

## [5.10.9] - 2026-04-17

Follow-up to the v5.10.8 copy-on-create switch: `git worktree remove`
was still failing with
`fatal: working trees containing submodules cannot be moved or removed`
on some worktrees even after the `.agents/` directory and the index
gitlink were scrubbed.

### `reap` now purges the per-worktree `modules/` directory (`lib/worktree-manager.js`)

Git's submodule guard in `git worktree remove` fires when EITHER (a) the
per-worktree index carries a 160000 gitlink OR (b)
`<common-git-dir>/worktrees/<name>/modules/` exists on disk. Previously
we only handled (a). Legacy worktrees (and any worktree where the old
symlink scheme, a stray `git submodule update --init`, or a prior reap
attempt populated the per-worktree modules dir) were still blocked by
(b).

`_removeCopiedAgents` now also calls `_purgePerWorktreeSubmoduleDir`,
which:

- Reads the `gitdir:` pointer from `<wtPath>/.git` to locate the
  per-worktree gitdir.
- Refuses to act unless that gitdir lives under
  `<repoRoot>/.git/worktrees/` (containment guard).
- Recursively removes `<gitdir>/modules/` if present.

The main repo's `.git/modules/` (which holds the root checkout's
submodule working dirs) is never touched. Tests cover both the happy
path and the malformed-pointer guard.

## [5.10.8] - 2026-04-17

Two related sprint-story-close bugs that together explained the
"worktree won't clean up + branch reported deleted but still local"
pattern seen after v5.10.7.

### `.agents/` is now copied into worktrees instead of symlinked (`lib/worktree-manager.js`)

Previously, consumer-project worktrees had `.agents/` replaced with a
symlink (junction on Windows) pointing at `<repoRoot>/.agents`, guarded
by `skip-worktree` + a pre-reap gitlink scrub. In practice the junction
was fragile: case/separator mismatches on Windows caused
`_unlinkAgentsFromRoot` to bail silently, leaving the link in place;
`git worktree remove` then followed the link and either refused
("submodule inside") or risked wiping the root copy.

`WorktreeManager.ensure()` now does a recursive `fs.cpSync` from
`<repoRoot>/.agents` into each new worktree and drops the submodule
gitlink from the per-worktree index. The worktree is self-contained —
`git worktree remove` succeeds without any symlink teardown. Tradeoff:
`.agents/` updates made in root after worktree creation do not
propagate into existing worktrees (acceptable for sprint-length
worktrees; recreate if you need a mid-sprint refresh).

Renamed internals: `_linkAgentsToRoot` → `_copyAgentsFromRoot`,
`_unlinkAgentsFromRoot` → `_removeCopiedAgents`. The legacy-symlink
branch in `_removeCopiedAgents` unlinks rather than recursing, so
worktrees created under the old scheme still reap cleanly after the
upgrade.

### `sprint-story-close` now reaps the worktree before deleting the branch (`sprint-story-close.js`)

`cleanupBranches` ran inside `finalizeMerge`, before `reapStoryWorktree`
was invoked. git refuses to delete a branch that is still checked out
by any worktree, so the local delete failed whenever the story worktree
was still registered — which was guaranteed when reap itself failed
(see above). The structured result nonetheless reported
`branchDeleted: true` because the remote delete succeeded. Two changes:

- `cleanupBranches` moved out of `finalizeMerge` and is now called
  after `reapStoryWorktree` in `runStoryClose`. Local delete races with
  worktree registration no longer fire.
- `cleanupBranches` returns `{ localDeleted, remoteDeleted }` and logs
  a non-fatal error with the git stderr when the local delete fails.
  The structured result now reports
  `branchDeleted: localDeleted && remoteDeleted` plus the two
  component fields (`branchLocalDeleted`, `branchRemoteDeleted`) so
  operators can tell which half went through.

## [5.10.7] - 2026-04-17

Bundled robustness pass across the sprint-plan / sprint-execute /
sprint-close trio surfaced by the v5.10.7 comprehensive review. All
changes are backward-compatible unless called out.

### Hardened `cascadeCompletion` error isolation (`lib/orchestration/ticketing.js`)

`Promise.all` over parent IDs used to swallow every rejection except the
first, so a single flaky parent (network blip, 403, stale ticket) could
discard progress on its siblings. `cascadeCompletion` now wraps each
per-parent branch in try/catch, returns
`{ cascadedTo: number[], failed: { parentId, error }[] }`, and logs each
failure with its ticket ID. Callers that previously treated the return
value as an array (`sprint-story-close`) have been updated; the new
shape flows through to the story-close structured result as
`cascadeFailed: []`.

### Auto-resolved merge conflicts now record an audit trailer (`lib/git-merge-orchestrator.js`)

When `mergeFeatureBranch` auto-resolves a sub-threshold conflict by
accepting the feature branch, it now (a) records the discarded base
line count per file, (b) embeds an `Auto-resolved-conflicts` /
`Auto-resolved-file: …` trailer in the merge commit message when the
caller supplied an explicit message, and (c) returns
`autoResolvedFiles: [{ file, discardedLines }]` in the result so
callers can surface it. `sprint-story-close` prints a one-line summary
per resolved file. Default thresholds and fall-through behavior on
major conflicts are unchanged.

### `sprint-close` enumerates the full Epic descendant set for branch cleanup (`sprint-close.js`)

`getTickets(epicId)` filters by a body regex that matches the Epic only
when children include an explicit `Epic: #<id>` reference. Stories
whose bodies only reference their Feature parent were silently excluded
from `validTicketIds`, so `story-<id>` branches survived the cleanup
even after a successful close. Added `collectEpicDescendantIds`, a
breadth-first walker over `provider.getSubTickets`, visited-set guarded
so shared-ancestor cycles terminate. When enumeration itself fails the
script now logs the real error, marks a warning, and skips only the
`story-<id>` matching path — legacy `story/epic-<id>/` and
`task/epic-<id>/` patterns still delete safely.

### `sprint-close` per-ticket error isolation + truthful final status (`sprint-close.js`)

- Auxiliary ticket closure (PRD / Tech Spec / Sprint Health) now
  isolates per-ticket failures inside the map, logging the specific
  ticket ID and kind. One failing ticket no longer rejects the whole
  `Promise.all` and masks itself under a generic catch.
- Per-branch remote/local delete fallbacks now append each failure to
  a `warnings` collector.
- The final progress line reports `⚠️ finished with N warning(s)` and
  enumerates each warning when anything failed, and sets
  `process.exitCode = 2`. `🎉 finished` prints only when cleanup was
  fully clean. CI pipelines that treat exit code 0 as "clean close"
  will now see partial failures.

### `batchTransitionTickets` retries transient errors with exponential backoff (`lib/story-lifecycle.js`)

Previously a one-shot `updateTicket` failure surfaced as a permanent
failure even for transient 429 / 5xx / ECONNRESET / timeout. Each
ticket now retries up to `opts.retries` times (default 3) with
exponential backoff (`retryBaseMs * 2^(attempt-1)`, default 500 ms
base) on retryable errors; 4xx status codes and permanent errors skip
retry so the batch does not stall. **Result shape change**: `failed`
is now `{ id, error, attempts }[]` instead of `number[]`. The only
internal caller (`sprint-story-init`) has been updated; external
scripts that consumed `result.failed` as a list of IDs will need to
map over `.id`.

### `sprint-story-init` halts by default on partial task-transition failure (`sprint-story-init.js`)

The old behavior warned and proceeded, which let an agent dispatch
against tasks stuck in stale state; a later close would then transition
the stale tasks to done, corrupting sprint history. Default behavior is
now to return `{ success: false, reason: 'partial-transition-failure',
failed: [...] }` when any task's retry budget is exhausted. Opt back
into the old lenient behavior with
`orchestration.storyInit.continueOnPartialTransition: true` in
`.agentrc.json`.

### `ticket-validator` fails fast on unknown `depends_on` slugs (`lib/orchestration/ticket-validator.js`)

Unknown slugs (LLM typos, hallucinated references, missing sibling
tickets) used to survive validation, only to be silently dropped by
`resolveDependencies` at ticket-creation time, producing a broken DAG
on GitHub with no actionable log trail. Validation now enumerates every
unknown `depends_on` reference, lists the offending slug / title pairs,
and throws before anything reaches the provider — giving the LLM's
self-correction loop a targeted error.

### Scrub `.agents` gitlink from worktree index before `git worktree remove`

Worktree reap was failing in consumer projects with
`fatal: working trees containing submodules cannot be moved or removed`,
even though `_unlinkAgentsFromRoot` deleted the on-disk junction first.
Root cause: git's worktree-remove guard checks the **index**, not the
working tree. `skip-worktree` hides the gitlink from the working copy
but leaves the 160000 submodule entry in the index, so the guard still
fires. Operators then reached for `git worktree remove --force`, which
hit the secondary Windows failure `Directory not empty` and left story
worktrees — and their branches, which `git branch -D` then refused to
delete — stranded after `/sprint-close`.

- **`WorktreeManager._unlinkAgentsFromRoot`** — after unlinking the
  junction, runs `git rm --cached -f -- .agents` inside the worktree to
  drop the 160000 gitlink from the worktree-local index. Runs on the
  "no symlink found" branch too, because a partial `_linkAgentsToRoot`
  can leave the gitlink stranded without a corresponding junction. Only
  active when the root repo declares `.agents` as a submodule in
  `.gitmodules` — framework-repo behavior is unchanged.
- **Side effect (intentional)**: worktree reap no longer needs `--force`,
  which means `git branch -D` for story branches now succeeds during
  `/sprint-close` — worktrees that held them are gone by the time
  branch deletion runs.
- **Doc alignment**: stale-lock sweep threshold in
  `worktree-lifecycle.md` corrected to 5 min to match the 300_000 ms
  code default.

## [5.10.6] - 2026-04-16

### Copy untracked bootstrap files into new worktrees

`sprint-story-init` worktrees previously did not carry `.env` or `.mcp.json`
because `git worktree add` respects `.gitignore`. Stories that depended on
these files (Clerk / DATABASE_URL secrets, MCP server registrations) hit
silent failures — e.g. RBAC tests failing from seed/clerkId collisions
against the wrong database. The manual workaround was `cp ../../.env .env`
inside each worktree before running tests.

- **`WorktreeManager._copyBootstrapFiles`** — new bootstrap step that runs
  after `_applyNodeModulesStrategy` and before `_installDependencies`, so
  postinstall hooks (Prisma, etc.) see the propagated values.
- **Config**: `orchestration.worktreeIsolation.bootstrapFiles` (default
  `[".env", ".mcp.json"]`). Names must be bare paths relative to `repoRoot`
  — `..`, absolute paths, and NUL-bytes are rejected with a warning.
- **Safety**: existing files in the worktree are never overwritten (agent
  overrides survive). Missing sources are a silent no-op.

## [5.10.5] - 2026-04-16

### Sprint-close performance: batched branch deletion

Three I/O-amortisation wins from the performance audit, collapsing N
sequential operations into 1 each:

- **Batched remote deletes** — replaced per-branch `git push --delete <b>`
  loop with a single `git push origin --delete b1 b2 …` call. ~85%
  reduction in remote-cleanup wall time (one TLS handshake instead of N).
  Falls back to per-branch deletion if the batched call fails so
  individual errors still surface.
- **Batched local deletes** — replaced per-branch `git branch -D <b>` loop
  with a single multi-arg invocation. Eliminates N-1 process spawns
  (200-700 ms on Windows for typical Epics).
- **`git remote prune origin`** — replaced unconditional `git fetch --prune`
  at the end of cleanup. The remote prune skips the object fetch entirely
  and only runs when branches were actually deleted in this run.

### Fix sprint-close branch cleanup blocked by stale worktrees

`sprint-close.js` branch deletion was failing with "checked out in worktree"
errors because worktree refs held implicit locks on story branches.

- **Worktree reap before branch deletion** — when worktree isolation is
  enabled, `sprint-close` now calls `WorktreeManager.gc([])` (empty open-set,
  since the Epic is closing) to reap all managed worktrees before attempting
  `git branch -D`. Skipped worktrees (dirty/unmerged) are logged with reasons.
- **Stale lock sweep** — calls `sweepStaleLocks()` to clear orphaned
  `.git/index.lock` and per-worktree lock files left by crashed agents.
- **Unconditional `git worktree prune`** — runs even without worktree
  isolation enabled, clearing any stale `.git/worktrees/` bookkeeping entries
  whose directories no longer exist on disk.

### Fix root `.agents/` wiped during sprint-close on Windows

`WorktreeManager._unlinkAgentsFromRoot` used strict string equality to verify
that a worktree's `.agents` symlink pointed at the root `.agents`. On Windows
the two paths can differ by drive-letter case or separator normalization, so
the comparison failed, the symlink was left in place, and the subsequent
`git worktree remove` traversed the junction and deleted the real root
`.agents`. The sprint-close reap pass added in this release exercised this
path on every managed worktree.

- **Canonical path comparison** (new `_samePath` helper) — case-insensitive
  on Windows, strict elsewhere.
- **Always unlink when `readlinkSync` succeeds** — unlinking a symlink never
  traverses its target, so it's safe. A mismatched target now logs a warning
  but no longer silently skips the unlink.
- **Removed `rmdirSync` fallback** — Windows `RemoveDirectoryW` semantics on
  junctions are version-sensitive; the fallback is unnecessary once
  `unlinkSync` is attempted correctly.
- **Containment assertion in `_linkAgentsToRoot`** — refuses to run
  `fs.rmSync(recursive, force)` when the resolved worktree `.agents` path
  aliases the root `.agents`. Defence-in-depth against a miscalculated
  `wtPath` wiping the framework directory during worktree creation.

## [5.10.4] - 2026-04-16

### Post-plan health check and pnpm store priming

New Phase 5 at the end of `/sprint-plan` validates the backlog and primes
the execution environment before handing off to `/sprint-execute`:

- **`sprint-plan-healthcheck.js`** — standalone CLI that runs four checks:
  ticket hierarchy validation (labels, structure, acyclic deps), git remote
  reachability, orchestration config validation, and pnpm store priming.
- **pnpm store prime** — when `nodeModulesStrategy: 'pnpm-store'`, runs
  `pnpm install --frozen-lockfile` in the project root at plan time so the
  global content-addressable store is populated. Subsequent worktree installs
  hard-link from the cache instead of downloading, reducing install time from
  minutes to seconds.
- **Non-blocking** — reports findings (errors, warnings, passes) but always
  exits 0. The plan is already committed to GitHub; this is an advisory check.
- **`sprint-plan.md`** — updated with Phase 5 documentation and the health
  check invocation command.

## [5.10.3] - 2026-04-16

### Robustness and performance hardening for sprint-story-init pipeline

Comprehensive review of `sprint-story-init.js` and its dependency chain addressing
16 findings across robustness, race conditions, and performance:

**HIGH — Silent failures and race conditions:**
- **Batch transition result checking** — `sprint-story-init` now inspects the
  `batchTransitionTickets` result and warns when tasks fail to transition.
- **TOCTOU race in `ensureEpicBranch`** — added post-checkout branch assertion
  to detect concurrent HEAD switches.
- **Consistent retry on packed-refs contention** — `ensureEpicBranch` and
  `checkoutStoryBranch` now use `gitPullWithRetry` (new) instead of raw `gitSpawn`,
  matching the retry pattern already used for fetches.
- **Worktree `ensure()` race** — catches "already exists" from concurrent
  `git worktree add` and falls back to reuse instead of crashing.
- **Upfront cycle detection** — `extractAndSortTasks` now calls `detectCycle()`
  before `topologicalSort()`, producing a targeted error naming the offending tasks.

**MEDIUM — Performance and reliability:**
- **Concurrency-capped ticket transitions** — `batchTransitionTickets` processes
  in batches of 10 (configurable) to avoid overwhelming the API.
- **Deduplicated `parseBlockedBy`** — duplicate `blocked by #N` references no
  longer create redundant graph edges.
- **False blocker prevention** — fetch errors on blocker tickets are now logged
  as warnings instead of treated as confirmed open blockers.
- **Optimized `topologicalSort`** — replaced O(V² log V) full re-sort per
  iteration with O(log V) binary insertion to maintain queue order.
- **Cached `_findByPath()`** — `WorktreeManager` caches `git worktree list`
  output for 5 seconds, eliminating redundant spawns during `gc()` passes.
- **Stale lock TTL raised** — `sweepStaleLocks` default increased from 30s to
  5 minutes to avoid killing legitimate long-running git operations.
- **Jitter in fetch retry backoff** — adds 0–50% random jitter to prevent
  thundering herd when multiple worktrees retry simultaneously.

**LOW — Semantic fixes and validation:**
- **Dry-run no longer blocks on open dependencies** — reports blockers as
  warnings without exiting non-zero.
- **Indented Epic refs** — `resolveStoryHierarchy` regex now matches `Epic: #N`
  inside markdown lists and blockquotes.
- **Branch name validation** — `getEpicBranch`, `getStoryBranch`, and
  `getTaskBranch` now validate IDs before constructing branch names.

**Dependency install hardening (pnpm-store friction fix):**
- **Retry with backoff** — pnpm installs retry up to 3 times with increasing
  delays (0s, 2s, 5s).
- **Increased timeout** — pnpm-store gets 300s (up from 120s) to accommodate
  first-run global store population.
- **Post-install verification** — checks `node_modules` actually exists after
  a zero-exit install.
- **`installFailed` signal** — threaded through `ensure()` → `bootstrapWorktree()`
  → story init result JSON so downstream agents know to run install manually.

## [5.10.2] - 2026-04-16

### Harden worktree bootstrap — HEAD-safe epic refs, auto install, branch short-circuits

Three fixes for agent churn during worktree setup:

- **`currentBranch()` short-circuit** in `ensureEpicBranch` / `checkoutStoryBranch` —
  prevents the race where `branchExistsLocally` returns false while already on the
  target branch, which routed into `checkout -b` and crashed.
- **`ensureEpicBranchRef()`** — HEAD-safe variant for worktree bootstrap that uses
  `git branch` / `git fetch` instead of `checkout`, so the main checkout's HEAD is
  never moved (parallel agents and dirty trees are safe). `bootstrapWorktree` now
  calls this instead of `ensureEpicBranch`.
- **Auto `_installDependencies()`** in `WorktreeManager.ensure()` — runs the
  lock-file-appropriate installer (`npm ci` / `pnpm install --frozen-lockfile` /
  `yarn install --frozen-lockfile`) during worktree creation for `per-worktree`
  and `pnpm-store` strategies. Non-fatal on failure so agents can retry manually.
- **Workflow doc update** — Step 0.5 in `sprint-execute.md` now documents the
  dependency install step with a fallback command.

## [5.10.1] - 2026-04-16

### Configurable ticket decomposition cap (`maxTickets`)

The ticket decomposer's hardcoded 25-ticket limit is now configurable via
`agentSettings.maxTickets` in `.agentrc.json`. Default raised to **40** to
accommodate larger Epics without requiring code changes.

## [5.10.0] - 2026-04-16

Framework housekeeping: remove redundant infrastructure and tighten the
workflow surface area.

### Removed: ROADMAP.md and roadmap sync infrastructure

GitHub Issues and Epics are the single source of truth for project status.
The local `ROADMAP.md` was a read-only mirror that added maintenance surface
area without providing value beyond what GitHub already shows.

- `docs/ROADMAP.md` — auto-generated roadmap file
- `.agents/scripts/generate-roadmap.js` — roadmap generation engine
- `.agents/templates/update-roadmap.yml` — CI workflow template
- `.agents/workflows/roadmap-sync.md` and `.claude/commands/roadmap-sync.md`
- `agentSettings.roadmap` config block from `.agentrc.json` and
  `default-agentrc.json`
- `roadmap-exclude` label from `label-taxonomy.js` (23 labels, down from 24)
- Section 9 (Automated Roadmap Protocol) from `instructions.md`
- Step 2.5 (Roadmap Sync) from `sprint-close.md`
- All roadmap references from SDLC.md, README.md, AGENTS.md,
  `.agents/README.md`, `audit-quality.md`, persona files, architecture.md,
  and JSDoc `@see` pointers in interface files
- `--install-workflows` step in `bootstrap-agent-protocols.js` (the only
  installable workflow was `update-roadmap.yml`)

### Removed: `/create-epic` and `/run-red-team` workflows

- `/create-epic` — the agent already drafts well-structured Epics when asked
  in natural language; the workflow added ceremony without value.
- `/run-red-team` — standalone adversarial audit with no integration points;
  `/audit-security` covers the same ground in a more structured way.

### Renamed: `/audit-dependency-update` → `/audit-dependencies`

Shorter, consistent with the other `/audit-*` naming pattern. Output file
renamed to `audit-dependencies-results.md`.

## [5.9.0] - 2026-04-15

Bundled SDLC-review release addressing seven findings. Summary:

- **Dispatch manifest is now a structured Epic comment.** The dispatcher
  (`manifest-renderer.js#postManifestEpicComment`) idempotently upserts a
  `dispatch-manifest` comment on the Epic containing wave count, story
  count, and a JSON block of `{ storyId, wave, title }` entries.
- **New wave-completeness gate at sprint-close.**
  `.agents/scripts/sprint-wave-gate.js` reads the `dispatch-manifest`
  comment and verifies every listed story is closed. Wired into
  `sprint-close.md` as Step 0.5 ahead of the hierarchy check.
- **Retro detection moved off heading-grep.** `sprint-retro.md` now
  appends a `<!-- retro-complete: <ISO_TIMESTAMP> -->` marker; the
  close-workflow gate prefers a `type: "retro"` structured-comment
  lookup and falls back to grepping for the marker.
- **Code-review findings persisted as a structured Epic comment.**
  `sprint-code-review.js` posts its report via `upsertStructuredComment`
  with `type: "code-review"` (severity tier counts + full findings). The
  retro workflow now reads that comment to summarise blockers/high
  findings in its Architectural Debt section.
- **`/git-push` and `/git-commit-all` consolidated.** `git-push.md` is
  the single source of truth and accepts `--no-push`;
  `git-commit-all.md` is a thin alias that links back to it.
- **Shared merge-conflict resolution partial.**
  `.agents/workflows/_merge-conflict-template.md` extracts the canonical
  procedure. `git-merge-pr.md` Step 2.5, `sprint-execute.md` Step 1, and
  `sprint-close.md` Step 6 reference it instead of inlining the same
  instructions three times.
- **`risk::high` resume protocol is now chat-only.** The operator
  approves by typing `Proceed` / `Proceed Option 1|2|3` in chat. On
  Option 1 the agent (not the operator) removes the `risk::high` label
  via the new `update-ticket-state.js --ticket <id> --remove-label
  <label>` flag, then re-runs `sprint-story-close.js`.
- **Epic-branch merge lock for parallel-wave safety.**
  `.agents/scripts/lib/epic-merge-lock.js` implements a filesystem mutex
  at `<repoRoot>/.git/epic-<epicId>.merge.lock` with PID + timestamp
  stale-lock detection. `sprint-story-close.js#finalizeMerge` acquires
  the lock before rebasing/merging/pushing and releases it in a
  `finally` block. Covered by `tests/lib/epic-merge-lock.test.js`.

## [5.8.7] - 2026-04-15

### 🔀 Robust story→epic merge at story close

Parallel wave execution kept producing conflicts at story-close time:
Stories branched off an Epic early in a wave landed after peers had
already merged, and the naive `git merge --no-ff` in
`sprint-story-close.js` had no triage — any conflict was fatal and
required manual intervention.

`finalizeMerge()` now runs two stacked mitigations:

1. **Pre-merge rebase in the story worktree.** Before swinging to the
   Epic branch on the main checkout, the Story is rebased onto
   `origin/<epicBranch>` inside its own worktree. This shrinks the
   merge's conflict surface to the Story's real delta instead of
   carrying stale base content forward. A failed rebase is aborted and
   the merge still proceeds — the triage path below handles whatever is
   left.
2. **Conflict triage via `mergeFeatureBranch`.** The close-merge now
   routes through the same threshold-based triage used at integration
   time (major = ≥3 files or ≥20 conflict markers → abort and surface
   to operator; minor → auto-resolve by accepting the Story's version
   and audit-log the discarded base content). `mergeFeatureBranch` was
   extended with an `opts.message` parameter so the close-merge keeps
   its `feat: <title> (resolves #N)` commit message regardless of path.

- **Changed:** `.agents/scripts/sprint-story-close.js` — new
  `rebaseStoryOnEpic()` helper; `finalizeMerge()` rewritten to use it
  and `mergeFeatureBranch` with a custom commit message and explicit
  major-conflict error surfaced via `Logger.fatal`.
- **Changed:** `.agents/scripts/lib/git-merge-orchestrator.js` —
  `mergeFeatureBranch(cwd, featureBranch, vlog, opts)` gains
  `opts.message` for the final commit message (propagated through both
  the clean-merge and auto-resolve-theirs paths).

### 🔗 Per-worktree `.agents` collapsed into root symlink

Consumer projects declare `.agents` as a git submodule. When a
per-story worktree was created, the worktree carried its own gitlink
entry for `.agents`, and `git worktree remove` refused to reap it
("`.agents` is a submodule inside the worktree"). Operators had to
manually `git worktree remove --force` or clean up by hand.

`WorktreeManager.ensure()` now replaces the worktree's `.agents/` with
a symlink (junction on Windows) to `<repoRoot>/.agents` and marks the
per-worktree index entry as `skip-worktree`. `reap()` removes the
symlink before `git worktree remove`, so git no longer sees a nested
repo inside the worktree. Two invariants follow:

1. Worktrees never carry their own `.agents` content — scripts invoked
   from any worktree execute the same code as the root checkout.
2. `git worktree remove` no longer trips on the submodule guard and
   the reap completes cleanly.

Detection is automatic: if `<repoRoot>/.gitmodules` declares `.agents`
as a submodule path, the symlink is applied. The framework repo
itself (where `.agents` is a regular tracked directory) skips this
behavior.

- **Changed:** `.agents/scripts/lib/worktree-manager.js` — new
  `_isAgentsSubmodule()`, `_linkAgentsToRoot()`, and
  `_unlinkAgentsFromRoot()` helpers; `ensure()` calls the link step,
  `reap()` calls the unlink step before `git worktree remove`.
- **Changed:** `.agents/workflows/worktree-lifecycle.md` — new
  "`.agents` symlink (consumer projects)" section documents the
  invariant and detection rule.

### ✅ Sprint-close auto-invokes pre-merge gates

`/sprint-close` used to halt whenever the Code Review or Retrospective
gate could not find evidence of a prior run, then ask the operator to
run `/sprint-code-review` or `/sprint-retro` separately and come back.
In practice operators always picked "run them now, then continue" —
the halt was pure friction.

The workflow now auto-invokes both skills inline:

- **Step 1.4 (new)** — Auto-invokes `/sprint-code-review [EPIC_ID]`.
  🔴 Critical Blockers halt; non-blocking findings are surfaced and
  the workflow continues. An `--skip-code-review` operator override
  bypasses the step entirely.
- **Step 1.5 (existing, revised)** — When the retrospective comment
  marker is missing on the Epic, the workflow now auto-invokes
  `/sprint-retro [EPIC_ID]` instead of stopping. After the retro runs
  the marker check is re-evaluated; persistent failure still halts.

- **Changed:** `.agents/workflows/sprint-close.md` — added Step 1.4
  (Code Review auto-invoke), revised Step 1.5 (Retro auto-invoke),
  updated "When to run" preamble and Constraints section.

### 🩺 Sprint Health ticket now closed alongside PRD/Tech Spec

The dispatcher creates a `📉 Sprint Health: <Epic title>` tracker issue
(labelled `type::health`) that is rewritten with live progress metrics on
every story close. `sprint-close.js` was only closing `context::prd` and
`context::tech-spec` children, so the Sprint Health ticket lingered as an
open child of a closed Epic and cluttered future project views.

The closure sweep in Step 8 now matches any ticket carrying the
`type::health` label **or** a title starting with `📉 Sprint Health:`, in
addition to the two existing context labels. All three are closed in the
same pass.

- **Changed:** `.agents/scripts/sprint-close.js` — the context-tickets
  filter now also matches `type::health` and the `📉 Sprint Health:`
  title prefix; progress log messages updated.
- **Changed:** `.agents/workflows/sprint-close.md` — Step 8 documents
  that Sprint Health tickets are closed alongside PRD/Tech Spec.

### 🧹 Stale-lock sweep for shared `.git/` dir

Parallel sprint agents use per-story worktrees, but the main repo's
`.git/` dir is still shared state — `git worktree add/remove/prune`,
`fetch`, auto-gc, and IDE git integrations all touch it. A crashed
orchestrator could leave an orphaned `.git/index.lock` that blocked the
next `/sprint-execute` run with a "another git process seems to be
running" error and required manual cleanup.

`WorktreeManager.sweepStaleLocks({ maxAgeMs = 30_000 })` now removes
well-known lock files (`index.lock`, `HEAD.lock`, `packed-refs.lock`,
`config.lock`, `shallow.lock`, plus per-worktree `index.lock` /
`HEAD.lock`) whose mtime exceeds the age threshold. Fresh locks —
belonging to a legitimate in-flight op — are skipped. The sweep runs
automatically at the start of `/sprint-execute`, immediately before
worktree GC.

- **Added:** `.agents/scripts/lib/worktree-manager.js` — new
  `sweepStaleLocks()` method with 30s default age threshold.
- **Changed:** `.agents/scripts/lib/orchestration/dispatch-engine.js` —
  `runWorktreeGc()` calls `sweepStaleLocks()` before `.gc()`.
- **Changed:** `.agents/workflows/worktree-lifecycle.md` — documents
  the sweep phase and the new method.

## [5.8.6] - 2026-04-15

### 🧹 Replace `risk::high` story PR creation with in-chat pause

The `risk::high` story-close gate used to branch-push and open a GitHub
PR, then exit non-zero. That created extra artifacts (a PR, a pushed
branch) and implied a long-running async review workflow. The intent of
the gate is simpler: stop and ask the human right now, in chat.

`sprint-story-close.js` now performs **zero** remote mutations for
risk::high stories — no PR, no branch push, no ticket comment, no label
change. It prints a three-option HITL prompt to stderr and exits
non-zero. The invoking `/sprint-execute` agent sees the non-zero exit,
halts the workflow, and relays the three options to the operator in
chat — then resumes based on the operator's reply.

Operator options (relayed in chat):

1. **Proceed with auto-merge** — remove the `risk::high` label on the
   Story, then re-run `sprint-story-close` for this story.
2. **Merge manually** — inspect the diff and merge by hand.
3. **Reject / rework** — leave the branch alone and open follow-up tasks.

- **Changed:** `.agents/scripts/sprint-story-close.js` —
  `handleHighRiskGate()` no longer calls `createPullRequest`, pushes the
  branch, or posts comments. Prints the HITL prompt to stderr and
  returns `action: 'paused-for-approval'`.
- **Changed:** `.agents/workflows/sprint-execute.md` — Step 3 now
  explicitly instructs the agent to stop and ask the operator in chat
  when the gate fires.
- **Changed:** `tests/sprint-story-orchestration.test.js` — risk::high
  test expects `paused-for-approval` instead of `pr-created` and
  verifies no comment was posted.
- **Changed:** `.agents/default-agentrc.json` — appended
  `style-guide.md` and `web-routes.md` to `docsContextFiles`; switched
  default `worktreeIsolation.nodeModulesStrategy` to `pnpm-store`.

## [5.8.5] - 2026-04-15

### 🧹 Narrow `risk::high` rubric and add HITL opt-out toggle

The `risk::high` rubric had drifted — 17 heuristics, most of which were
quality/style/instruction-authoring rules (e.g., "soft verification verbs
must be replaced with CLI commands", "theming updates must avoid hex
values"). These aren't *high-risk work*; they're decomposer prompt
guidance. Flagging them as `risk::high` caused the gate to fire on
routine stories, matching the stop the user reported.

The rubric is now restricted to 5 genuinely destructive/irreversible
categories:

1. Destructive or irreversible data mutations.
2. Shared security / auth infrastructure changes.
3. CI/CD, deployment, or release-gating changes that could ship
   unverified code.
4. Monorepo-wide parallel AST/text replacements on overlapping files.
5. Schema migrations that rewrite rows or drop columns without
   backfill/rollback.

Additionally, both HITL gates are now toggleable via
`orchestration.hitl.riskHighApproval` (default `true`, preserves current
behavior). When set to `false`, `risk::high` remains informational on
tickets but neither the task-dispatch gate
(`dispatch-engine.js:dispatchWave`) nor the story-close gate
(`sprint-story-close.js`) pauses execution. This lets teams that trust
the decomposer's judgement catch high-risk work at code review instead.

- **Changed:** `.agentrc.json` and `.agents/default-agentrc.json` —
  trimmed `agentSettings.riskGates.heuristics` from 17 → 5 items;
  added `orchestration.hitl.riskHighApproval` (default `true`).
- **Changed:** `.agents/scripts/lib/orchestration/dispatch-engine.js`
  `dispatchWave()` — honors `orchestration.hitl.riskHighApproval`.
- **Changed:** `.agents/scripts/sprint-story-close.js` — honors the
  same toggle before invoking the story-close risk gate.
- **Changed:** `.agents/instructions.md`, `.agents/SDLC.md`,
  `.agents/README.md` — updated HITL guidance to describe the toggle
  and the narrowed rubric.

## [5.8.4] - 2026-04-15

### 🧹 Enforce JIT story-branch and worktree creation in dispatch

Epic-level dispatch (`dispatch()` in `dispatch-engine.js`) was eagerly
creating story branches and per-story worktrees for every story whose
tasks appeared in the ready wave — even stories the operator hadn't
invoked `/sprint-execute` on yet. This surfaced as mysterious
`.worktrees/story-<id>/` directories and `story-<id>` branches for
stories that were still paper plans.

Story branches and worktrees are now created **exclusively** by
`sprint-story-init.js` (the script backing `/sprint-execute
#<storyId>`). `dispatchTaskInWave()` no longer calls
`worktreeManager.ensure()` or `ensureBranch()` for story-pattern
branches. Instead, when it encounters a task whose story branch/worktree
isn't yet initialized, it skips the task with
`status: 'skipped-not-initialized'` and logs an instruction to run
`/sprint-execute #<storyId>` to begin that story.

- **Changed:** `.agents/scripts/lib/orchestration/dispatch-engine.js`
  `dispatchTaskInWave()` — removed eager story worktree/branch creation;
  added initialization check that skips tasks when their story isn't
  live yet. Non-story task-level branches still get JIT-created at
  dispatch time (they have no separate init step).
- **Removed:** Windows long-path warning comment-post from
  `dispatch-engine.js`. `sprint-story-init.js` is now the single
  creation point and already emits this warning.

## [5.8.3] - 2026-04-15

### 🧹 Remove no-op "Live Integration Tests" CI job and its dead test

The `e2e` job in `.github/workflows/ci.yml` was a placeholder that ran
`npm ci` and echoed `"Placeholder for future E2E scripts against
sandbox"`. The actual test invocation was commented out and no
`test:e2e` script existed in `package.json`. The job provided zero
coverage while blocking the `publish` job and consuming CI minutes on
every run.

`tests/integration/parallel-sprint.test.js` was likewise dead — the
`npm test` script only globs `tests/*.test.js` and `tests/lib/*.test.js`,
so this 204-line integration test was never executed by any pathway.

- **Removed:** `e2e` job from `.github/workflows/ci.yml`.
- **Removed:** `needs: [validate, e2e]` → `needs: [validate]` on the
  `publish` job.
- **Removed:** `tests/integration/parallel-sprint.test.js`.

If we later want real live integration coverage against a sandbox repo,
we'll reintroduce it with a working `npm run test:e2e` script and a
non-placeholder CI step. Until then, this is clutter.

### 🧹 `techStack` moved from config to `docs/architecture.md`

Project-specific technology context (frameworks, database, auth, workspace
paths, etc.) no longer lives in `.agentrc.json`. It now lives under a
**Tech Stack** section in `docs/architecture.md` — one home for project
identity, outside the `.agents/` distribution bundle.

**Why:** The `techStack` block was never read by any script; it was
prose-referenced guidance. Stuffing opinionated stack defaults into
`.agents/default-agentrc.json` meant every new project inherited a
Hono + Cloudflare + Turso + Clerk + Astro + Expo template they had to
edit out. Architecture context belongs in architecture docs.

**Breaking (config shape):**

- **Removed:** `techStack` block from `.agentrc.json` and
  `.agents/default-agentrc.json`. Consumers should migrate the same
  content (or a slimmed version) into their own
  `docs/architecture.md` under a `## Tech Stack` heading.

**Docs updated to reference the new location:**

- `docs/architecture.md` — added a `## Tech Stack` section describing
  this repo's actual stack (Node.js + native test runner + Biome +
  Husky + Ajv + memfs + Stryker). Serves both as this project's spec
  and as the template example for downstream consumers.
- `.agents/instructions.md` — `techStack`-section reference replaced
  with a pointer to `docs/architecture.md`'s Tech Stack section.
- `.agents/README.md` — dropped `techStack.project.name` row from the
  config settings table.
- `AGENTS.md` — updated the Getting Started block.
- `.agents/personas/devops-engineer.md` — persona now points to the
  architecture-doc Tech Stack section and the `orchestration` block.
- `.agents/workflows/sync-agents-config.md` — removed stale
  `techStack.database` / `techStack.workspaces` examples.

## [5.8.2] - 2026-04-15

### 🧹 `agentSettings` audit & reorganization

Comprehensive audit of `agentSettings` in `.agentrc.json` /
`.agents/default-agentrc.json`. Removed dead fields, nested logically
related fields, reordered for readability, and raised the token budget
default to reflect modern model windows.

**Breaking (config shape):**

- **Renamed:** `agentSettings.roadmapPath` → `agentSettings.roadmap.path`.
  The nested shape matches `roadmap.autoGenerate` /
  `roadmap.excludeLabels`. `generate-roadmap.js`, workflow docs
  (`sprint-close.md`, `roadmap-sync.md`), and schema validation updated
  accordingly. Downstream consumers of `.agentrc.json` must update their
  key path.
- **Removed:** `agentSettings.autoRunSafeCommands` — never read by any
  code or workflow.
- **Removed:** `agentSettings.defaultPersona` — never read.
- **Removed:** `agentSettings.protocolRefinement` block — aspirational
  scheduling config for a feature that was never implemented.
- **Removed:** Stale `retroPath` default in `config-resolver.js` — left
  over from v5.8.0's retro-to-GitHub migration. Also fixed a stale
  `retroPath` reference in the Epic-complete summary comment emitted by
  `dispatch-engine.js`.

**Defaults changed:**

- **Bumped:** `maxTokenBudget` default `80000` → `200000`. 80k was
  already cramped for complex projects hydrating PRD + Tech Spec +
  architecture docs + task instructions; 200k matches the standard
  Claude/GPT window and leaves realistic headroom. Users on 1M-context
  models can raise further; users on cheaper models can lower.

**Reorganized field order** inside `agentSettings` (no behavior change):

1. Identity & roots — `baseBranch`, `*Root`, `tempRoot`,
   `auditOutputDir`
2. Docs & roadmap — `docsContextFiles`, `roadmap`
3. Lifecycle — `release`, `sprintClose`
4. Runtime caps — `maxInstructionSteps`, `maxTokenBudget`,
   `executionTimeoutMs`, `executionMaxBuffer`
5. Commands — `validationCommand`, `lintBaselineCommand`, etc.
6. Telemetry & safety — `verboseLogging`, `frictionThresholds`,
   `riskGates`

## [5.8.1] - 2026-04-15

### 🧹 Model selection simplified to a binary tier

Concrete model selection has been removed from the protocol. Stories now
carry a binary `model_tier` — `high` (deep-reasoning) or `low` (fast
execution) — derived solely from the `complexity::high` label. Picking a
specific model is left to the operator or an external router, which is
where that decision already belongs: models ship monthly, routers are
better placed to make runtime trade-offs, and the repo no longer needs to
track a moving list of model names.

- **Removed:** `agentSettings.defaultModels` (`planningFallback`,
  `fastFallback`) and `agentSettings.bookendRequirements` blocks from
  `.agentrc.json` and `.agents/default-agentrc.json`. Both were either
  dead (bookendRequirements was never read) or redundant with the binary
  tier signal.
- **Removed:** `resolveModel()` and `resolveRecommendedModel()` from
  `model-resolver.js`; the module now exports only `resolveModelTier()`.
  Returns `'high' | 'low'` (renamed from `'high' | 'fast'`).
- **Removed:** `Model` field from the `## Metadata` section of task
  tickets. No production code ever authored this field, so nothing
  breaks; the parser in `dependency-parser.js` no longer extracts it.
- **Removed:** `recommendedModel` property from story manifest entries
  and from the "Story Dispatch Table" (Markdown + CLI). The table now
  shows only `Model Tier`.
- **Removed:** `model` property from task dispatch payloads
  (`IExecutionAdapter.dispatchTask`) and from the manual adapter's
  dispatch printout.
- **Renamed:** `model_tier` enum value `'fast'` → `'low'` in the
  dispatch-manifest schema and throughout the codebase — matches the
  user-facing "execution mode: high vs low" framing.
- **Updated:** `.agents/workflows/sprint-retro.md`,
  `.agents/workflows/sprint-execute.md`, `.agents/SDLC.md`, and the
  `ticket-decomposer.js` header comment now reference the tier signal
  instead of specific model fallbacks.
- **Updated:** Tests (`dispatcher.test.js`, `manifest-renderer.test.js`,
  `dependency-parser.test.js`, `tests/lib/manifest-renderer.test.js`)
  refreshed for the new shape.
- **Removed:** Top-level `models` block (categories / chaining_guidance /
  finops_recommendations) from `.agentrc.json` and
  `.agents/default-agentrc.json`. Never read by code, named specific
  models that already ship monthly, and duplicated the tier guidance the
  label system now carries. `.agents/instructions.md` updated to describe
  the `high`/`low` tier signal directly instead of pointing at the deleted
  block.

## [5.8.0] - 2026-04-15

### 🧹 CI Auto-Heal removed

The `auto-heal.js` CLI, risk-tier resolver, Jules / GitHub Issue adapters,
prompt builder, `/ci-auto-heal` workflow, reference Actions template, and
the `autoHeal` config block have been removed. The feature shipped in
v5.3.0 was never wired into the active CI workflow and had no usage in
practice; dropping ~850 LOC + its config surface removes optional
complexity that wasn't paying for itself.

- **Removed:** `.agents/scripts/auto-heal.js` and
  `.agents/scripts/lib/auto-heal/` (index, prompt-builder, risk-resolver,
  jules-adapter, github-issue-adapter).
- **Removed:** `.agents/workflows/ci-auto-heal.md`,
  `.agents/templates/ci-auto-heal-job.yml`, and the generated
  `.claude/commands/ci-auto-heal.md`.
- **Removed:** `autoHeal` block from `.agentrc.json` and
  `.agents/default-agentrc.json`; `AUTO_HEAL_SCHEMA` /
  `getAutoHealValidator` from `lib/config-schema.js`;
  `autoHeal` field from the `config-resolver.js` resolved shape.
- **Updated:** `.agents/README.md` and `.agents/SDLC.md` sections
  referencing auto-heal removed.

### 🧹 `/sprint-execute` simplified to single-mode (Story-only)

`/sprint-execute` no longer accepts Epic IDs. Every invocation runs one
Story end-to-end: init → (ensure worktree) → implement tasks → validate
→ merge story→epic → reap worktree. Epic-level planning — waves,
recommended models, Story Dispatch Table — lives in `/sprint-plan` Phase 4
(unchanged) and is where the operator picks which stories to launch.

Rationale: the two-mode skill was hard to reason about, and the Epic
mode's dispatcher was never wired into the actual story execution agents
in practice. Splitting planning (Epic ID) from execution (Story ID) makes
the surface area match how operators were already using it.

- **Changed:** `.agents/workflows/sprint-execute.md` rewritten as a
  single-purpose worker skill. Mode A (Epic-level) removed. Frontmatter
  description updated to reflect the narrower contract.
- **Changed:** `.agents/scripts/sprint-story-init.js` now honors
  `orchestration.worktreeIsolation.enabled`. When enabled it seeds the
  story branch ref in the main checkout (without moving HEAD) and calls
  `WorktreeManager.ensure` to produce `.worktrees/story-<id>/`. The
  returned JSON exposes `workCwd`, `worktreeEnabled`, and
  `worktreeCreated` so the agent knows where to `cd`.
- **Changed:** The worker flow instructs the agent to `cd` into
  `workCwd` before Step 1 and to pass `--cwd <main-repo>` when invoking
  `sprint-story-close.js`, so the story→epic merge runs in the main repo
  (branches checked out in a worktree cannot be deleted from within
  themselves).
- **Unchanged:** `sprint-story-close.js` already reaped worktrees on
  successful merge (v5.7.0). The existing reap path is the close hook.
- **Unchanged:** Single-tree fallback (`worktreeIsolation.enabled:
  false`) follows the v5.5.1 bootstrap path — same assertions, same
  guards.
- **Deprecated (not yet removed):** `dispatcher.js` agent-launch loop,
  `IExecutionAdapter`, Jules/queue adapter plumbing, and story-wave
  execution tests are now orphaned by the skill change. They remain in
  the repo for one release so downstream consumers can migrate; a
  follow-up will delete them.

### 🪞 Retros move to GitHub Epic comments + `runRetro` toggle

Retros are no longer written to `docs/retros/retro-epic-<id>.md`. Every
retro is now posted as a structured comment on the Epic issue, greppable
via `gh api repos/{owner}/{repo}/issues/<id>/comments`. The comment
begins with a `## 🪞 Sprint Retrospective — Epic #<id>` marker heading
that `/sprint-close`'s Retrospective Gate uses to verify a retro ran.

A new `agentSettings.sprintClose.runRetro` boolean (default `true`)
controls whether `/sprint-close` enforces the retro gate. Set to `false`
to skip the retro phase entirely on close.

- **New:** `agentSettings.sprintClose.runRetro` — boolean toggle (default
  `true`). Added to `AGENT_SETTINGS_SCHEMA` in
  [config-schema.js](.agents/scripts/lib/config-schema.js); rejects
  unknown keys under `sprintClose`.
- **Removed:** `agentSettings.retroPath` and the `retroPath` pattern in
  the agent-settings schema. `.agentrc.json` and
  `.agents/default-agentrc.json` ship `sprintClose: { runRetro: true }`
  in its place.
- **Changed:** [.agents/workflows/sprint-retro.md](.agents/workflows/sprint-retro.md)
  rewritten — drops the file-write step; posts the retro body as a
  typed comment on the Epic (`notify.js --type retro` or
  `provider.postComment(epicId, { type: 'retro' })`). On network
  failure the body is dumped to `temp/retro-epic-<id>.md` as a recovery
  aid only.
- **Changed:** [.agents/workflows/sprint-close.md](.agents/workflows/sprint-close.md)
  Step 1.5 honors `[RUN_RETRO]` and, when enabled, queries the Epic
  comment thread for the marker heading instead of testing a local
  path.
- **Migration:** none required. Existing files under `docs/retros/`
  remain in git history; new retros post to GitHub.

### 📝 Config defaults

- `.agentrc.json` and `.agents/default-agentrc.json` now ship with
  `orchestration.worktreeIsolation.enabled: true` by default, so
  `/sprint-execute <StoryID>` produces `.worktrees/story-<id>/` out of
  the box. Set `enabled: false` to opt back into single-tree mode.
- `.agentrc.json` and `.agents/default-agentrc.json` now ship with
  `agentSettings.sprintClose.runRetro: true` (replacing `retroPath`).

## [5.7.0] - 2026-04-15

### 🧵 Worktree-per-story isolation (Epic #229)

Parallel sprint execution now runs each dispatched story in its own
`git worktree` at `.worktrees/story-<id>/`. The main checkout stays
quiet during a parallel sprint — branch swaps, staging operations, and
reflog activity are isolated per-story. Fixes the 2026-04-14 incident
where five concurrent agents raced on the main checkout's HEAD and
cross-contaminated a commit.

- **New:** `.agents/scripts/lib/worktree-manager.js` — single authority
  over per-story worktrees. Owns `ensure`, `reap`, `list`,
  `isSafeToRemove`, `gc`. Refuses `--force`. Argv-based git calls with
  `storyId` / `branch` validation.
- **New:** `orchestration.worktreeIsolation` config block — `enabled`,
  `root`, `nodeModulesStrategy`
  (`per-worktree` | `symlink` | `pnpm-store`), `primeFromPath`,
  `allowSymlinkOnWindows`, `reapOnSuccess`, `reapOnCancel`,
  `warnOnUncommittedOnReap`, `windowsPathLengthWarnThreshold`.
  Validated by ajv; path-traversal guard rejects `root` outside the
  repo root.
- **New:** `--cwd` flag and `AGENT_WORKTREE_ROOT` env precedence on
  `sprint-story-init`, `sprint-story-close`, and `assert-branch`. All
  git operations route through the resolved cwd so hook scripts inside
  a worktree guard that worktree's HEAD, not the main checkout's.
- **New:** `.agents/scripts/lib/git-branch-lifecycle.js` — shared
  branch state machine (`branchExistsLocally`,
  `branchExistsRemotely`, `ensureEpicBranch`, `checkoutStoryBranch`,
  `ensureLocalBranch`). Consumed by both `sprint-story-init` and
  `dispatch-engine`.
- **New:** `gitFetchWithRetry` — bounded retry (250/500/1000 ms) on
  known packed-refs lock-contention signatures only. Unrelated fetch
  failures surface immediately.
- **New:** `.agents/workflows/worktree-lifecycle.md` — operator and
  reviewer reference covering config, lifecycle, node_modules
  strategies, Windows long-path handling, the single-tree fallback,
  and escape hatches.
- **Dispatcher integration:** `dispatch()` constructs a
  `WorktreeManager` when isolation is enabled and non-dry-run; threads
  the worktree path as `cwd` through `IExecutionAdapter.dispatchTask`.
  `ManualDispatchAdapter` prints a `cd "<path>"` instruction when
  `cwd` is set.
- **Reap-on-merge + gc-on-start:** `sprint-story-close` reaps the
  story's worktree after a successful merge; `dispatch()` runs a GC
  sweep on start, reaping orphaned worktrees whose stories have no
  remaining live tasks (refuses to delete dirty trees).
- **Windows notes:** `core.longpaths=true` is set on each new
  worktree; pre-flight path-length warning posted to the Epic issue
  when the estimated deepest path exceeds the configured threshold.

### ⚡ Performance

- **Per-instance ticket memoization** on `GitHubProvider.getTicket`
  with `primeTicketCache` / `invalidateTicket`. Dispatcher and
  `sprint-story-close` prime the cache from their initial bulk fetches
  so cascade / transition / reconciler share a single round-trip.
  `generateAndSaveManifest` accepts an injected provider so dashboard
  regeneration after a merge costs zero extra REST calls.
- **Batched VerboseLogger.** Entries buffer until 50 rows / 1000 ms /
  `process.exit` / explicit `flush()`. `fs.appendFileSync` per line
  was O(n) syscalls; on NTFS this alone added seconds to busy
  dispatches.
- **`isSafeToRemove`** collapsed from `show-ref` + `merge-base` +
  `rev-parse` to a single `git merge-base --is-ancestor` probe. ~40%
  fewer git subprocess spawns during GC sweeps.
- **Context-hydration file cache.** Agent-protocol template, persona
  files, and skill files are memoized by absolute path for the
  lifetime of the process (`__resetContextCache()` for tests).
- **Pre-compiled task-metadata regexes** at module load instead of
  per-task.

### 🧹 Clean code

- **`dispatch()`** split into step helpers (`resolveDispatchContext`,
  `fetchEpicContext`, `reconcileEpicState`, `buildDispatchGraph`,
  `ensureEpicScaffolding`, `runWorktreeGc`, `dispatchNextWave`).
  Orchestrator shrinks from 184 LOC to ~40 LOC of readable flow.
- **`runStoryClose`** split into `reapStoryWorktree`,
  `notifyStoryComplete`, `updateHealth`, `refreshDashboard`,
  `cleanupTempFiles`. Each phase is individually testable and logs
  non-fatal failures via `Logger.error` instead of bare
  `console.error`.
- **Logger gains `debug()` and `error()`** methods. `debug` is gated
  behind `AGENT_LOG_LEVEL=debug`. Fixes a pre-existing `Logger.error`
  call that would have TypeError'd on the refinement-service failure
  path.
- **Silent failures fixed.** `sprint-story-init` topological-sort
  failure now throws with context instead of silently returning an
  unordered task list. `github-refinement-service` logs cleanup
  failure at debug level instead of `catch {}`.
- **Over-defensive `(t.labels ?? [])` guards removed** on
  provider-sourced tickets — `ITicketingProvider` guarantees
  `labels: string[]`.
- **Error-handling convention** documented in `.agents/README.md`.
- **Dead code:** `buildStoryManifest` is no longer exported (still
  used internally); `resetContextCache` renamed `__resetContextCache`
  to match the project's test-seam convention.

### 📚 Docs

- `.agents/workflows/worktree-lifecycle.md` — new operator reference.
- `.agents/workflows/sprint-execute.md` — cross-ref to the worktree
  doc.
- `.agents/SDLC.md` — note about per-story worktrees in the context-
  hydration section.
- `.agents/README.md` — new "Error-Handling Convention" section.

### 🧪 Tests

- New `tests/integration/parallel-sprint.test.js` — real-git
  integration proving AC6 (no WIP cross-contamination across five
  concurrent stories) and AC7 (main-checkout reflog stays quiet).
- New `tests/lib/worktree-manager.test.js` — 25 cases covering
  `ensure`/`reap`/`gc`/`isSafeToRemove` semantics, node_modules
  strategies, and Windows long-path warnings.
- New `tests/lib/dispatcher-worktree.test.js` — gc safety
  (`collectOpenStoryIds`) + `ManualDispatchAdapter` `cwd` output.
- New `tests/lib/git-fetch-retry.test.js` — bounded retry behavior
  with scripted spawn mocks and an injected `__setSleep` seam.
- New batched-writer tests in `tests/lib/verbose-logger.test.js`.
- New provider memoization tests in
  `tests/lib/github-provider.test.js`.

## [5.6.0] - 2026-04-14

### 🧹 Planning pipeline — host LLM authors PRD / Tech Spec / tickets

Removed the standalone external-LLM dependency from the planning scripts. The
host LLM driving the harness now authors planning artifacts directly, and the
Node scripts become deterministic GitHub I/O wrappers. PRD and Tech Spec are
still persisted as linked GitHub issues under the Epic (unchanged); only the
authoring step has moved in-process.

- **Removed:** `.agents/scripts/lib/llm-client.js` and its test. No more
  `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` usage anywhere
  in the repo.
- **`epic-planner.js` has two modes.**
  - `--emit-context` prints a JSON envelope (epic body, scraped project docs,
    recommended PRD/Tech-Spec system prompts) to stdout for the host LLM.
  - Default mode takes `--prd <file> --techspec <file>` and creates the two
    planning issues exactly as before, preserving all state-healing behavior.
- **`ticket-decomposer.js` has two modes.**
  - `--emit-context` prints PRD/Tech-Spec bodies, risk heuristics, the
    decomposer system prompt, and the 25-ticket cap.
  - Default mode takes `--tickets <file>` (a JSON array) and
    validates + creates Feature/Story/Task issues exactly as before.
- **Config:** removed the `orchestration.llm` block from `.agentrc.json` and
  `default-agentrc.json`, and removed the `llm` property from the orchestration
  JSON Schema in `config-schema.js`.
- **`.env.example`:** removed all three LLM provider key entries.
- **Workflow:** `sprint-plan.md` rewritten for the new two-phase flow — the
  host LLM calls `--emit-context`, authors the artifacts locally, then hands
  the files back to the script for persistence.
- **Tests:** `epic-planner.test.js` and `ticket-decomposer.test.js` rewritten
  to cover both context-emission helpers and the content-in / issues-out
  pipeline. `llm-client.test.js` removed.

## [5.5.3] - 2026-04-14

### 🛡️ Planning Hardening — close every silent task-drop path

Follow-up investigation on the zero-task-Story incident turned up three
additional places where Tasks could be silently dropped between the LLM
output and GitHub issue creation. Every one of them has been converted from
"silently continue" to either "throw" or "warn loudly":

- **Duplicate slug detection (validator).** The validator built a
  `ticketBySlug` map with `Map.set()`, which silently overwrote earlier
  tickets when the LLM emitted two tickets with the same `slug`. Since
  parent lookups then resolve to the wrong ticket, a Task could end up
  attached to the wrong Story (or lost entirely after sorting). The
  validator now throws
  `Cross-Validation Failed: Duplicate slug "X" — slugs must be unique ...`
  and names both colliding titles.
- **Unresolved `parent_slug` (decomposer).** `ticket-decomposer.js` used to
  default to the Epic ID when a Story or Task's `parent_slug` was missing
  from `slugMap`. That silently orphaned tickets directly under the Epic
  instead of their intended parent. The decomposer now throws for any
  Story/Task without a `parent_slug` or whose `parent_slug` points at a
  ticket that was never created. Features continue to attach directly to
  the Epic as before.
- **Unresolved `depends_on` entries (decomposer).** Dependency resolution
  used `.map(slugMap.get).filter(Boolean)`, which silently discarded any
  slug that did not resolve — breaking the DAG without diagnostics. The
  decomposer now emits a warning per unresolved dependency identifying the
  owning ticket and the missing slug.
- **LLM truncation heuristic.** The decomposer prompt caps generation at
  25 tickets. When the LLM bumps against that cap it often emits a
  syntactically-valid-but-truncated backlog. The decomposer now warns when
  the response has 25+ tickets so operators can split the Epic or verify
  every Story still has children before the plan goes to GitHub.
- **Array-shape guard.** `JSON.parse` now also checks that the result is an
  array; a non-array LLM response is rejected with a clear error instead
  of crashing downstream when something tries to iterate it.
- **Test:** New `fails on duplicate slug` case in
  `tests/ticket-validation.test.js` locks in the duplicate-slug invariant.

### 🛡️ Planning Hardening — reject Stories with zero child Tasks

Real-world `/sprint-plan` runs occasionally produced Stories that were pushed
to GitHub with **no child Tasks**, leaving empty container issues that could
not be dispatched or executed. Root cause: the LLM decomposer could emit a
Story ticket (typically when its output was truncated or when it lazily
created a Story shell intending to add tasks later) and the validator only
enforced hierarchy (`story.parent_slug → feature`,
`task.parent_slug → story`) without checking per-Story task cardinality.

**Fixes:**

- **`ticket-validator.js`: per-Story task-count invariant.** After hierarchy
  validation, the validator now builds a
  `taskCountByStory` map from the Tasks array and throws
  `Cross-Validation Failed: N Story/Stories have no child Tasks: ...` listing
  every offending Story by title and slug. This runs before any GitHub
  issues are created, so the problem is caught at plan time rather than
  after tickets exist.
- **`decomposer-prompts.js`: mandatory cardinality clause.** The system
  prompt now explicitly states that every Story MUST decompose into at
  least one Task (typically 2–5), and that a Story too small for its own
  Task must be merged back into a sibling Story instead of emitting an
  empty container. This reduces the failure rate at the source in addition
  to the hard post-condition in the validator.
- **Tests:** Two new cases in `tests/ticket-validation.test.js` lock in the
  invariant — one asserting the single-empty-Story failure path, one
  asserting that multiple empty Stories are reported in a single aggregated
  error. Two existing tests (`detects cycles`, `keeps cross-story deps on
  non-task tickets`) were updated to give every Story a child Task so they
  continue to test their intended behavior.

## [5.5.2] - 2026-04-14

### 🧹 `.agents/` Consolidation Pass

- **Schemas:** Removed obsolete `schemas/dispatch-manifest.schema.json`
  (superseded by `dispatch-manifest.json`; nothing referenced it). Renamed
  `schemas/audit-rules.json` → `schemas/audit-rules.schema.json` for suffix
  consistency with the other `*.schema.json` files; all MCP tools, tests, and
  SDLC docs were updated.
- **Stack skills:** Pruned ~23 empty `examples/`, `resources/`, `scripts/`
  stub subdirectories (with their `.gitkeep` markers) from `skills/stack/`.
  Only subdirectories containing actual companion files remain
  (`cloudflare-hono-architect/examples/route-template.ts`,
  `sqlite-drizzle-expert/examples/schema-template.ts`,
  `stripe-integration/scripts/listen-stripe.sh`).
- **Skill merges:** Consolidated `stripe-payments` + `stripe-billing-expert`
  into a single `backend/stripe-integration` skill covering PCI, webhooks,
  and idempotency in one place. Consolidated `backend/clerk-auth` +
  `security/secure-telemetry-logger` into `security/backend-security-patterns`,
  which pairs Clerk auth guidance with PII-safe telemetry rules.
- **README:** Stack skill table and skill count (20) updated to reflect the
  merged skills; VERSION pointer refreshed.

Stack skill count: 22 → 20. Net files removed: ~30 (including `.gitkeep`
markers). No behavior changes to scripts, workflows, or MCP tools.

## [5.5.1] - 2026-04-14

### 🧠 Planning Hardening (parallel-story contention)

- **`computeStoryWaves`: focus-area overlap serialization.** The planner
  previously grouped stories into waves using only cross-task dependencies
  and explicit `blocked by` declarations on story tickets. Stories with no
  dependency edge but overlapping target directories (e.g. five stories all
  editing `apps/api/src/routes/v1/media/`) would land in the same wave and
  race at runtime. `computeStoryWaves` now rolls task-level `focusAreas` up
  to the story, compares pairwise, and adds a deterministic ordering edge
  (lower storyId → higher storyId) whenever two stories overlap and are not
  already ordered. Stories with no declared focus areas are left alone to
  prevent over-serialization. Global-scope stories (any child task with
  `scope === 'root'` or a `*` focus area) serialize after every other
  story. A new `__test` seam exposes `rollUpStoryFocus` and
  `addFocusOverlapEdges` for unit testing. Epic #229 tracks the broader
  architectural fix (worktree-per-story isolation) for future consideration.

### 🐛 Bug Fixes

- **`sprint-story-init`: tri-state Epic branch bootstrap.** The old
  `bootstrapBranch` only inspected `ls-remote` for the Epic branch. If
  `epic/<id>` already existed **locally** (e.g. from a prior partial init or a
  parallel story that bootstrapped it seconds earlier) but not remotely, the
  script took the "doesn't exist" path and ran `git checkout -b epic/<id>`,
  which fails because the local branch already exists. The new logic checks
  local (`git rev-parse --verify refs/heads/<branch>`) and remote
  (`ls-remote`) independently and handles all four states correctly. A
  dirty-working-tree guard (`assertWorkingTreeClean`) now runs before any
  branch switch, so an in-progress session from another agent is detected and
  halts the init rather than being silently overwritten. The Story-branch
  checkout is also non-destructive when the branch already exists (no more
  unconditional `checkout -B`).

### 🛡️ Workflow Hardening (parallel-story contention)

- **`assert-branch.js`: pre-commit branch guard.** New script
  (`.agents/scripts/assert-branch.js --expected <branch>`) that verifies
  `git branch --show-current` matches the expected branch and exits non-zero
  otherwise. Intended to be invoked immediately before every `git add`/
  `git commit` in shared-working-tree sprint workflows so a concurrent
  `git checkout` by another agent cannot result in a commit to the wrong
  branch.

- **`git add .` → explicit staging** in every sprint-time workflow
  (`sprint-execute.md`, `sprint-hotfix.md`, `sprint-close.md` version-bump,
  `sprint-code-review.md` remediation). `git add .` sweeps untracked files
  sitting in the working directory, which under parallel execution may belong
  to another agent. Workflows now prescribe explicit paths (or `git add -u`
  for tracked-edit-only commits) and a prior `assert-branch.js` call. The
  generic `git-commit-all.md` and `git-push.md` workflows now carry an
  explicit warning not to be used inside `/sprint-execute #<storyId>`.

- **Root cause traced to a multi-story sprint on 2026-04-14** where five
  parallel story agents shared one working tree: within seconds the HEAD
  swapped through `epic/267 → story-329 → story-307 → story-302 → story-304`,
  and a `git add -A && git commit` intended for `story-329` ran while the
  working dir was on `story-304`, sweeping a foreign WIP file into the
  commit. These fixes close the two specific failure modes that made the
  contention harmful; a larger worktree-per-story change is tracked
  separately.

### 🧪 Tests

- 10 new tests: `assert-branch` (4 cases), `sprint-story-init` tri-state
  epic bootstrap (reproduces the #329 crash with `epic/<id>` local-only),
  dirty-working-tree refusal, and 7 `computeStoryWaves` cases covering
  focus-overlap serialization, disjoint-areas, missing focus data,
  global-scope, redundant-edge avoidance, a five-way contention regression
  test, and `rollUpStoryFocus` rollup. Total: 422 passing (up from 412).

## [5.5.0] - 2026-04-14

### ✨ New Features

- **`retroPath`: Configurable Retrospective Output Location** — Added a new `agentSettings.retroPath` config key (default: `docs/retros/retro-epic-{epicId}.md`) that controls where `/sprint-retro` writes its output. The `{epicId}` token is substituted at runtime. Registered in `config-schema.js`, defaulted in `config-resolver.js`, and surfaced in both `.agentrc.json` and `default-agentrc.json`. The `sprint-retro` workflow now resolves `[RETRO_PATH]` in Step 0 and uses it in the document-generation, commit, and Epic-comment steps.

### 🛡️ Workflow Hardening

- **`sprint-close`: Retrospective Gate (Step 1.5)** — Added a mandatory pre-merge check that halts `/sprint-close` when the retrospective document does not exist at `[RETRO_PATH]`. Previously, `/sprint-retro` could be silently skipped because the dispatcher's Bookend Lifecycle only _announced_ the phases without executing them, and nothing downstream verified the retro had run. The new gate forces operators to invoke `/sprint-retro [EPIC_ID]` before the Epic can close.

- **Dispatcher Epic-Complete Comment: Explicit Next Actions** — Rewrote the `detectEpicCompletion` summary comment in `dispatcher.js` to list the four bookend slash commands (`/audit-quality`, `/sprint-code-review`, `/sprint-retro`, `/sprint-close`) with their Epic ID pre-filled, and explicitly warns that skipping `/sprint-retro` will trip the new close-time Retrospective Gate. This replaces the previous vague "will now execute sequentially" wording that implied automation the dispatcher does not perform.

### ♻️ Clean-Code Refactor (audit-driven)

The following changes implement the recommendations from the `/audit-clean-code` report. All are behaviour-preserving refactors verified by 408 passing tests (up from 381) and the maintainability baseline.

- **`lib/cli-utils.js`: shared `runAsCli()` entry-point helper.** Replaces 15 duplicated main-guard + error-handling blocks across the CLI scripts. Callers pass `import.meta.url`, a main function, and an options bag (`source`, `exitCode`, `onError`) for scripts with non-standard failure semantics (e.g. `auto-heal` exits 0 on any failure to never block CI).

- **`lib/story-lifecycle.js`: shared Story helpers.** Extracts `resolveStoryHierarchy()`, `fetchChildTasks()`, and `batchTransitionTickets()` used by both `sprint-story-init.js` and `sprint-story-close.js`, removing ~40 LOC of mirrored plumbing. Branch bootstrap, merge, and notification concerns remain CLI-owned — those are genuinely different between the two scripts and do not belong in a shared module.

- **`providers/github-http-client.js`: testable HTTP transport.** Extracts `fetch-with-retry`, REST wrapper, REST pagination, and GraphQL wrapper from the 899-LOC `GitHubProvider` god object. The client accepts an injectable `fetchImpl` and a `tokenProvider` closure so unit tests no longer need to mutate `global.fetch`. The provider composes the client via `this._http`; the four underscored transport methods remain as thin proxies so all existing call sites and tests continue to work unchanged.

- **`GitHubProvider._updateLabels()`: extracted from `updateTicket()`.** Separates the three implicit label-handling paths (add-only fast-path, remove-merge-PATCH, combined PATCH) into one named helper returning `{ skipPatch, mergedLabels? }`. Behaviour preserved exactly.

- **Silent catches in `providers/github.js`: replaced with `console.warn`.** Five catch blocks (sub-issue GraphQL fallback, reverse dependency lookup, sub-issue linking, ProjectV2 user-scope and org-scope lookups) previously swallowed errors for optional features. Each now emits a structured warning so API regressions become visible. Fallback control flow is preserved.

- **`lib/orchestration/dispatcher.js` → `dispatch-engine.js` (SDK rename).** The codebase previously had two files named `dispatcher.js` — a thin CLI wrapper and a 575-LOC SDK engine — same name, different purpose. Renamed the SDK files (`dispatcher.js` → `dispatch-engine.js`, `context-hydrator.js` → `context-hydration-engine.js`) while leaving the CLI entry points untouched. `dispatch()` itself was decomposed into three helpers — `handleRiskHighGate`, `dispatchTaskInWave`, and `dispatchWave` — replacing a 100-line 5-level-nested inline loop.

- **Deferred module-level side effects.** `lib/config-resolver.js` no longer calls `loadEnv()` at module scope; it runs lazily on first `resolveConfig()` call. `lib/orchestration/dispatch-engine.js` no longer resolves config or initialises `VerboseLogger` at module scope; a lazy `vlog` Proxy keeps all existing `vlog.info(...)` call sites unchanged. Importing either module no longer mutates process state.

- **Consolidated `SHELL_INJECTION_RE`.** Previously duplicated across `config-schema.js` and `config-resolver.js` with subtly different patterns. Both regexes now live in `config-schema.js` under distinct names (`SHELL_INJECTION_RE` for schema-validated paths/commands, `SHELL_INJECTION_RE_STRICT` for orchestration runtime values) with documented intent.

- **Removed orphan "Refinement Loop" cluster.** `lib/refinement-agent.js`, `lib/friction-service.js`, and `lib/impact-tracker.js` had zero non-test consumers after verification — they only imported each other. Deleted (~300 LOC removed). Git history preserves them if the feature is revived.

- **Trimmed redundant `node:coverage ignore` directives** from the four HTTP transport proxies in `GitHubProvider` (now trivial delegations) and a duplicated pair on `ensureProjectFields()`. Directives on genuinely environment-dependent paths are retained.

- **New tests (27 added):** `cli-utils` (8), `story-lifecycle` (10), `github-http-client` (6), `_updateLabels` fast/merge/combined paths (3).

## [5.4.6] - 2026-04-14

### 🐛 Bug Fixes

- **`sprint-close`: Explicit Skip for `autoVersionBump: false`** — Added an explicit guard at the top of Step 3 (Version Bump & Tag) instructing the agent to skip the entire step when `release.autoVersionBump` is `false`. Previously the conditional only described the `true` path, which could cause agents to attempt a version bump even when the setting was disabled.

## [5.4.5] - 2026-04-13

### ✨ New Features

- **`auditOutputDir`: Configurable Audit Report Destination** — Audit workflow result files are now written to a configurable directory instead of the project root. Set `agentSettings.auditOutputDir` in `.agentrc.json` to control the output path (default: `temp`). All 12 audit workflows use a `{{auditOutputDir}}` placeholder that `runAuditSuite` resolves at runtime from the config.

### 🐛 Bug Fixes

- **`sprint-story-close`: Webhook on Story-Complete** — Added `actionRequired: true` to the story-complete notification payload so the webhook in `notify.js` fires when a story closes, ensuring operators receive push notifications in addition to GitHub issue comments.

## [5.4.4] - 2026-04-12

### ✨ New Features

- **`roadmap-sync`: Human-Readable Timestamps** — Updated the roadmap generator to use localized, human-readable date strings for the "Last synced" field, improving readability for operators.

### 🛡️ Workflow Hardening

- **`sprint-close`: Resilient Branch Cleanup** — `sprint-close.js` now runs `git stash clear`
  before branch deletion to drop any leftover working-tree stashes that could block
  the cleanup. Each remote branch deletion is individually wrapped in a try/catch so
  a single failure (e.g., "branch not found" on Windows/PowerShell) no longer aborts
  the entire cleanup pass. The `sprint-close.md` workflow has been updated with an
  explicit **Step 8.5 — Pre-Cleanup Stash Clear** and PowerShell-aware error-handling
  guidance.

- **`update-roadmap.yml`: Robust CI Push** — Automated commits in the roadmap CI
  workflow now always perform a `git pull --rebase` before pushing to gracefully
  handle high-velocity race conditions between concurrent AI agent runs and the CI
  pipeline. _(Implementation already applied in the consuming repo; this entry
  documents the protocol-level recommendation for all consumers.)_

## [5.4.3] - 2026-04-12

### ✨ New Features

- **`sprint-story-close`: Automated Story Completion Notifications** — Implemented an INFO-level notification system that @mentions the operator on the Epic ticket when a story is successfully merged. This closes the feedback loop and unblocks the operator for immediate wave review as defined in the SDLC.md.

## [5.4.2] - 2026-04-12

### 🐛 Bug Fixes

- **`sprint-story-close`: Commitlint `subject-case` violation** — The merge commit
  message in `finalizeMerge()` now lowercases the first character of `storyTitle`
  before interpolating it into the `feat: <title> (resolves #N)` string. This
  prevents commit-lint failures caused by GitHub issue titles being sentence-cased
  (e.g., "Add 'bio' field..." becomes "feat: add 'bio' field...").

- **`sprint-story-close`: Dispatch manifest never updated after story close** — The
  dashboard refresh was previously gated behind an opt-in `--refresh-dashboard` CLI
  flag, so the Epic-level dispatch manifest (`temp/dispatch-manifest-<epicId>.md/json`)
  was never regenerated in practice, leaving progress at 0% after stories completed.
  Fixed by inverting the default: the manifest now regenerates automatically unless
  `--skip-dashboard` is explicitly passed. Updated the corresponding `cli-args.js`
  option and the `workflows/sprint-execute.md` Step 3 documentation to reflect the
  new opt-out behaviour.

- **`sprint-story-close`: Ephemeral story manifest files not cleaned up** — After a
  successful story merge and branch deletion, the script now attempts to delete
  `temp/story-manifest-<storyId>.md` and `temp/story-manifest-<storyId>.json`. These
  working files are created by the dispatcher when resolving story-level execution
  plans and should not persist beyond the story's lifetime. Errors during deletion
  are non-fatal and logged as warnings.

## [5.4.1] - 2026-04-12

### 🛡️ Workflow Hardening

*   **Enforced Quality Gates:** Removed the `--no-verify` flag from the `/git-commit-all` workflow to ensure all pre-commit hooks (linting, formatting, testing) are strictly enforced during automated commits.
*   **New Git Push Workflow:** Introduced the `/git-push` workflow that stages, commits, and pushes changes while strictly prohibiting hook bypass. This ensures that all code pushed to remote repositories has passed the local quality baseline.
*   **Protocol Documentation Sync:** Updated `SDLC.md` and `README.md` to include references to the newly implemented Git utility workflows.

## [5.4.0] - 2026-04-12

### 🚀 Performance & Scalability (Epic 227)

*   **Parallel Execution Engine:** Optimized deep SDLC operations by transitioning sequential loops to `Promise.all` parallelization. Affected areas include task status transitions (#217), nested ticket closure cascades (#218, #222), and the multi-step audit suite orchestrator (#225).
*   **Asynchronous I/O Migration:** Refactored project documentation scraping and file traversal logic to use non-blocking `fs.promises` (#219).
*   **Graph Optimization:** Implementation of high-efficiency topological sort for complex ticket dependency trees, reducing wait-times in large Epics (#220).
*   **Logical Refinements:** Streamlined parent-child completion cascades (#221) and optimized array processing filters in internal PR refinement helpers using `reduce` (#226).

### ✨ New Workflows

*   **Batch Merge Support:** Enhanced `/git-merge-pr` to accept multiple pull request numbers at once, enabling coordinated atomic deployments of related features.

### ♻️ Refactors

*   **Audit Suite — Workflow-First Execution:** Eliminated the `.agents/scripts/audits/` script directory entirely. `run-audit-suite.js` now resolves the corresponding `.agents/workflows/<auditName>.md` file for each requested audit and returns its markdown content as a structured result. The calling AI agent executes the workflow as a prompt-driven analysis — no separate Node.js scripts required.

### 🛡️ Workflow Hardening

*   **Robust Remote Cleanup:** Re-engineered branch deletion in the merge workflow with a two-stage strategy: attempts standard `git push --delete` first, with an automatic fallback to the **GitHub REST API via credential extraction**. This ensures remote branches are successfully pruned even when local Husky pre-push hooks block git-based deletions.

## [5.3.0] - 2026-04-11

### ✨ New Features

*   **CI Auto-Heal Pipeline:** Extracted the autonomous self-remediation engine into the core framework. Included a governance-tiered risk model that resolves "Green/Yellow/Red" tiers based on failed CI stages.
*   **Auto-Heal CLI:** Added `auto-heal.js`, a best-effort CLI utility that assembles AI prompts from CI logs and dispatches them to specialized adapters without failing the CI pipeline.

### 📦 Library

*   **Risk Resolver:** Implemented pure-function governance logic to determine modification constraints and auto-approval eligibility.
*   **Prompt Builder:** Created an assembly engine with intelligent log collection, truncation, and context hydration from the GitHub graph.
*   **Adapters:** Introduced the `IAutoHealAdapter` interface with two initial implementations:
    *   **JulesAdapter:** Direct integration with the Jules API v1alpha.
    *   **GitHubIssueAdapter:** Fallback orchestration via labeled GitHub Issues and optional Copilot Workspace assignment.

### ⚙️ Infrastructure

*   **Config Validation:** Updated `config-schema.js` and `config-resolver.js` to support the new `autoHeal` configuration block with full AJV validation.
*   **Workflows & Templates:** Added the `/ci-auto-heal` slash-command workflow and a reference `ci-auto-heal-job.yml` GitHub Actions template.

## [5.2.3] - 2026-04-11

### ✨ New Workflows

*   **Automated PR Merging:** Added the `/git-merge-pr` workflow for automated analysis, conflict resolution, quality validation (lint/test), and merging of pull requests.

### ♻️ Refactors

*   **GitHub Provider Logic:** Extracted duplicate Epic fetch and mapping logic in `GitHubProvider` into a private helper method `_getEpics`, improving maintainability and ensuring consistency between `listIssues` and `getEpics`.

## [5.2.2] - 2026-04-10

### 🐛 Bug Fixes

*   **GitHub Provider Fix:** Corrected a bug in the `ensureProjectFields` method implementation in the GitHub configuration layer. Fixed the signature to cleanly expect `fieldDefs` (resolving an unused `_ticketId` parameter issue), which fixes a referential error in loops accessing the project fields array during agent-protocol bootstrap execution.

## [5.2.1] - 2026-04-10

### 🚀 Orchestration Enhancements

*   **Cross-Owner Project Support:** Introduced the optional `projectOwner` configuration field for GitHub orchestration. This allows repository issues and PRs to be managed on a Project V2 board owned by a different organization or user, decoupling the repository owner from the project board host.
*   **Default-to-Owner Logic:** Implemented fallback logic in the `GitHubProvider` where `projectOwner` defaults to the repository `owner` if omitted, ensuring full backward compatibility for existing single-owner configurations.

## [5.2.0] - 2026-04-10

### 🛡️ Quality Hardening

*   **85%+ Test Coverage Milestone:** Achieved a major quality milestone with **89.57% line coverage** across the core SDK. Implemented a strict **85% CI coverage ratchet** using the native Node.js 22+ test-coverage runner, ensuring all future PRs maintain high quality standards.
*   **Mutation Testing:** Integrated **Stryker Mutation Testing** using the `tap-runner` plugin. Configured a weekly CI workflow and local `npm run mutate` script to measure test suite effectiveness (mutant kill rate) beyond simple code coverage.
*   **Coverage Logic Refinement:** Transitioned to deterministic `--test-coverage-exclude` CLI flags, accurately scoping metrics to the core logic library while excluding non-unit-testable CLI entry points.
*   **Refinement Loop Reverted:** Removed the `friction-analyzer.js` script and `.github/workflows/refine-protocols.yml` automation. The protocol refinement loop will now be handled manually by operators reviewing friction logs, rather than by autonomous agents creating PRs.
*   **CI Pipeline Stabilization:** Pinned CI environment to Node 22, resolved pervasive Biome formatting regressions, and adjusted the `maintainability-baseline.json` limit to consistently pass quality gates.
*   **Automated Branch Hygiene:** Added automated `branch-cleanup` CI job to automatically prune merged `epic/` and `story/` sprint branches upon merge to `main`.
*   **Strengthened Test Assertions:** Upgraded testing assertions in `llm-client.test.js` and `manifest-renderer.test.js` from basic execution tests to precise output payload matching, effectively killing a large cluster of StringLiteral and ConditionalExpression Stryker mutants.

## [5.0.0] - 2026-04-05

### 🚀 Major Rewrite

Version 5.0.0 represents a complete, ground-up rewrite of the platform. There is **no backward compatibility** with v4.x.x or earlier.

* **Architecture:** Transitioned to a **GitHub-native Epic Orchestration** model. Re-architected the work structure into a four-tier hierarchy: **Epic → Feature → Story → Task**. Introduced a provider-agnostic **ITicketingProvider** abstraction with a high-performance **Native GitHub Integration** (leveraging GraphQL for Sub-Issues and Projects V2).
* **Key Paradigms:** Adopted **GitHub as the Single Source of Truth**, eliminating the need for local documentation or metadata persistence. Implemented an **Epic-Centric Workflow** that automates the entire SDLC pipeline — from technical specification generation to recursive task dispatch — directly on the GitHub platform. Shifted to a **Self-Contained Dependency Policy**, where all core orchestration logic is built using native Node.js 20+ `fetch` and minimalist JS patterns to eliminate SDK bloat.
* **Orchestration SDK (Epic 71):** Finalized the migration of localized scripts into a shared, unified SDK. These endpoints are now exposed directly to agent environments via a **Model Context Protocol (MCP)** server, reducing context overhead and centralizing command execution.
* **Audit Orchestration (Epic 72):** Introduced an automated **static analysis and audit pipeline** triggered at sprint lifecycle gates. Enforces a maintainability ratchet and provides a structured review-approve-implement workflow via newly defined `audit-` slash commands.
* **Execution Model (Epic 98):** Deprecated monolithic Epic branches in favor of a **Story-Level Branching and Execution model**. Integrates dynamic execution paths where Tasks directly roll up to their parent Story tickets, streamlining code reviews and improving continuous integration reliability.
* **Removed:** Completely decommissioned the legacy **local documentation system** (`sample-docs/`), **v4 protocol version enforcement**, and all **legacy telemetry and indexing scripts** (`aggregate-telemetry.js`, `context-indexer.js`). Purged all legacy version-locked planning templates in favor of dynamic, automated workflow orchestration.

## [5.1.0] - 2026-04-09

### ✨ Autonomous Protocol Refinement (Epic 74)

Introduced a self-healing feedback loop that analyzes sprint friction logs to autonomously suggest and track protocol improvements.

* **Friction Analyzer:** Implemented a global ingestion service that parses structured friction logs across all completed tasks, classifying them into actionable categories (Prompt Ambiguity, Tool Limitation, etc.).
* **Refinement Loop:** Developed the `ProtocolRefinementAgent` to identify recurring friction patterns and generate targeted protocol refinements via GitHub Pull Requests.
* **Impact Tracker:** Introduced an autonomous impact measurement service that monitors reduced friction rates in sprints following a protocol refinement merge, posting performance reports directly to the original PR.
* **Health Monitor:** Implemented a real-time performance visualization component that updates a dedicated GitHub "Sprint Health" issue, surfacing MCP tool success rates and active friction events during execution.

---
*For historical changes prior to v5.0.0, please refer to the [Legacy Changelog (v1.0.0 - v4.7.2)](docs/CHANGELOG-v4.md).*
