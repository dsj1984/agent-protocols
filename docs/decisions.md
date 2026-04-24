# Architecture Decision Records (ADR)

## ADR 001: Autonomous Protocol Refinement Loop

**Status:** Reverted (Moved to manual process)  
**Date:** 2026-04-09  
**Epic:** #74

### Context
Frequent friction during agent execution (e.g., tool misuse, prompt ambiguity) requires manual protocol updates. This creates a bottleneck and prevents the system from scaling its efficiency.

### Decision
We will implement an autonomous, closed-loop system that:
1.  Ingests friction logs from completed tasks.
2.  Uses an LLM-based agent to identify patterns and propose protocol updates.
3.  Automatically creates PRs for these updates.
4.  Tracks the performance impact post-merge.

### Consequences
*   **Positive:** Reduced manual maintenance, faster protocol maturation, data-driven improvement.
*   **Negative:** Increased GitHub API usage, potential for low-quality automated PRs if prompts are weak.
*   **Mitigation:** Human-in-the-loop (HITL) requirement for merging refinement PRs.

---

## ADR 002: Real-time Sprint Health Monitoring

**Status:** Accepted  
**Date:** 2026-04-09  
**Epic:** #74

### Context
Operators lack visibility into "stalled" sprints or widespread tool failures during parallel task execution.

### Decision
Implement a single-issue "Sprint Health" dashboard in GitHub that is updated via `health-monitor.js` after every major task state transition.

### Consequences
*   **Positive:** Immediate visibility into systemic failures.
*   **Negative:** High edit frequency on a single issue might trigger GitHub rate limits.
*   **Mitigation:** Debounced updates and batching metrics.

---

## ADR 003: Worktree-per-Story Isolation for Parallel Sprint Execution

**Status:** Accepted
**Date:** 2026-04-15
**Epic:** #229
**Version shipped:** 5.7.0

### Context

Parallel sprint execution prior to v5.7.0 shared one working tree across all
story agents. On 2026-04-14, five concurrent agents under `epic/267` raced on
branch checkouts and swept a WIP file from one story into another story's
commit. v5.5.1 shipped three symptomatic fixes (tri-state Epic branch
bootstrap, pre-commit `assert-branch.js`, focus-area wave serialization). These
prevented the specific failure modes observed but did not address the root
cause: multiple agents mutating one working tree at the same time.

### Decision

Each dispatched story runs in its own `git worktree` at
`.worktrees/story-<id>/`. A single `WorktreeManager` owns the worktree
lifecycle (`ensure` / `reap` / `list` / `isSafeToRemove` / `gc`). The
dispatcher constructs a manager when
`orchestration.worktreeIsolation.enabled` is `true` and threads the worktree
path as `cwd` through the execution adapter. Single-tree mode remains a
first-class fallback via `enabled: false`.

Supporting decisions:

- **No `git worktree --force` from framework code.** Dirty tree ⇒ refuse to
  delete; operator may run `--force` manually as an escape hatch.
- **`core.longpaths=true`** set per worktree on win32; a pre-flight
  path-length warning is posted on the Epic issue when the estimated deepest
  path exceeds the configured threshold.
- **`gitFetchWithRetry`** retries only on known packed-refs lock-contention
  signatures; unrelated fetch failures surface immediately. No global mutex
  — that would erase the parallelism the model is designed to enable.
- **`node_modules` strategy is explicit**: `per-worktree` (default, correct
  everywhere), `symlink` (requires `primeFromPath`; Windows opt-in via
  `allowSymlinkOnWindows`), `pnpm-store` (agent runs `pnpm install` against
  the shared store).

### Consequences

*   **Positive:**
    *   Main-checkout reflog stays quiet during parallel sprints; agent
        activity is confined to per-worktree reflogs.
    *   Defense-in-depth preserved: `assert-branch.js` and focus-area
        serialization remain in place for the fallback mode and as second-
        line guards in worktree mode.
    *   Fallback mode works with existing v5.5.1 tests unchanged.
*   **Negative:**
    *   Increased disk usage for `per-worktree` install strategy; `symlink`
        and `pnpm-store` mitigate at the cost of platform fragility.
    *   Windows long-path handling requires explicit operator attention
        when the worktree root nests deeply.
    *   Concurrent `git fetch` can collide on `.git/packed-refs.lock`;
        handled by bounded retry rather than a global lock.
*   **Mitigation:**
    *   `worktree-lifecycle.md` documents the model, Windows notes, and
        escape hatches.
    *   Real-git integration test (`tests/integration/parallel-sprint.test.js`)
        asserts AC6 (no WIP cross-contamination across five concurrent
        stories) and AC7 (main-checkout reflog quiet) on every run.

---

## ADR 004: Gherkin Standards as Sole SSOT for BDD Tags & Forbidden Patterns

**Status:** Accepted
**Date:** 2026-04-19
**Epic:** #269

### Context

Epic #269 introduces a BDD authoring framework: one rule
(`.agents/rules/gherkin-standards.md`), two skills
(`skills/stack/qa/gherkin-authoring`, `skills/stack/qa/playwright-bdd`), one
workflow (`/run-bdd-suite`), and a pyramid-aware rewrite of
`testing-standards.md`. Without a single source of truth for the tag taxonomy
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

*   **Positive:**
    *   One place to look for the tag grammar; reviewers can mechanically
        reject unknown tags.
    *   `gherkin-authoring` and `playwright-bdd` stay focused on *how* and
        *when* without redefining *what*.
    *   The audit from Task #294 becomes a repeatable pattern — grep the
        skills for redefinition, point at the rule.
*   **Negative:**
    *   Rule-level changes are higher friction than editing a skill; adding a
        new domain tag requires a PR to the rule.
*   **Mitigation:**
    *   `@domain-<slug>` is extensible by design — consumers pick their own
        slug without touching the rule. Only the top-level tag *categories*
        are closed.

---

## ADR: Decompose oversized orchestration modules via facade pattern

**Status:** Accepted
**Date:** 2026-04-20
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

*   **Positive:**
    *   No caller needs to change — `dispatcher.js`,
        `mcp-orchestration.js`, `sprint-story-{init,close}.js`, and every
        test file continue to import from the existing paths.
    *   Each submodule owns one responsibility and is individually
        unit-testable; 65 new per-submodule tests landed alongside the
        refactor (13 manifest + 35 worktree + 17 orchestration).
    *   Future behaviour changes touch the submodule that owns the
        concern, not a 1,000-LOC grab-bag.
*   **Negative:**
    *   The facade carries a handful of backwards-compat `_*` delegate
        methods on `WorktreeManager` so the existing 46-test
        `worktree-manager.test.js` keeps passing without edits. They are
        technical debt to be retired once those tests migrate to
        per-submodule imports.
    *   One new lazy-VerboseLogger implementation (`dispatch-logger.js`)
        duplicates the pattern used elsewhere in the codebase.
*   **Mitigation:**
    *   Retro action items track both the delegate retirement and the
        lazy-logger consolidation.
    *   Downstream consumers are explicitly told (in `architecture.md`
        and this ADR) that only the facade paths are stable — submodule
        paths may be renamed without a major version bump.

---

## ADR-20260421: Epic-level remote orchestration via GitHub label trigger

*   **Status:** Accepted (Epic #321, v5.14.0).
*   **Context:** Before v5.14.0 `/sprint-execute` was story-scoped and
    operator-driven: the operator picked Stories off the dispatch table
    and launched each in its own window. Wave advancement and bookend
    chaining (review → retro → close) were manual. The orchestration
    primitives to automate this already existed (`dispatch_wave`,
    `Graph.computeWaves()`, `cascadeCompletion`), but no long-running
    driver tied them together.
*   **Decision:** A new `/sprint-execute-epic` skill wraps a composed
    `EpicRunner` coordinator that walks the wave DAG, fans out per-story
    executor sub-agents (bounded by `concurrencyCap`), checkpoints
    progress on the Epic via the `epic-run-state` structured comment,
    and halts only at `agent::review` or on blocker escalation. A
    GitHub Actions workflow (`epic-orchestrator.yml`) fires on
    `agent::dispatching` label application, boots a Claude remote
    agent, and launches the same skill against the same engine. Local
    and remote runs share code path.
*   **Alternatives considered:**
    *   Build a separate "epic executor" service running outside
        GitHub — rejected because it would reinvent the dispatcher and
        require its own state store.
    *   Extend `/sprint-execute` to accept either Story or Epic IDs
        (single command, switch on type) — rejected for v5.14.0 to keep
        the rename/alias story clean; planned for Epic #349.
    *   Runtime HITL approval on every wave boundary — rejected; the
        Epic's whole value proposition is HITL-minimal execution.
*   **Consequences:**
    *   Three operator touchpoints on the happy path: dispatch,
        blocker resolution, review hand-off.
    *   `epic::auto-close` authorizes autonomous merge-to-main, so
        branch protection on `main` becomes the primary defense for
        destructive actions.
    *   `risk::high` runtime gating is retired (see ADR below); the
        label remains as retro-visible metadata.
    *   The remote-agent environment has a new secret surface
        (`ENV_FILE`, `MCP_JSON`, `GITHUB_TOKEN`); `::add-mask::` +
        `0600` file perms in `remote-bootstrap.js` are the contract.

---

## ADR-20260421: Retire `risk::high` runtime gating

*   **Status:** Accepted (Epic #321 Story #334, v5.14.0).
*   **Context:** `risk-gate-handler.js` halted the dispatcher on
    `risk::high` tasks, and `sprint-story-close.js` halted close for
    `risk::high` stories. In the new HITL-minimal model this becomes
    two per-ticket gates the orchestrator must pause on — incompatible
    with unattended remote runs.
*   **Decision:** The runtime halt is removed. `handleRiskHighGate`
    reduces to a log-only warning; `wave-dispatcher.js` dispatches
    `risk::high` tasks unconditionally; `sprint-story-close.js` gates
    only when both `hitl.riskHighApproval` **and**
    `hitl.riskHighRuntimeGate` are explicitly `true` (both default
    `false`). The label is preserved — retros and planning can still
    query it as metadata.
*   **Alternatives considered:** rename the label to
    `metadata::risk-high` to make its informational nature legible —
    deferred to Epic #349 as it is a breaking taxonomy change.
*   **Consequences:**
    *   Destructive-action containment moves from runtime approval to
        (a) GitHub branch protection on `main`, (b) executor sub-agent
        `agent::blocked` escalation when an unauthorized destructive
        action is detected, (c) `epic::auto-close` as a deliberate
        opt-in that must be set at dispatch.
    *   `handleHighRiskGate` in `sprint-story-close.js` becomes dead
        code behind a hidden opt-in flag — cleanup tracked in Epic
        #349 Wave 0.

---

## ADR-20260422: Two-stage Windows worktree reap (fs.rm retry + deferred sweep)

*   **Status:** Accepted (Epic #380 Story #386, v5.15.1).
*   **Context:** The v5.7.0 worktree-per-story model ships a clean
    `reap` path for POSIX, but on Windows `git worktree remove` + the
    follow-up `fs.rm` routinely fail with `EBUSY` / `ENOTEMPTY` because
    antivirus, indexing, and `node_modules` file handles hold the
    directory open for seconds after the merge completes. The v5.15.0
    symptom was `branchDeleted: false` from `/sprint-story-close` plus
    orphan `.worktrees/story-<id>/` residue that broke the next
    `npm run lint` (nested `biome.json` in the orphan was picked up).
*   **Decision:** Reap is now a two-stage operation inside
    `lifecycle-manager.js`:

    1. Primary path retries `fs.rm(..., { recursive: true, force: true,
       maxRetries, retryDelay })` on `EBUSY` / `ENOTEMPTY`.
    2. Anything still pinned after retry is queued into
       `.worktrees/.pending-cleanup.json` and drained on the next
       worktree-manager run by `worktree-sweep.js`.

*   **Explicitly rejected approaches:**
    *   **Shelling out to `rm -rf` / `cmd /c rd /s /q`** — makes the
        deletion opaque to Node, silently succeeds while antivirus is
        still scanning, and would require per-platform branching. The
        `fs.rm` retry path surfaces real errors and is test-drivable
        with an injected adapter.
    *   **Switching the default `node_modules` strategy to `symlink` or
        `pnpm-store`** to shrink the reap surface — rejected; the
        `per-worktree` strategy is the only one that is correct on every
        platform and CI image, and the original Epic #229 ADR
        (ADR 003) documents why. The Windows reap problem is worth
        fixing on its own terms without touching the install model.
    *   **Global mutex around reap** — rejected for the same reason the
        fetch path refused one: it would erase the parallelism the
        worktree model is designed to enable.
*   **Consequences:**
    *   `/sprint-story-close` reports `branchDeleted: true` on Windows
        across the common antivirus failure modes; the remaining tail
        is handled asynchronously by the sweep.
    *   New artefact: `.worktrees/.pending-cleanup.json` (see
        `docs/data-dictionary.md#8-epic-380-artefacts-v5151`).
    *   Orphan-worktree biome lint block (documented in operator
        auto-memory) disappears once the sweep drains a queued entry.

---

## ADR-20260422: `/sprint-retro` routes through provider.postComment, not notify.js

*   **Status:** Accepted (Epic #380 Story #388, v5.15.1).
*   **Context:** `notify.js` dispatches via the Make.com webhook
    configured in `orchestration.notificationWebhookUrl`. It is the
    right surface for operator pings ("your story needs review") but
    the wrong surface for retro bodies, which are long-form markdown
    with internal-only friction analysis. v5.15.0 routed retros through
    `notify.js`; the webhook forwarded every retro to Slack, leaking
    draft content and friction citations to channels that should never
    have seen them.
*   **Decision:** `/sprint-retro` posts the retro body via
    `provider.postComment` (or the MCP `post_structured_comment` tool
    when running under the MCP harness). The ticket issue is the SSOT
    for retros; no external webhook is invoked. A `retro-partial`
    structured-comment checkpoint is written during collection so a
    crashed retro resumes without re-reading the friction log.
*   **Alternatives considered:**
    *   Keep `notify.js` but filter retro payloads at the webhook side —
        rejected; the webhook is out-of-repo and out-of-review, so a
        filter there is not auditable from this repository.
    *   Write retros to a local file and upload as a gist — rejected;
        breaks the "GitHub issue is the SSOT" invariant the whole
        framework rests on.
*   **Consequences:**
    *   Operator memory entry `feedback_retro_github_only.md` is
        resolved at the framework level, not just as a per-project rule.
    *   `notify.js` is now scoped exclusively to short operator pings;
        its payload surface is correspondingly smaller.
    *   Retro resumption is a first-class flow: the `retro-partial`
        marker is idempotent and the final `retro-complete` upsert
        replaces it on success.

## ADR-20260422: Pre-wave spawn smoke-test + post-wave commit assertion

*   **Status:** Accepted (Epic #413 Stories #419 / #420, v5.15.2).
*   **Context:** The single highest-impact bug of Epic #380 was that
    every Story dispatched via the `defaultSpawn` adapter exited in ~3
    seconds without doing any work. A one-line Windows shell-quoting
    bug wasted a full 28-second "successful" wave. The fix landed
    mid-close as commit `6830fbe`, but nothing in the runtime path
    would have flagged the regression earlier than "wave reports done,
    no commits exist."
*   **Decision:** Two complementary guards are wired into the
    `epic-runner` coordinator:
    1.  `SpawnSmokeTest` (`lib/orchestration/epic-runner/spawn-smoke-test.js`)
        runs `claude --version` through the real `buildClaudeSpawn`
        shape before Wave 1 dispatches. A non-zero exit (or 5s
        timeout) halts the runner with a friction comment naming
        `CLAUDE_BIN`, the exit code, and stderr; the Epic flips to
        `agent::blocked`.
    2.  `CommitAssertion` (`lib/orchestration/epic-runner/commit-assertion.js`)
        runs after each wave reports `done`. It iterates the done
        Stories and confirms every `origin/story-<id>` has at least
        one new commit reachable from `origin/epic/<epicId>`. A
        zero-delta story reclassifies the wave as `halted`.
*   **Alternatives considered:**
    *   Rely on the close-time assertion alone — rejected; that
        already exists implicitly (no commits → close fails) but the
        feedback loop is too long. Catching the spawn bug at Wave 1
        instead of Wave N saves up to N × wave-duration of wasted run.
    *   Invoke `claude --version` once at runner load — rejected;
        the failure mode was specifically about the
        `--dangerously-skip-permissions` arg shape, which `--version`
        + a stub binary doesn't fully exercise. The smoke-test runs
        the real shape.
*   **Consequences:**
    *   The `defaultSpawn` regression class fails fast (in seconds, not
        a wave) and surfaces a structured friction comment on the
        Epic. Operators no longer need to read the runner stdout to
        diagnose.
    *   The `CommitAssertion` adds one provider round-trip per Story
        per wave — negligible against the wave duration but real
        against a 100-Story epic; the gating is not configurable
        (intentionally — silent zero-delta closes are always wrong).
    *   The Epic #413 retro itself is the proof: while writing this
        ADR, the runner correctly identified a no-spawn condition
        for Wave N would not have surfaced under the prior protocol.

## ADR-20260422: `sprint-story-close` recovery via explicit --resume / --restart

*   **Status:** Accepted (Epic #413 Story #421, v5.15.2).
*   **Context:** Epic #380's mid-close on Story #389 required ~30
    minutes of manual git surgery (resolve the merge in progress,
    re-run validation, re-merge to the Epic branch). The stock
    `sprint-story-close.js` had no concept of "resuming" — re-running
    it from the worktree always re-ran init/implement/validate
    end-to-end, which was wasteful and racy.
*   **Decision:** `sprint-story-close.js` now classifies the close-time
    state via `detectPriorState()` into one of: `clean` (default,
    proceed), `unmerged-story-branch` (story branch has commits ahead
    of `epic/<id>` that haven't merged), `merge-in-progress` (UU
    markers on `epic/<id>`), or `dirty-worktree` (uncommitted edits in
    `.worktrees/story-<id>/`). With no flag, the script prints the
    detected state + remediation guidance and exits.
    `--resume` picks up at the merge resolution step without
    re-running init/implement/validate. `--restart` aborts any partial
    state and re-inits from scratch.
*   **Alternatives considered:**
    *   Always re-init (the prior behaviour) — rejected; throws away
        in-flight work and risks loss of uncommitted changes in the
        worktree.
    *   Detect the state and silently auto-resume — rejected; the
        operator should explicitly choose recovery vs restart so an
        accidental partial state isn't promoted to "shipped" without
        review.
*   **Consequences:**
    *   The recovery path Epic #380 needed to execute manually for
        Story #389 reduces to `sprint-story-close --story 389 --resume`.
    *   The default (no-flag) failure is loud and informative rather
        than silent — operators see what state the close is in before
        they choose their next action.
    *   Memory feedback entry `feedback_sprint_story_close_reap.md`
        gains a worked recovery example tied to the new flags.

## ADR-20260422-441a: Force-reap worktrees whose Story branch is already merged

*   **Status:** Accepted (Epic #441 Story #451, v5.15.3).
*   **Context:** Epic #413's `/sprint-close` Phase 4 reaper left 3 of 6
    worktrees orphaned (`story-420`, `story-423`, `story-424`) with
    `reap-skipped: uncommitted-changes`, even though every Story branch
    had already merged into `epic/413`. The "uncommitted" content was
    biome-format drift and already-merged agent edits — safe to
    discard, but the reaper's conservative default preserved them and
    required manual `rmdir` + `git worktree prune` + `git branch -D`.
*   **Decision:** When `git merge-base --is-ancestor` confirms the
    Story branch is already part of `epic/<id>`, Phase 4 force-reaps
    the worktree by default (`git worktree remove --force` + prune +
    `branch -D`). The destructive step is bounded to "already-merged"
    state, so the only content at risk is post-merge drift. A
    `--no-reap-discard-after-merge` flag restores the prior
    conservative behavior. Force-reap emits a `friction` structured
    comment naming the Story and listing the discarded paths so the
    signal isn't lost.
*   **Alternatives considered:**
    *   Move the assertion check before the reaper (so the reap runs
        against the still-unmerged branch) — rejected; it conflates
        merge state with reap state and does not solve the "Windows
        worktree is EBUSY because a process holds a file handle" case.
    *   Require every close to commit format drift onto the Story
        branch before merging — rejected; increases pre-merge noise
        without changing the post-merge "discard is safe" property.
*   **Consequences:**
    *   Memory feedback entry `feedback_sprint_story_close_reap.md`
        becomes obsolete for the `already-merged` case; it remains
        relevant only for truly-in-progress worktrees, which is now
        the exclusive domain of the `--no-` override.
    *   Operators who intentionally leave work-in-progress in a
        worktree after close must pass the override explicitly.

## ADR-20260422-441b: Canonical structured-comment writer is the MCP tool

*   **Status:** Accepted (Epic #441 Story #449, v5.15.3).
*   **Context:** The MCP tool
    `mcp__agent-protocols__post_structured_comment` originally
    accepted only `progress | friction | notification` as `type`
    values. As a result, `sprint-code-review.js`,
    `.claude/skills/sprint-retro.md`, the wave-observer, and the
    progress-reporter each hand-rolled their own structured-comment
    marker and posted via `provider.postComment` directly, bypassing
    payload-schema validation. During Epic #413's close, the retro
    flow had to fall back to `notification` type as a workaround.
*   **Decision:** The MCP tool's `type` enum + payload schema are
    extended with `code-review`, `retro`, `retro-partial`,
    `epic-run-state`, `epic-run-progress`, `parked-follow-ons`,
    `dispatch-manifest`, and a regex for parametric `wave-N-start` /
    `wave-N-end`. All consumers that previously hand-rolled markers
    route through the tool. Hand-rolled `provider.postComment` calls
    with structured markers are treated as an anti-pattern.
*   **Alternatives considered:**
    *   Leave the enum as-is and continue hand-rolling — rejected;
        duplicates the marker invariants across multiple call sites
        and loses schema validation.
    *   Accept arbitrary `type` strings — rejected; loses the
        validation surface that catches typo-driven markers.
*   **Consequences:**
    *   A single canonical writer enforces marker shape + payload
        validation. The retro-fallback-to-`notification` regression is
        no longer possible.
    *   New structured-comment types are a schema bump, not a
        convention change — future additions land alongside their
        validators.

## ADR-20260423: Trust the ticket, not the pipe — idle-timeout ground truth

*   **Status:** Accepted (Epic #470, v5.17.0).
*   **Context:** `epic-runner` spawns each Story as
    `claude -p '/sprint-execute <id>' --dangerously-skip-permissions`.
    The `-p` flag runs the CLI in batch mode: the model's final response
    is the only stdout the pipe ever sees, emitted at session exit.
    For architect-tier stories that legitimately take >15 minutes of model
    + tool time, the pipe stays silent the whole run. The idle-watchdog
    was therefore firing on real work, not hangs, and declaring the
    Story `failed` even when the sub-agent went on to merge and close
    the ticket cleanly. Compounding the problem on Windows, the
    `shell: true` spawn meant `proc.kill()` terminated `cmd.exe` only,
    orphaning the grandchild `node` running Claude Code; the orphan
    often finished the work after the runner had reported failure.
*   **Decision:** The idle-timeout path is no longer authoritative.
    When the watchdog fires, the runner (A) calls `killProcessTree(proc)`
    — on Windows `taskkill /T /F /PID` to reap the whole tree, elsewhere
    `proc.kill()` — then (B) polls the Story ticket every 15s for up to
    120s via `provider.getTicket(id, { fresh: true })`. If a grace read
    finds `agent::done`, resolve `done`; `agent::blocked` resolves
    `blocked`; otherwise the runner finally reports `failed` with the
    actual label list in the detail string.
*   **Alternatives considered:**
    *   Raise `idleTimeoutSec` globally — papers over the mismatch; long
        stories just fail a few minutes later. Rejected.
    *   Force `claude -p` to stream token output — not a supported CLI
        flag. Rejected.
    *   Switch to a tier-aware timeout — architect stories get 30m,
        engineer stories 15m. Adds config surface without fixing the
        Windows orphan. Folded into (A)+(B) as future tuning.
*   **Consequences:**
    *   False-positive `failed` halts on long Stories stop happening —
        the runner reports the ticket's actual state.
    *   Windows grandchild orphans no longer survive `proc.kill()`.
    *   Friction-comment detail now reads
        `idle-timeout: no output for 900s; labels=<actual labels>`
        instead of speculating "likely hung on interactive prompt".
    *   Resumed runs short-circuit already-done Stories in `iterate-waves`
        via a pre-launch label fetch, so a blocker halt no longer costs
        a fresh worktree + `npm ci` for every closed Story on re-run.

---

## ADR-20260423-511a: Features remain in the cascade; Epics and Planning do not

*   **Status:** Accepted
*   **Date:** 2026-04-23
*   **Epic:** #511
*   **Context:** `cascadeCompletion()` previously excluded only `type::epic`,
    `context::prd`, and `context::tech-spec` parents. Features fell through
    the exclusion list silently — they auto-closed because nothing stopped
    them, not because the behaviour had been chosen. A Feature still being
    scoped while early Stories landed closed prematurely, stranding later
    scope work without a parent.
*   **Decision:** Keep Feature auto-close, and make it an explicit choice
    rather than an implicit side-effect. A Feature carries no standalone
    branch, no merge step, and no release artefacts — when its last child
    Story closes, the Feature is complete by definition, and a manual close
    step would be pure ceremony. Operators who want Feature-level
    acceptance-criteria verification should encode it in the final child
    Story. The exclusion list in `cascadeCompletion()` is now asserted by a
    regression test pinned under Epic #511 so future refactors cannot drift.
*   **Alternatives considered:**
    *   Add `type::feature` to the exclusion list — forces a manual close
        step with no corresponding merge/release work. Rejected as
        ceremony.
    *   Scope-guard Features via a new `feature::scoping-complete` label —
        adds surface area to solve a problem the Story-level workflow
        already owns.
*   **Consequences:**
    *   Feature cascade behaviour is load-bearing, not accidental.
    *   A future refactor that accidentally adds `type::feature` to the
        exclusion list fails the pinned test rather than silently changing
        closure semantics.
    *   The Feature auto-close rule is now documented in
        [`architecture.md` § Cascade Behavior](architecture.md#cascade-behavior).

---

## ADR-20260423-511b: `transitionTicketState.fromState` lookup keeps its swallow, now with a debug log

*   **Status:** Accepted
*   **Date:** 2026-04-23
*   **Epic:** #511
*   **Context:** `transitionTicketState()` wraps the prior-state label
    lookup in a silent try/catch — any error leaves `fromState` as `null`
    and downstream notifier payloads ship `{ fromState: null, toState: … }`.
    The review under Epic #511 asked: deliberate or accidental?
*   **Decision:** Deliberate — keep swallowing. A transient network flake
    reading the prior label must not block a legitimate state transition;
    the transition itself is the authoritative event. Add a `debug`-level
    log so the operator can correlate a null `fromState` with the
    underlying error, and document `null` as a valid value in the notifier
    payload contract.
*   **Consequences:**
    *   Transitions remain resilient to read flakes.
    *   Consumers that branch on `fromState` must handle `null`
        explicitly (existing contract now documented).
    *   Silent failures are observable at `debug` log level.

---

## ADR-20260423-511c: Dispatch-manifest writes are atomic (tmp + rename)

*   **Status:** Accepted
*   **Date:** 2026-04-23
*   **Epic:** #511
*   **Context:** `.agents/scripts/lib/presentation/manifest-persistence.js`
    wrote the dispatch manifest directly. A crash mid-write (or a full
    disk) left the file truncated; the next orchestrator run consumed a
    corrupt JSON file as if it were the source of truth.
*   **Decision:** Write to `temp/dispatch-manifest-<epicId>.json.tmp`, then
    `fs.renameSync()` to the final path. `rename` is atomic on the same
    filesystem — the final path either carries the previous valid manifest
    or the newly-written one, never a partial write. If `rename` fails,
    delete the `.tmp` residue and re-throw. Surface the persist outcome to
    the MCP caller via `manifestPersisted: boolean` and optional
    `manifestPersistError: string` on the `dispatch_wave` tool result —
    callers (notably `sprint-execute`) already treat the manifest as
    canonical, so a failed persist must not be swallowed.
*   **Consequences:**
    *   A mid-write crash never corrupts the manifest.
    *   MCP callers can branch on `manifestPersisted` instead of reading a
        stale file unknowingly.
    *   Regression test covers the write-failure path (`fs.writeFileSync`
        throws `EACCES`, assert `manifestPersisted: false` + error string).

---

## ADR-20260424-553a: Bounded-concurrency + TTL cache for epic-runner fanout

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #553
*   **Context:** Two independent performance audits converged on the same
    hot paths. `sprint-wave-gate.js` ran three serial `for..of` loops of
    `await getTicket`; `ProgressReporter` fanned out `getTicket(id, { fresh: true })`
    across every story in every wave on every cadence tick; `state-poller`
    fetched a full ticket per tracked story just to read `.labels`; every
    `GitHubProvider` construction spawned `gh auth token` afresh. On large
    epics this produced avoidable wall-clock and risked secondary rate
    limits. Unbounded `Promise.all` would trade sequential latency for a
    thundering-herd problem.
*   **Decision:** Introduce a single `concurrentMap(items, fn, { concurrency })`
    primitive at `lib/util/concurrent-map.js` and adopt it at every
    framework fanout: wave-gate (all stories), commit-assertion at wave-end
    (cap 4; git is CPU/disk-bound), progress-reporter (cap 8). Extend the
    provider cache with `getTicket(id, { maxAgeMs })`; swap the
    progress-reporter's `{ fresh: true }` for `{ maxAgeMs: 10_000 }`. Prime
    the ticket cache from every `getTickets(epicId)` sweep so downstream
    per-ticket reads cost zero HTTP. Memoize the first successful
    `gh auth token` into `process.env.GITHUB_TOKEN` so subsequent provider
    constructions short-circuit. Add a bulk `issues?labels=agent::*&state=open`
    path to `state-poller` with malformed-response fallback to per-ticket.
*   **Consequences:**
    *   10-second TTL staleness is the ceiling on label-observation
        lag. Any write through the provider invalidates the cache
        entry, so post-write reads are fresh.
    *   Concurrency caps are currently constants; an `agentSettings`
        override is deferred until the phase-timer data (same Epic)
        demonstrates where the caps actually bind.
    *   Bulk-poll is guarded by an explicit well-formedness check;
        label-schema drift falls back to the per-ticket path rather
        than propagating bad state.
    *   Phase-timer instrumentation (ADR-20260424-553b) is the
        measurement surface that validates these caps on future epics —
        no more guessing.

---

## ADR-20260424-553b: Per-phase timing as a first-class epic-runner surface

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #553
*   **Context:** Consumers could not distinguish framework-intrinsic
    overhead (worktree create, `.agents/` copy, bootstrap) from their own
    costs (install, lint, test, implement) when a story took too long.
    Progress snapshots reported wave-level state but carried no timing
    data, so perf regressions were caught by anecdote rather than
    measurement. Future perf work had no baseline to measure against.
*   **Decision:** Build `lib/util/phase-timer.js` + `phase-timer-state.js`
    as a framework primitive with `snapshot` / `restore` semantics so
    phase spans survive the `sprint-story-init` → `sprint-story-close`
    boundary. Emit per-phase elapsed-time lines during the lifecycle.
    On Story close, post a `phase-timings` structured comment on the
    Story ticket. Extend `ProgressReporter` to aggregate **median /
    p95** across every closed Story in the current wave and render the
    result into the Epic's `epic-run-progress` comment.
*   **Consequences:**
    *   Per-Story timings become the regression canary for future
        framework-overhead changes — the next perf Epic starts with
        data, not inference.
    *   The `phase-timings` comment is machine-readable so consumer
        projects can build their own dashboards without scraping logs.
    *   The `ProgressReporter` aggregation runs behind the same TTL +
        concurrency cap introduced in ADR-20260424-553a — observability
        cannot re-introduce the fanout cost it was designed to measure.

## ADR-20260424-596a: CRAP as a sibling gate, not a replacement for MI

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #596
*   **Context:** The maintainability (MI) gate ratchets a per-file composite
    score, but is coverage-blind: a 30-branch function scores identically
    whether it has 0% or 100% test coverage. MI tells operators *what to
    refactor*; it does not tell them *what to test next*. Per-method
    cyclomatic complexity (from `typhonjs-escomplex`) and per-method coverage
    (from the `c8` artifact) were already present in CI but unused for risk
    signalling. Folding the new model into the MI baseline envelope would
    have churned every existing consumer baseline and conflated two distinct
    questions (file-level refactor priority vs. method-level test priority)
    onto one ratchet.
*   **Decision:** Ship CRAP as a **sibling pipeline** with its own baseline
    artefact (`crap-baseline.json`), CLIs (`check-crap`, `update-crap-
    baseline`), and config block (`agentSettings.maintainability.crap`).
    Wire it at the same three sites as MI (close-validation, ci.yml, pre-
    push) but enforce a **hybrid** model: tracked methods ratchet with line-
    drift fallback; new methods must score ≤ `newMethodCeiling` (default 30,
    the canonical CRAP threshold). Removed methods are surfaced as a counter,
    never a failure. Both gates share an envelope shape
    (`{ kernelVersion, summary, violations }`) so agent workflows can consume
    both with one parser.
*   **Consequences:**
    *   Existing `maintainability-baseline.json` stays valid — no consumer
        repo gets a free baseline reshuffle on adoption.
    *   The two questions separate cleanly: MI = "where is the rot?", CRAP
        = "where is the untested complexity?".
    *   A future Epic can refactor both gates onto a shared envelope/helper
        base if/when symmetry pays off; today's parity is shape-level only.

## ADR-20260424-596b: Base-branch-enforced anti-gaming guardrail

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #596
*   **Context:** A PR that simultaneously raises `newMethodCeiling` in
    `.agentrc.json` AND introduces a method over the new (relaxed) ceiling
    would pass its own gate — the gate reads its own branch's config. With
    agentic authorship, this is not a hypothetical: the shortest path to
    green CI is to relax the threshold. A purely advisory "don't do this"
    norm would be eroded within weeks.
*   **Decision:** Add a `pull_request`-only `baseline-refresh-guardrail.yml`
    workflow that reads thresholds from the **base branch** via
    `git show origin/<base>:.agentrc.json`, then re-runs `check-crap` with
    those values forced via `CRAP_NEW_METHOD_CEILING` / `CRAP_TOLERANCE` /
    `CRAP_REFRESH_TAG` env vars. Any PR that touches `crap-baseline.json` or
    `maintainability-baseline.json` must include at least one commit whose
    subject starts with the configured `refreshTag` (default
    `baseline-refresh:`) AND whose body is non-empty — both required.
    Baseline-only PRs receive the `review::baseline-refresh` label
    idempotently across re-runs.
*   **Consequences:**
    *   Threshold relaxation requires either a separately committed baseline
        refresh (with justification body) or it fails CI under base-branch
        values — a malicious or careless PR cannot do both at once.
    *   The label ensures every refresh is reviewer-visible even on green
        CI; "silently merged a baseline" is no longer a possible failure
        mode.
    *   The env-var seam is the same one operators can use ad-hoc to test
        a stricter ceiling against the current branch — testing surface is
        identical to the enforcement surface.

## ADR-20260424-596c: Kernel-version stamp on the CRAP baseline

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #596
*   **Context:** `typhonjs-escomplex` makes scoring decisions that change
    between minor versions. Without a version stamp, an upstream dependency
    bump silently rescores every method, producing a ghost baseline that
    looks healthy but compares against numbers no one ran. Worse, an
    "everything passes" run after a bump masks real regressions in the
    delta. Consumer repos pulling the framework as a submodule absorb the
    bump without warning.
*   **Decision:** Stamp `crap-baseline.json` with two version fields:
    `kernelVersion` (the inline CRAP formula's contract) and
    `escomplexVersion` (the dep). On any mismatch with the running scorer,
    `check-crap` exits 1 with `[CRAP] scorer changed from X to Y — run 'npm
    run crap:update'`. The bootstrap path (no baseline at all) still exits 0
    with a different message — first-run on a consumer repo must never hard-
    fail.
*   **Consequences:**
    *   Dependency bumps surface explicitly with a clear remediation, not
        as a quiet rescore.
    *   Bootstrap and version-mismatch are distinct exit codes (0 vs 1)
        and distinct messages — operators do not have to diff stdout to
        tell a fresh repo from a dependency drift.
    *   The `kernelVersion` field gives us a future-proof seam for
        in-formula changes (e.g., switching from `(1−cov)³` to `(1−cov)²`)
        without a destructive force-rescore on every consumer.

---

## ADR-20260424-638a: `story-566` reap recovery is a self-inflicted dirty-tree bug

*   **Status:** Accepted
*   **Date:** 2026-04-24
*   **Epic:** #638 (Story #648)
*   **Context:** Epic #553 close fired the `worktree.reap recovered via
    fs-rm-retry … attempts=1 lockReason=contains modified or untracked
    files` warning on `story-566`. The log is shaped for Windows-lock
    recovery, but `attempts=1` and the stderr quoted `git worktree
    remove`'s *own* uncommitted-files guard — not a lock class error.
    Classification required tracing the full reap path on a framework
    checkout (where `.agents/` is a tracked directory, not a submodule).
*   **Root cause:** `removeCopiedAgents()` in
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
*   **Why the existing coverage missed it:**
    `tests/lib/worktree-manager.test.js` line 1419 — *"skips index
    scrub in non-submodule (framework) repos"* — creates `wtPath` but
    never materialises `wtPath/.agents`, so `fs.lstatSync` throws and
    the `fs.rmSync` branch is never exercised. Real framework worktrees
    always have a checked-out `.agents/` directory.
*   **Decision:** Classify as a **recoverable bug (outcome b)**. Guard
    the `fs.rmSync`/`fs.unlinkSync` in `removeCopiedAgents` with
    `isAgentsSubmodule(repoRoot)`, matching the self-guard already
    present on the three index-scrub follow-ups. Keep the
    `removeWorktreeWithRecovery` fs-rm fallback in place as
    belt-and-braces for genuine Windows locks. Add a regression test
    asserting that a materialised `.agents/` survives
    `removeCopiedAgents` in a non-submodule repo.
*   **Consequences:**
    *   Framework-repo story closes stop paying the retry cycle and
        stop emitting misleading `fs-rm-retry` warnings on every close.
    *   `git worktree remove` now succeeds on its first attempt in the
        common framework path; Stage 1 recovery resumes being a
        real-failure signal instead of a self-inflicted one.
    *   Submodule-consumer repos are unaffected: `isAgentsSubmodule`
        returns true, the physical delete still runs, and the index
        scrub + modules purge continue as before.
    *   The retained fs-rm fallback still covers the true Windows-lock
        case it was designed for.
