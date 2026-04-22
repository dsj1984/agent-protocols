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
