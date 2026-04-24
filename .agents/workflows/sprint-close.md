---
description: >-
  Final Epic closure — merge the Epic base branch to main, close the Epic issue
  via GitHub provider, clean up branches, and tag a release.
---

# Sprint Close

This workflow is the **terminal step** of the Epic lifecycle. It promotes the
fully integrated and reviewed `epic/<epicId>` branch into `main`, closes the
Epic GitHub issue, cleans up all sprint branches, and optionally tags a release.

The workflow is organised around **five phases** — Validate, Review, Land,
Finalize, Notify. Each phase is a cohesive checkpoint: skipping ahead strands
partial state on GitHub, so run them in order.

> **When to run**: As soon as all child work is closed. `/sprint-close`
> auto-invokes the mandatory pre-merge gates (the `helpers/sprint-code-review.md`
> module in the Review phase and `helpers/sprint-retro.md` in the Notify phase)
> when they have not already been completed, so operators no longer need to run
> them by hand.
>
> **Persona**: `devops-engineer` · **Skills**:
> `core/git-workflow-and-versioning`

## Step 0 — Resolve Configuration

1. Resolve `[EPIC_ID]` — the GitHub Issue number of the Epic to close.
2. Resolve `[EPIC_BRANCH]` — `epic/<epicId>`.
3. Resolve `[BASE_BRANCH]` from `baseBranch` in `.agentrc.json` (default:
   `main`).
4. Resolve `[SCRIPTS_ROOT]` from `scriptsRoot` in `.agentrc.json`.
5. Resolve `[RELEASE_CONFIG]` — the `release` object from `.agentrc.json`:
   - `release.docs` — array of file paths to verify (e.g.,
     `["README.md", "docs/CHANGELOG.md"]`). Defaults to `[]`.
   - `release.versionFile` — path to a plain-text version file (e.g.,
     `.agents/VERSION`). Defaults to `null`.
   - `release.packageJson` — boolean; if `true` the version in the root
     `package.json` is also bumped. Defaults to `true`.
   - `release.autoVersionBump` — boolean; if `true` (default) the agent
     automatically determines whether to bump the **minor** or **patch** segment
     based on the scope of changes in the Epic. If `false`, no automatic version
     bump is performed (the operator must bump manually or specify the segment
     at invocation time).
6. Resolve `[ALL_DOCS]` — the combined array of documentation files to verify:
   - All files listed in `release.docs`.
   - All files listed in `agentSettings.docsContextFiles` (prefixed with the
     path from `agentSettings.docsRoot`).
7. Resolve `[RUN_RETRO]` from `agentSettings.sprintClose.runRetro` in
   `.agentrc.json` (default: `true`). When `false`, the Notify phase's retro
   auto-invoke is skipped entirely — no retro is required or produced.
8. Resolve `[AUTO_CLOSE]` — `true` when the Epic carries `epic::auto-close`.

---

## Phase 1 — Validate

Prove the sprint is cohesive and safe to ship before running any git
operations. If any check in this phase fails, STOP and surface the exact
remediation to the operator.

### 1.1 Wave Completeness Gate

Every Story in the Epic's frozen dispatch manifest must be closed, along with
every open recut and every parked follow-on. The manifest lives as a
`dispatch-manifest` structured comment on the Epic — `/sprint-plan` and every
subsequent dispatcher run refresh it, so it is the single source of truth for
"which Stories did the sprint actually commit to?"

```powershell
node [SCRIPTS_ROOT]/sprint-wave-gate.js --epic [EPIC_ID]
```

If the script exits non-zero: **STOP IMMEDIATELY.** The output lists every
manifest Story, recut, and parked follow-on that is still open, with its wave
and title. Close or re-dispatch the outstanding work before re-running
`/sprint-close`. Pass `--allow-parked` / `--allow-open-recuts` to waive once
the operator has deliberately deferred the follow-on work.

> If `temp/dispatch-manifest-<epicId>.{md,json}` has drifted or was lost,
> regenerate it from the structured comment (the SSOT) via:
>
> ```powershell
> node [SCRIPTS_ROOT]/render-manifest.js --epic [EPIC_ID]
> ```

### 1.2 Hierarchy Completeness Gate

Every child item under the Epic must be closed:

1. **Tasks**: Must all be `agent::done` and closed.
2. **Stories**: Must all be closed.
3. **Features**: Must all be closed.

If ANY child ticket is open: **STOP IMMEDIATELY** and alert the operator with
the exact open IDs.

### 1.3 Documentation Freshness Gate

Every doc in `[ALL_DOCS]` must reference the Epic. A file passes when **either**
a commit touching it mentions `#[EPIC_ID]` in its message, **or** the file's
current body mentions `#[EPIC_ID]`. A pure-whitespace or unrelated diff no
longer satisfies the gate.

```powershell
node [SCRIPTS_ROOT]/validate-docs-freshness.js --epic [EPIC_ID]
```

Add `--json` to receive a structured `{ ok, epicId, results: [...] }` payload
on stdout — useful when the LLM wants to enumerate failing files
programmatically rather than parse the log output.

```powershell
node [SCRIPTS_ROOT]/validate-docs-freshness.js --epic [EPIC_ID] --json
```

For every failing file, open it, review the Epic's completed tickets
(title + description), and add or update the relevant sections to reflect the
shipped changes. Then stage and commit with a message that cites the Epic:

```powershell
git add [DOC_PATH]
git commit -m "docs([DOC_PATH]): update for Epic #[EPIC_ID]"
```

Re-run the gate until it exits 0.

> **CHANGELOG style contract.** When updating `docs/CHANGELOG.md` (or the
> project-equivalent) follow
> [`.agents/rules/changelog-style.md`](../rules/changelog-style.md): 1–3
> sentence theme paragraph, bullets of user-visible changes only, no internal
> file paths or symbol names, mandatory prominence for breaking changes and
> config/CLI shape changes, soft ceiling of ≤60 lines per non-major release
> (≤150 for major). The rule includes a before/after worked example.
>
> **Guidance for consuming projects:** Add every file your release process
> requires to `release.docs` or `agentSettings.docsContextFiles` in
> `.agentrc.json`. Common examples: `README.md`, `docs/CHANGELOG.md`,
> `MIGRATION.md`, `API.md`.

---

## Phase 2 — Review

Establish the post-hoc code-review record on the Epic. The Review phase runs
the [`helpers/sprint-code-review.md`](helpers/sprint-code-review.md) module,
which performs the static analysis **and** persists its findings as a
`code-review` structured comment on the Epic (via `upsertStructuredComment`).
That comment is the durable audit trail — subsequent retros, incident reviews,
and compliance checks read back from it.

### 2.1 Auto-invoke the code-review helper

1. Follow the procedure in
   [`helpers/sprint-code-review.md`](helpers/sprint-code-review.md) inline for
   `[EPIC_ID]` (read-only audit mode — no remediation).
2. Inspect the resulting findings:
   - **Any 🔴 Critical Blocker** — STOP. Relay the blockers to the operator and
     do not proceed to Phase 3. The operator decides whether to fix on the
     Epic branch and re-run `/sprint-close`, or to override explicitly.
   - **Only 🟠/🟡/🟢 findings** — log them as "non-blocking review findings"
     and continue. The full report is already persisted on the Epic.
3. If the operator passes `--skip-code-review` at invocation time, skip this
   step and log `code review skipped by operator override`.

> **Why auto-invoke:** The prior gate assumed the code review had been run
> out-of-band and stopped when it couldn't detect evidence. Because the review
> now upserts a structured comment, the gate detects prior runs reliably —
> but keeping the auto-invoke collapses the round-trip when the review has
> not yet been written.

---

## Phase 3 — Land

Ship the Epic: validate the branch, bump version if applicable, merge to
`[BASE_BRANCH]`, scan for conflict markers, and push.

### 3.1 Branch-Protection Prerequisite (auto-close only)

When `[AUTO_CLOSE]` is `true`, confirm `[BASE_BRANCH]` carries a protection
rule **before** the merge. An unprotected `main` + an automated merge is an
unreviewed direct-push waiting to happen.

```powershell
node [SCRIPTS_ROOT]/check-branch-protection.js --epic [EPIC_ID] --base [BASE_BRANCH]
```

The script is a no-op when the Epic does not carry `epic::auto-close`. When
protection is missing and auto-close is set, it exits non-zero and prints two
remediation paths (enable protection, or drop the auto-close label).

### 3.2 Version Bump & Tag

If `release.autoVersionBump` is `false`, **skip this entire step** — do not
bump any version, do not create a tag. Proceed directly to the pre-merge
validation.

If `release.autoVersionBump` is `true` (default) **and** at least one of
`release.versionFile` or `release.packageJson` is configured, increment the
project version **before** the merge to `[BASE_BRANCH]`.

1. **Read** the current version string from `[RELEASE_CONFIG].versionFile` (if
   set) or `package.json#version`.
1. **Determine the bump segment** by inspecting the Epic's completed tickets:
   - **minor** — new user-facing features, new workflows, new CLI commands,
     new API surfaces, or significant behavioural changes.
   - **patch** — bug fixes, documentation updates, refactors, dependency
     bumps, or internal tooling changes with no user-facing feature additions.
   - The operator may override at invocation time (e.g., "use major").
1. **Calculate** the next version by incrementing the chosen segment
   (`major.minor.patch`).
1. **Write** the new version:

```powershell
# If release.versionFile is set:
# Write the new version string to that file (overwrite contents).

# If release.packageJson is true (default):
npm version [BUMP_SEGMENT] --no-git-tag-version
```

1. **Commit** the version bump:

```powershell
# Guard: confirm we're on the Epic branch before committing the bump.
node .agents/scripts/assert-branch.js --expected epic/[EPIC_ID]

# Stage only the version-bump artefacts (never `git add .`).
git add package.json package-lock.json [release.versionFile]
git commit -m "chore(release): bump version to [NEW_VERSION] for Epic #[EPIC_ID]"
```

1. **Tag** the release:

```powershell
git tag -a "v[NEW_VERSION]" -m "Release v[NEW_VERSION]: Epic #[EPIC_ID] — [Epic Title]"
```

> **Note:** The tag is created on the Epic branch before the merge so it
> travels with the merge commit into `[BASE_BRANCH]`. The tag is pushed in
> Step 3.5 alongside `[BASE_BRANCH]`.

### 3.3 Pre-Merge Validation

```powershell
npm run lint; npm test
```

If the build fails: **STOP**. Fix the regressions on a hotfix branch and merge
back into the Epic branch before restarting this workflow.

### 3.4 Merge Epic Branch to Base

```powershell
git checkout [BASE_BRANCH]
git pull origin [BASE_BRANCH]
git merge --no-ff epic/[EPIC_ID] -m "chore(release): merge epic/[EPIC_ID] into [BASE_BRANCH]"
```

### 3.5 Conflict Marker Scan

```powershell
node [SCRIPTS_ROOT]/detect-merges.js
```

If markers are found: resolve them following the canonical procedure in
[`helpers/_merge-conflict-template.md`](helpers/_merge-conflict-template.md),
stage with `git add`, and amend the merge commit before proceeding.

### 3.6 Push Base & Tags

```powershell
git push origin [BASE_BRANCH] --follow-tags
```

If Step 3.2 bumped the version, confirm the tag reached the remote **before**
Finalize. A missing tag at this stage is still cheap to fix; once the Epic is
closed and branches are deleted, a failed tag push is far harder to notice:

```powershell
git ls-remote --tags origin "v[NEW_VERSION]"
```

If the output is empty (e.g., `--follow-tags` was skipped or the remote
rejected the tag), push it explicitly before continuing:

```powershell
git push origin "v[NEW_VERSION]"
```

---

## Phase 4 — Finalize

Close the planning, strategy, and Epic tickets, then clean up branches.

```powershell
node [SCRIPTS_ROOT]/sprint-close.js --epic [EPIC_ID]
```

The script performs three phase-internal functions:

1. **Close auxiliary tickets** — `context::prd`, `context::tech-spec`, and
   `type::health` (Sprint Health dashboard) tickets are transitioned to
   `agent::done` and closed. These tickets hold no planned work; leaving them
   open after the Epic closes produces orphan children that pollute future
   project views.
2. **Close the Epic** — posts a shipping notification comment, then closes
   the issue with `state_reason=completed`.
3. **Branch cleanup** — reaps stale worktrees, prunes stale worktree
   registrations, and batch-deletes every local + remote branch associated
   with the Epic (can be disabled with `--no-cleanup`).

Windows/PowerShell resilience: remote branch deletions are individually
wrapped in error handling. A "branch not found" error on any single remote
ref is logged as a warning but **does not** abort the cleanup pass — every
remaining branch is still attempted.

Manually verify in the GitHub UI that the Epic and all context tickets are
closed. Check the notification structured comment on the Epic for the final
shipping announcement.

If Step 3.2 bumped the version, re-confirm the tag is published:

```powershell
git ls-remote --tags origin "v[NEW_VERSION]"
```

If the tag is still missing here the release is **not** shipped; re-run the
explicit tag push before announcing.

---

## Phase 5 — Notify

Write the retrospective (if enabled) and fire the terminal notification so
stakeholders learn the Epic shipped.

### 5.1 Auto-invoke the retro helper

**Skip this step entirely when `[RUN_RETRO]` is `false` or the operator
passed `--skip-retro`.** Log the override and proceed.

When `[RUN_RETRO]` is `true` (default), verify a retrospective comment is
present on the Epic. Retros are stored as comments on the Epic — there is no
local retro file.

Detection strategy:

1. **Preferred**: fetch `provider.getComments(epicId)` (or
   `provider.getTicketComments(epicId)`) and filter for a comment whose
   `type === "retro"` metadata is present.
2. **Fallback**: grep the raw comment bodies for the
   `<!-- retro-complete: ... -->` HTML marker written at the end of the retro
   body.

```powershell
# Fallback grep — matches the retro-complete HTML marker.
gh api "repos/{owner}/{repo}/issues/[EPIC_ID]/comments" \
  --jq '.[] | select(.body | test("retro-complete:"))'
```

If no matching comment is found, **auto-invoke** the
[`helpers/sprint-retro.md`](helpers/sprint-retro.md) procedure inline for
`[EPIC_ID]`. After it completes, re-run the check above to confirm the comment
is now present. If the retro helper failed to produce a comment, STOP and
relay the failure to the operator.

> **Why it exists:** without the gate, retros get silently skipped and the
> Epic closes with no post-mortem record. The gate reads directly from
> GitHub (the retro's source of truth), not a local path.
>
> **Why it auto-invokes:** the prior "STOP and ask the operator to run the
> retro" step generated friction every time — the operator always
> wanted "run it, then continue." Auto-invocation collapses the round-trip.
>
> **`--skip-retro` parity:** the flag behaves like `--skip-code-review` —
> both log the override and continue. Use sparingly; the retro is how the
> organisation learns from each Epic.

### 5.2 Notification

```powershell
node [SCRIPTS_ROOT]/notify.js --ticket [EPIC_ID] "Epic #[EPIC_ID] closed. Merged to [BASE_BRANCH] and branches cleaned up." --action
```

---

## Constraint

- **Never** merge to `[BASE_BRANCH]` if any child ticket (Task, Story,
  Feature) is still open — the Hierarchy Completeness Gate (Phase 1.2) is
  mandatory.
- **Never** skip the Documentation Freshness Gate (Phase 1.3). Every file in
  `[ALL_DOCS]` **must** reference `#[EPIC_ID]` in a commit message or body
  before the merge proceeds.
- **Never** skip the pre-merge validation (lint + test) in Phase 3.3. A
  broken `[BASE_BRANCH]` blocks all future Epics.
- **Never** run auto-close merges against an unprotected `[BASE_BRANCH]` —
  Phase 3.1 refuses them.
- **Always** auto-invoke the code-review helper (Phase 2) and the retro helper
  (Phase 5.1) when they have not already produced their artefacts. Do not
  halt and ask the operator to run them separately — that round-trip is what
  the auto-invoke replaced.
- **Always** persist the code-review output as a `code-review` structured
  comment on the Epic — `sprint-code-review.js` already does this via
  `upsertStructuredComment`; do not bypass it.
- **Always** bump the version and create the git tag (Phase 3.2) before
  merging when `release.autoVersionBump` is `true`. Use **minor** for new
  features, **patch** for fixes and refactors.
- **Always** run `sprint-close.js` (Phase 4) to ensure PRD and Tech Spec
  tickets are formally closed — they are excluded from auto-closure during
  execution.
- **Always** delete all Epic, Task, and Story branches after merge to
  prevent branch bloat. Individual remote deletion failures MUST be
  tolerated — log them as warnings and continue.
- **Always** tag a release when the Epic corresponds to a versioned
  milestone.
